// NIMAS package (zip) export (A4): the save-side counterpart to parse.mjs's parseNimasZip
// (A3) — builds an OPF + DTBook (+ images + source PDF) package so a NIMAS package imported
// with A3 round-trips through Emboss unchanged. The OPF is built with plain string templates
// (same approach nimas-export.mjs takes for the DTBook itself) so this module stays Node-usable
// (no DOM-only APIs) and testable the same way the rest of input/*.mjs is.
import { exportToNimasXml, escapeXml, toNCName } from './nimas-export.mjs';
import { makeZip } from '../web/zip.mjs';

// Every graphic block anywhere in the model (mirrors parse.mjs's collectGraphics — duplicated
// rather than imported so this module has no dependency on parse.mjs's zip-reading internals).
function collectGraphics(blocks) {
  const out = [];
  const seen = new Set();
  (function deep(v) {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.type === 'graphic') out.push(v);
    for (const k in v) if (v[k] && typeof v[k] === 'object') deep(v[k]);
  })(blocks);
  return out;
}

// The package/document identifier: an imported package's own dc:Identifier (parse.mjs's
// metadata.identifier) survives a round trip so save writes back the same folder/file names
// and dtb:uid/dc:Identifier; failing that, a DTBook dtb:uid; failing that, a generated one so
// a document typed from scratch still gets a stable id for this save.
function packageIdentifier(model) {
  const meta = (model && model.metadata) || {};
  return meta.identifier || meta.uid || `emboss-${Date.now()}`;
}

// NIMAS package ids are conventionally the ISBN + "NIMAS" (e.g. "9781930583733NIMAS") — no
// punctuation. Keep only characters that are safe in both a zip path and an XML NCName.
function fileSafeId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '') || 'document';
}

const IMAGE_EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg',
  'image/webp': 'webp', 'image/bmp': 'bmp', 'image/tiff': 'tiff',
};

// Decodes a `data:<mime>[;base64],<data>` URI into { mime, bytes }. Uses Buffer when available
// (Node) and atob otherwise (browser) — matches the two runtimes this module is used from.
function decodeDataUri(uri) {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,([\s\S]*)$/.exec(uri || '');
  if (!m) return null;
  const mime = m[1] || 'application/octet-stream';
  if (m[2]) {
    const data = m[3] || '';
    if (typeof Buffer !== 'undefined') return { mime, bytes: new Uint8Array(Buffer.from(data, 'base64')) };
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  const text = decodeURIComponent(m[3] || '');
  return { mime, bytes: new TextEncoder().encode(text) };
}

// A unique, valid NCName manifest item id derived from a resource's own filename (falls back
// to a numbered suffix on collision — e.g. two images called "cover" in different folders).
function makeItemId(resourcePath, used) {
  const base = toNCName((resourcePath.split('/').pop() || resourcePath).replace(/\.[^./]+$/, ''));
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

// NIMAS's own package-doc-common.sch (bundled with the DAISY Pipeline; see the A4 DAISY
// validation notes) requires these x-metadata entries to exist — even with empty content —
// for a package to validate. nimas-SourceEdition is commonly present (the CAST corpus always
// writes one, empty or not) but the schema does NOT require it, unlike nimas-SourceDate.
const REQUIRED_NIMAS_METAS = ['nimas-SourceDate'];
const REQUIRED_DCTERMS_METAS = [
  'DCTERMS.description.note', 'DCTERMS.date.dateCopyrighted', 'DCTERMS.description.version',
  'DCTERMS.audience.educationLevel', 'DCTERMS.publisher.place', 'DCTERMS.date.issued',
];

// One <meta name="…" content="…"/> per value from `bucket` (parse.mjs's readOpfMetadata
// stores a repeated name as an array, in source order — e.g. two DCTERMS.description.note —
// so a repeat becomes one line per value), plus an empty one for every required name the
// bucket doesn't already have, so a from-scratch document still writes a structurally
// complete x-metadata rather than silently failing NIMAS's required-metadata checks.
function metaLines(bucket, requiredNames) {
  const b = { ...bucket };
  for (const name of requiredNames) if (!(name in b)) b[name] = '';
  const lines = [];
  for (const name of Object.keys(b).sort()) {
    for (const content of (Array.isArray(b[name]) ? b[name] : [b[name]])) {
      lines.push(`\t\t\t<meta name="${escapeXml(name)}" content="${escapeXml(content ?? '')}"/>`);
    }
  }
  return lines;
}

/**
 * Builds the NIMAS/OEB 1.2 Package Document (.opf) for `model`, following the structure of
 * the NIMAC/CAST corpus (web/test_corpus_cast): a <dc-metadata> block whose title/identifier/
 * language/date/format/rights/source/subject always have a value (falling back sensibly for
 * a document typed from scratch — see buildNimasPackage; rights/source/subject fall back to
 * empty content rather than a fabricated value, since NIMAS requires the elements but not
 * that they say anything) plus dc:Date's required @event="DCTERMS.created"; every x-metadata
 * meta the source carried (nimas-* and DCTERMS.*, repeats and empty content included) is
 * written back, topped up with any NIMAS-required entry that was missing (empty content).
 * @param {object} model
 * @param {{bookFile: string, items: Array<{id: string, href: string, mediaType: string}>, identifier?: string}} options
 * @returns {string} OPF XML string
 */
export function buildNimasOpf(model, options = {}) {
  const meta = (model && model.metadata && typeof model.metadata === 'object') ? model.metadata : {};
  const bookFile = options.bookFile;
  const items = options.items || [];
  const identifier = options.identifier || packageIdentifier(model);
  const idAttr = toNCName(identifier);
  const dcAttrs = (meta.dcAttrs && typeof meta.dcAttrs === 'object') ? meta.dcAttrs : {};

  const title = meta.title || model?.title || 'Untitled Document';
  const lang = meta.language || meta.lang || 'en';
  const date = options.date || meta.date || new Date().toISOString().slice(0, 10);
  const format = meta.format || 'NIMAS 1.1';
  const creator = meta.creator || meta.author || meta.docauthor || '';
  const publisher = meta.publisher || 'Emboss Braille Editor';   // matches nimas-export.mjs's dc:Publisher fallback
  // NIMAS requires the dc:Date/@event, dc:Creator/@role and dc:Identifier/@scheme attributes
  // NIMAC/CAST packages always carry; keep the source's own value, else the one every
  // sample package in web/test_corpus_cast uses.
  const dateEvent = dcAttrs.dateEvent || 'DCTERMS.created';
  const creatorRole = dcAttrs.creatorRole || 'author';
  const identifierScheme = dcAttrs.identifierScheme || 'NIMAS';

  const dc = [`\t\t\t<dc:Title>${escapeXml(title)}</dc:Title>`];
  if (creator) dc.push(`\t\t\t<dc:Creator role="${escapeXml(creatorRole)}">${escapeXml(creator)}</dc:Creator>`);
  dc.push(`\t\t\t<dc:Identifier id="${escapeXml(idAttr)}" scheme="${escapeXml(identifierScheme)}">${escapeXml(identifier)}</dc:Identifier>`);
  dc.push(`\t\t\t<dc:Date event="${escapeXml(dateEvent)}">${escapeXml(date)}</dc:Date>`);
  dc.push(`\t\t\t<dc:Language>${escapeXml(lang)}</dc:Language>`);
  dc.push(`\t\t\t<dc:Publisher>${escapeXml(publisher)}</dc:Publisher>`);
  dc.push(`\t\t\t<dc:Format>${escapeXml(format)}</dc:Format>`);
  // NIMAS's package-doc-common.sch requires dc:Rights/dc:Source/dc:Subject to be present
  // (both by RelaxNG shape and by its own asserts) — write them even when empty, rather
  // than fabricate content for a document that never had any.
  dc.push(`\t\t\t<dc:Rights>${escapeXml(meta.rights || '')}</dc:Rights>`);
  dc.push(`\t\t\t<dc:Source>${escapeXml(meta.source || '')}</dc:Source>`);
  dc.push(`\t\t\t<dc:Subject>${escapeXml(meta.subject || '')}</dc:Subject>`);

  const nimasSrc = {};
  if (meta.nimas && typeof meta.nimas === 'object') {
    for (const [k, v] of Object.entries(meta.nimas)) if (/^nimas-[A-Za-z0-9_.:-]+$/.test(k)) nimasSrc[k] = v;
  }
  const opfSrc = (meta.opfMeta && typeof meta.opfMeta === 'object') ? meta.opfMeta : {};
  const xMetadataLines = [...metaLines(nimasSrc, REQUIRED_NIMAS_METAS), ...metaLines(opfSrc, REQUIRED_DCTERMS_METAS)];
  const xMetadataXml = `\t\t<x-metadata>\n${xMetadataLines.join('\n')}\n\t\t</x-metadata>\n`;

  const bookItemId = 'nimasxmlfile';
  const manifestXml = [
    `\t\t<item id="${escapeXml(bookItemId)}" href="${escapeXml(bookFile)}" media-type="application/x-dtbook+xml"/>`,
    ...items.map((it) => `\t\t<item id="${escapeXml(it.id)}" href="${escapeXml(it.href)}" media-type="${escapeXml(it.mediaType)}"/>`),
  ].join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE package PUBLIC "+//ISBN 0-9673008-1-9//DTD OEB 1.2 Package//EN" "http://openebook.org/dtds/oeb-1.2/oebpkg12.dtd">
<package xmlns="http://openebook.org/namespaces/oeb-package/1.0/" unique-identifier="${escapeXml(idAttr)}" xml:lang="${escapeXml(lang)}">
\t<metadata>
\t\t<dc-metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:oebpackage="http://openebook.org/namespaces/oeb-package/1.0/">
${dc.join('\n')}
\t\t</dc-metadata>
${xMetadataXml}\t</metadata>
\t<manifest>
${manifestXml}
\t</manifest>
\t<spine>
\t\t<itemref idref="${escapeXml(bookItemId)}"/>
\t</spine>
</package>
`;
}

/**
 * Builds a full NIMAS package for `model`: the DTBook XML, its OPF, every image resource
 * still referenced by a graphic (at its package path), and any source PDF(s) carried on
 * model.resources (parse.mjs's role: 'source-pdf', from A3). A tactile graphic drawn in
 * Emboss (graphic.src is a data: URI) is written out as a file under images/ instead, with
 * the src rewritten to that path in the saved XML only — the live editor document, and the
 * `model` object passed in, are never mutated. Everything lives inside one `<id>/` folder,
 * `<id>` being the package identifier made file-name safe — the layout NIMAC/CAST packages
 * use (e.g. "9781930583733NIMAS/9781930583733NIMAS.xml").
 * @param {object} model
 * @param {object} [options] passed through to exportToNimasXml (lang, date, author…)
 * @returns {{ zipName: string, id: string, files: Array<{name: string, data: Uint8Array}> }}
 */
export function buildNimasPackage(model, options = {}) {
  const blocks = Array.isArray(model?.blocks) ? model.blocks : [];
  const resources = Array.isArray(model?.resources) ? model.resources : [];
  const identifier = packageIdentifier(model);
  const id = fileSafeId(identifier);

  // Package-relative image resources still referenced by a graphic (parseNimasZip left the
  // same path on graphic.src); anything no longer referenced is dropped from the save.
  const referencedPaths = new Set(
    collectGraphics(blocks).map((g) => g.src).filter((src) => src && !/^data:/i.test(src))
  );
  const usedImages = resources.filter((r) => r && r.role !== 'source-pdf' && r.path && r.bytes && referencedPaths.has(r.path));
  const sourcePdfs = resources.filter((r) => r && r.role === 'source-pdf' && r.path && r.bytes);

  const usedIds = new Set();
  const manifestItems = [];
  const resourceFiles = [];

  // Deep-clone the blocks so a data: graphic's src can be rewritten for the saved XML without
  // touching the live editor document (which keeps showing/drawing the original data: URI).
  const blocksForXml = JSON.parse(JSON.stringify(blocks));
  let dataGraphicN = 0;
  for (const g of collectGraphics(blocksForXml)) {
    if (!g.src || !/^data:/i.test(g.src)) continue;
    const decoded = decodeDataUri(g.src);
    if (!decoded) continue;
    dataGraphicN++;
    const ext = IMAGE_EXT_BY_MIME[decoded.mime] || 'bin';
    const relPath = `images/emboss-${dataGraphicN}.${ext}`;
    manifestItems.push({ id: makeItemId(relPath, usedIds), href: relPath, mediaType: decoded.mime });
    resourceFiles.push({ name: `${id}/${relPath}`, data: decoded.bytes });
    g.src = relPath;
  }
  for (const r of usedImages) {
    manifestItems.push({ id: makeItemId(r.path, usedIds), href: r.path, mediaType: r.mime || 'application/octet-stream' });
    resourceFiles.push({ name: `${id}/${r.path}`, data: r.bytes });
  }
  for (const r of sourcePdfs) {
    manifestItems.push({ id: makeItemId(r.path, usedIds), href: r.path, mediaType: 'application/pdf' });
    resourceFiles.push({ name: `${id}/${r.path}`, data: r.bytes });
  }

  const bookFile = `${id}.xml`;
  const opfFile = `${id}.opf`;
  // Pass the package identifier through as the uid so dtb:uid (DTBook) and dc:Identifier
  // (OPF) agree, even for a document typed from scratch (no metadata.uid/identifier yet).
  const xmlString = exportToNimasXml({ ...model, blocks: blocksForXml }, { uid: identifier, ...options });
  const opfString = buildNimasOpf(model, { bookFile, items: manifestItems, identifier, date: options.date });

  const files = [
    { name: `${id}/${bookFile}`, data: new TextEncoder().encode(xmlString) },
    { name: `${id}/${opfFile}`, data: new TextEncoder().encode(opfString) },
    ...resourceFiles,
  ];

  return { zipName: `${id}.zip`, id, files, imageCount: dataGraphicN + usedImages.length, pdfCount: sourcePdfs.length };
}

/**
 * buildNimasPackage, zipped. Uses web/zip.mjs's STORE-only writer (Blob) and reads it back as
 * bytes — Blob#arrayBuffer works in both the browser and Node 18+, so this stays test-usable
 * the same way parse.mjs's NIMAS-package tests build their zip fixtures.
 * @param {object} model
 * @param {object} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function buildNimasPackageZip(model, options = {}) {
  const { files } = buildNimasPackage(model, options);
  const blob = makeZip(files);
  return new Uint8Array(await blob.arrayBuffer());
}
