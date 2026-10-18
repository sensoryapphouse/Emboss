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
    else if (v.type === 'imgnote' && v.src) out.push(v);   // a picture kept inside a table cell (exported as the cell's own <img src>)
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

// ---- One allocator for every resource path in a saved package (audit batch S2b, items 6 and 7) ----
// Every file the package carries (pictures, source PDFs, and the book and OPF themselves) gets its name from here, so two of them can never
// share one: a resource an imported package already carried keeps its own name when that name is a clean path inside the package; one whose
// path is not (it climbs out with "../", is absolute, or has a character a reader would take for something else: % # ? \) is moved to
// images/<its file name>; a new picture gets images/emboss-N.<ext> with the first N not yet taken; a name already taken (compared without
// regard to letter case, as macOS and Windows unpack) gets -2, -3 ... before its extension.
const UNCLEAN_PATH_RE = /[%#?\\\x00-\x1f]/;
export function isCleanPackagePath(p) {
  if (typeof p !== 'string' || !p || p.startsWith('/') || /^[A-Za-z]:/.test(p) || UNCLEAN_PATH_RE.test(p)) return false;
  const parts = p.split('/');
  return parts.every((seg) => seg !== '' && seg !== '.' && seg !== '..' && seg.trim() === seg);
}
function resourceBaseName(p, fallback) {
  const last = String(p ?? '').replace(/\\/g, '/').split('/').pop() || '';
  const clean = last.replace(/[%#?\\\x00-\x1f]/g, '_').trim().replace(/^\.+/, '');
  return clean || fallback;
}
function makePathAllocator(reserved = []) {
  const taken = new Set(reserved.map((n) => n.toLowerCase()));
  const take = (wanted) => {
    let name = wanted, n = 2;
    const dot = wanted.lastIndexOf('.'), slash = wanted.lastIndexOf('/');
    const stem = dot > slash + 1 ? wanted.slice(0, dot) : wanted, ext = dot > slash + 1 ? wanted.slice(dot) : '';
    while (taken.has(name.toLowerCase())) name = `${stem}-${n++}${ext}`;
    taken.add(name.toLowerCase());
    return name;
  };
  return {
    /** An existing resource: its own clean path, else images/<file name> (dir: 'images' or '' for a source PDF), made unique. */
    existing(path, dir = 'images') { return take(isCleanPackagePath(path) ? path : `${dir ? `${dir}/` : ''}${resourceBaseName(path, 'resource')}`); },
    /** A new picture: images/emboss-N.<ext>, the first N whose name is free. */
    fresh(ext) { for (let n = 1; ; n++) { const name = `images/emboss-${n}.${ext}`; if (!taken.has(name.toLowerCase())) return take(name); } },
  };
}
/** Throws (a plain message, userFacing) if the files of a package would not unpack to exactly the files intended: two entries with one name
 *  (compared without regard to letter case), or a name that is absolute or climbs out of the package root. Never write such a zip. */
export function checkPackagePaths(files) {
  const seen = new Map();
  for (const f of files) {
    const name = String(f && f.name);
    const bad = !name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || /[\\\x00-\x1f]/.test(name) || name.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
    if (bad) { const e = new Error(`The package cannot be saved: it would contain a file with an unsafe path ("${name}"). The file was not written.`); e.userFacing = true; throw e; }
    const key = name.toLowerCase();
    if (seen.has(key)) { const e = new Error(`The package cannot be saved: it would contain a duplicate file name: two files called "${name}" and "${seen.get(key)}". The file was not written.`); e.userFacing = true; throw e; }
    seen.set(key, name);
  }
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
  const sourcePdfs = resources.filter((r) => r && r.role === 'source-pdf' && r.path && r.bytes);
  // A resource is found by its path; the first of two with one path is the one the graphics mean (the second is never written: it could
  // only be told apart from the first by its position, and the file it would be saved over is the first's).
  const seenResourcePaths = new Set();
  const usedImages = resources.filter((r) => {
    if (!r || r.role === 'source-pdf' || !r.path || !r.bytes || !referencedPaths.has(r.path) || seenResourcePaths.has(r.path)) return false;
    seenResourcePaths.add(r.path);
    return true;
  });

  const bookFile0 = `${id}.xml`, opfFile0 = `${id}.opf`;
  const alloc = makePathAllocator([bookFile0, opfFile0]);
  // Names first: the resources the package already has (so they keep theirs), then the new pictures.
  const finalPathOf = new Map();                       // an existing resource's path -> its path in this package (what graphic.src becomes)
  for (const r of usedImages) finalPathOf.set(r.path, alloc.existing(r.path, 'images'));
  const pdfPaths = new Map();
  for (const r of sourcePdfs) pdfPaths.set(r, alloc.existing(r.path, ''));

  const usedIds = new Set();
  const manifestItems = [];
  const resourceFiles = [];

  // Deep-clone the blocks so a data: graphic's src can be rewritten for the saved XML without
  // touching the live editor document (which keeps showing/drawing the original data: URI).
  const blocksForXml = JSON.parse(JSON.stringify(blocks));
  let dataGraphicN = 0;
  for (const g of collectGraphics(blocksForXml)) {
    if (!g.src) continue;
    if (!/^data:/i.test(g.src)) { if (finalPathOf.has(g.src)) g.src = finalPathOf.get(g.src); continue; }   // (rewritten to the path it was given: the same one for a clean name)
    const decoded = decodeDataUri(g.src);
    if (!decoded) continue;
    dataGraphicN++;
    const ext = IMAGE_EXT_BY_MIME[decoded.mime] || 'bin';
    const relPath = alloc.fresh(ext);
    manifestItems.push({ id: makeItemId(relPath, usedIds), href: relPath, mediaType: decoded.mime });
    resourceFiles.push({ name: `${id}/${relPath}`, data: decoded.bytes });
    g.src = relPath;
  }
  for (const r of usedImages) {
    const relPath = finalPathOf.get(r.path);
    manifestItems.push({ id: makeItemId(relPath, usedIds), href: relPath, mediaType: r.mime || 'application/octet-stream' });
    resourceFiles.push({ name: `${id}/${relPath}`, data: r.bytes });
  }
  for (const r of sourcePdfs) {
    const relPath = pdfPaths.get(r);
    manifestItems.push({ id: makeItemId(relPath, usedIds), href: relPath, mediaType: 'application/pdf' });
    resourceFiles.push({ name: `${id}/${relPath}`, data: r.bytes });
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
  // Never write a package that would unpack to other files than the ones meant: two entries with one name, or a path out of the root.
  checkPackagePaths(files);
  const hrefs = new Set();
  for (const it of manifestItems) {
    if (hrefs.has(it.href.toLowerCase())) { const e = new Error(`The package cannot be saved: its manifest would list "${it.href}" twice. The file was not written.`); e.userFacing = true; throw e; }
    hrefs.add(it.href.toLowerCase());
  }

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
