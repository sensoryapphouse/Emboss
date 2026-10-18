#!/usr/bin/env python3
"""Generates the hand-written Word (.docx) fixtures for Emboss/scripts/audit-import-fidelity.mjs.

    python3 Emboss/tests/fixtures/import-audit/make-docx-fixtures.py

Every file is authentic WordprocessingML / OMML written the way Word writes it (style ids
Heading1..6, w:numPr lists, m:func / m:d / m:nary equations ...), one small file per feature
group, written to ./docx/. Each feature paragraph contains a unique nonsense word (e.g.
"alphastrike") so the audit harness can find it again in the editor text, the saved NIMAS XML
and the braille without guessing.
"""
import os
import struct
import zlib
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'docx')
os.makedirs(OUT, exist_ok=True)

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" '
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" '
      'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
      'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" '
      'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" '
      'xmlns:v="urn:schemas-microsoft-com:vml" '
      'xmlns:o="urn:schemas-microsoft-com:office:office" '
      'mc:Ignorable="w14"')
XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# ---------------------------------------------------------------- paragraph / run helpers
def r(text='', rpr='', extra=''):
    """A run. `text` may be '' when `extra` (br, tab, footnoteReference ...) carries the content."""
    t = ('<w:t xml:space="preserve">%s</w:t>' % esc(text)) if text else ''
    return '<w:r>%s%s%s</w:r>' % (('<w:rPr>%s</w:rPr>' % rpr) if rpr else '', extra, t)


def p(*content, style=None, ppr=''):
    """A paragraph from runs (strings already XML) or plain text."""
    inner = ''.join(c if c.lstrip().startswith('<') else r(c) for c in content)
    pp = ''
    if style or ppr:
        pp = '<w:pPr>%s%s</w:pPr>' % (('<w:pStyle w:val="%s"/>' % style) if style else '', ppr)
    return '<w:p>%s%s</w:p>' % (pp, inner)


def li(text, num, lvl, style='ListParagraph', rpr=''):
    return p(r(text, rpr), style=style, ppr='<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>' % (lvl, num))


# ---------------------------------------------------------------- OMML helpers
def mr(t, sty=None):
    rp = ('<m:rPr><m:sty m:val="%s"/></m:rPr>' % sty) if sty else ''
    return '<m:r>%s<m:t>%s</m:t></m:r>' % (rp, esc(t))


def mfrac(n, d):
    return '<m:f><m:fPr><m:ctrlPr/></m:fPr><m:num>%s</m:num><m:den>%s</m:den></m:f>' % (n, d)


def mrad(body, deg=None):
    dp = '<m:radPr><m:degHide m:val="1"/><m:ctrlPr/></m:radPr>' if deg is None else '<m:radPr><m:ctrlPr/></m:radPr>'
    return '<m:rad>%s<m:deg>%s</m:deg><m:e>%s</m:e></m:rad>' % (dp, deg or '', body)


def msup(b, s):
    return '<m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr><m:e>%s</m:e><m:sup>%s</m:sup></m:sSup>' % (b, s)


def msub(b, s):
    return '<m:sSub><m:sSubPr><m:ctrlPr/></m:sSubPr><m:e>%s</m:e><m:sub>%s</m:sub></m:sSub>' % (b, s)


def msubsup(b, sb, sp):
    return '<m:sSubSup><m:sSubSupPr><m:ctrlPr/></m:sSubSupPr><m:e>%s</m:e><m:sub>%s</m:sub><m:sup>%s</m:sup></m:sSubSup>' % (b, sb, sp)


def mfunc(name, arg):
    return ('<m:func><m:funcPr><m:ctrlPr/></m:funcPr><m:fName>%s</m:fName><m:e>%s</m:e></m:func>'
            % (mr(name, 'p'), arg))


def mnary(chr_, sub, sup, body, limloc=None):
    lim = ('<m:limLoc m:val="%s"/>' % limloc) if limloc else ''
    return ('<m:nary><m:naryPr><m:chr m:val="%s"/>%s<m:ctrlPr/></m:naryPr><m:sub>%s</m:sub><m:sup>%s</m:sup><m:e>%s</m:e></m:nary>'
            % (chr_, lim, sub, sup, body))


def md(*items, beg='(', end=')', sep=None):
    dp = '<m:dPr><m:begChr m:val="%s"/>%s<m:endChr m:val="%s"/><m:ctrlPr/></m:dPr>' % (
        beg, ('<m:sepChr m:val="%s"/>' % sep) if sep else '', end)
    return '<m:d>%s%s</m:d>' % (dp, ''.join('<m:e>%s</m:e>' % i for i in items))


def mmat(rows):
    body = ''.join('<m:mr>%s</m:mr>' % ''.join('<m:e>%s</m:e>' % c for c in row) for row in rows)
    return '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="%d"/><m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs><m:ctrlPr/></m:mPr>%s</m:m>' % (len(rows[0]), body)


def macc(chr_, base):
    return '<m:acc><m:accPr><m:chr m:val="%s"/><m:ctrlPr/></m:accPr><m:e>%s</m:e></m:acc>' % (chr_, base)


def mlimlow(base, lim):
    return '<m:limLow><m:limLowPr><m:ctrlPr/></m:limLowPr><m:e>%s</m:e><m:lim>%s</m:lim></m:limLow>' % (base, lim)


def mbar(base):
    return '<m:bar><m:barPr><m:pos m:val="top"/><m:ctrlPr/></m:barPr><m:e>%s</m:e></m:bar>' % base


def meqarr(*rows):
    return '<m:eqArr><m:eqArrPr><m:ctrlPr/></m:eqArrPr>%s</m:eqArr>' % ''.join('<m:e>%s</m:e>' % x for x in rows)


def omath(body):
    return '<m:oMath>%s</m:oMath>' % body


def eqp(label, body, display=False):
    """A paragraph: label text then the equation (inline) or a display equation paragraph."""
    if display:
        return p(label) + '<w:p><m:oMathPara>%s</m:oMathPara></w:p>' % omath(body)
    return p(label + ' ', omath(body))


# ---------------------------------------------------------------- package parts
CT = {
    'rels': 'application/vnd.openxmlformats-package.relationships+xml',
    'xml': 'application/xml',
}
W_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.%s+xml'

STYLES = XML + '''<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="3"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="4"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="5"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="864" w:right="864"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="IntenseQuote"><w:name w:val="Intense Quote"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="864" w:right="864"/></w:pPr><w:rPr><w:b/><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="BlockText"><w:name w:val="Block Text"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="1440" w:right="1440"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:i/><w:sz w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="TOC1"><w:name w:val="toc 1"/><w:basedOn w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="SourceCode"><w:name w:val="Source Code"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/></w:rPr></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/></w:style>
<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:qFormat/><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:qFormat/><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>'''


def lvl(i, fmt, text, left, hanging=360, font=None, pstyle=None, start=1, islgl=False):
    rf = ('<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s" w:hint="default"/></w:rPr>' % (font, font)) if font else ''
    ps = ('<w:pStyle w:val="%s"/>' % pstyle) if pstyle else ''
    return ('<w:lvl w:ilvl="%d"><w:start w:val="%d"/><w:numFmt w:val="%s"/>%s%s<w:lvlText w:val="%s"/><w:lvlJc w:val="left"/>'
            '<w:pPr><w:ind w:left="%d" w:hanging="%d"/></w:pPr>%s</w:lvl>'
            % (i, start, fmt, ps, '<w:isLgl/>' if islgl else '', text, left, hanging, rf))


def abstract(aid, levels, multi='multilevel'):
    return '<w:abstractNum w:abstractNumId="%d"><w:multiLevelType w:val="%s"/>%s</w:abstractNum>' % (aid, multi, ''.join(levels))


SYM_BULLET = '\uf0b7'   # Word's Symbol-font bullet, stored as a private-use char
WD_SQUARE = '\uf0a7'    # Wingdings small square
NUMBERING = XML + '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + ''.join([
    # 0: Word's default multilevel bullets: Symbol bullet, Courier o, Wingdings square
    abstract(0, [lvl(0, 'bullet', SYM_BULLET, 720, font='Symbol'), lvl(1, 'bullet', 'o', 1440, font='Courier New'),
                 lvl(2, 'bullet', WD_SQUARE, 2160, font='Wingdings')] + [lvl(i, 'bullet', SYM_BULLET, 720 * (i + 1), font='Symbol') for i in range(3, 9)]),
    # 1: decimal / lowerLetter / lowerRoman
    abstract(1, [lvl(0, 'decimal', '%1.', 720), lvl(1, 'lowerLetter', '%2.', 1440), lvl(2, 'lowerRoman', '%3.', 2160, hanging=180)]
             + [lvl(i, 'decimal', '%' + str(i + 1) + '.', 720 * (i + 1)) for i in range(3, 9)]),
    # 2: legal 1. / 1.1 / 1.1.1
    abstract(2, [lvl(0, 'decimal', '%1.', 432), lvl(1, 'decimal', '%1.%2', 576, hanging=576, islgl=True),
                 lvl(2, 'decimal', '%1.%2.%3', 720, hanging=720, islgl=True)] + [lvl(i, 'decimal', '%' + str(i + 1) + '.', 720 * (i + 1)) for i in range(3, 9)]),
    # 3: custom bullets (arrow, tick, dash) in ordinary fonts
    abstract(3, [lvl(0, 'bullet', '➢', 720, font='Arial'), lvl(1, 'bullet', '✓', 1440, font='Arial'),
                 lvl(2, 'bullet', '–', 2160, font='Arial')] + [lvl(i, 'bullet', '•', 720 * (i + 1), font='Arial') for i in range(3, 9)]),
    # 4: outline-numbered headings (Heading1 -> "1", Heading2 -> "1.1")
    abstract(4, [lvl(0, 'decimal', '%1', 432, pstyle='Heading1'), lvl(1, 'decimal', '%1.%2', 576, pstyle='Heading2'),
                 lvl(2, 'decimal', '%1.%2.%3', 720, pstyle='Heading3')] + [lvl(i, 'decimal', '%' + str(i + 1) + '.', 720 * (i + 1)) for i in range(3, 9)]),
    # 5: upperLetter "(A)" / upperRoman "I)" / decimal "1)"
    abstract(5, [lvl(0, 'upperLetter', '(%1)', 720), lvl(1, 'upperRoman', '%2)', 1440), lvl(2, 'decimal', '%3)', 2160)]
             + [lvl(i, 'decimal', '%' + str(i + 1) + '.', 720 * (i + 1)) for i in range(3, 9)]),
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
    '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>',
    '<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>',
    '<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>',
    '<w:num w:numId="5"><w:abstractNumId w:val="3"/></w:num>',
    '<w:num w:numId="6"><w:abstractNumId w:val="4"/></w:num>',
    '<w:num w:numId="7"><w:abstractNumId w:val="5"/></w:num>',
    '<w:num w:numId="8"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>',
]) + '</w:numbering>'

SETTINGS = XML + '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/></w:settings>'


def png_bytes(w=8, h=8, rgb=(200, 30, 30)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def build(name, body, *, numbering=False, notes=None, comments=None, extra_parts=None, extra_rels=None,
          sect='', core_title=None, styles=STYLES, images=None):
    """Write docx/<name>.docx. `notes` = (footnotes_xml_inner, endnotes_xml_inner)."""
    parts = {}
    ct = ['<Default Extension="rels" ContentType="%s"/>' % CT['rels'], '<Default Extension="xml" ContentType="%s"/>' % CT['xml'],
          '<Default Extension="png" ContentType="image/png"/>',
          '<Override PartName="/word/document.xml" ContentType="%s"/>' % (W_CT % 'document.main'),
          '<Override PartName="/word/styles.xml" ContentType="%s"/>' % (W_CT % 'styles'),
          '<Override PartName="/word/settings.xml" ContentType="%s"/>' % (W_CT % 'settings')]
    rels = ['<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>']
    if numbering:
        parts['word/numbering.xml'] = NUMBERING
        ct.append('<Override PartName="/word/numbering.xml" ContentType="%s"/>' % (W_CT % 'numbering'))
        rels.append('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>')
    if notes:
        fn, en = notes
        sep = ('<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
               '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>')
        sepe = sep.replace('w:footnote', 'w:endnote')
        parts['word/footnotes.xml'] = XML + '<w:footnotes %s>%s%s</w:footnotes>' % (NS, sep, fn)
        parts['word/endnotes.xml'] = XML + '<w:endnotes %s>%s%s</w:endnotes>' % (NS, sepe, en)
        ct.append('<Override PartName="/word/footnotes.xml" ContentType="%s"/>' % (W_CT % 'footnotes'))
        ct.append('<Override PartName="/word/endnotes.xml" ContentType="%s"/>' % (W_CT % 'endnotes'))
        rels.append('<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>')
        rels.append('<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>')
    if comments:
        parts['word/comments.xml'] = XML + '<w:comments %s>%s</w:comments>' % (NS, comments)
        ct.append('<Override PartName="/word/comments.xml" ContentType="%s"/>' % (W_CT % 'comments'))
        rels.append('<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>')
    for pn, (content, ctype, rtype, rid) in (extra_parts or {}).items():
        parts[pn] = content
        ct.append('<Override PartName="/%s" ContentType="%s"/>' % (pn, ctype))
        rels.append('<Relationship Id="%s" Type="%s" Target="%s"/>' % (rid, rtype, pn.replace('word/', '')))
    for rid, typ, target, mode in (extra_rels or []):
        rels.append('<Relationship Id="%s" Type="%s" Target="%s"%s/>' % (rid, typ, target, (' TargetMode="%s"' % mode) if mode else ''))
    for n, data in (images or {}).items():
        parts['word/media/' + n] = data
    if core_title:
        parts['docProps/core.xml'] = (XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
                                      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
                                      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>%s</dc:title><dc:creator>Audit Author</dc:creator>'
                                      '<dc:language>en-GB</dc:language></cp:coreProperties>' % esc(core_title))
        ct.append('<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>')
    doc = XML + '<w:document %s><w:body>%s%s</w:body></w:document>' % (NS, body, sect or '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
    with zipfile.ZipFile(os.path.join(OUT, name + '.docx'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">%s</Types>' % ''.join(ct))
        root_rels = '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        if core_title:
            root_rels += '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        z.writestr('_rels/.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % root_rels)
        z.writestr('word/document.xml', doc)
        z.writestr('word/_rels/document.xml.rels', XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % ''.join(rels))
        z.writestr('word/styles.xml', styles)
        z.writestr('word/settings.xml', SETTINGS)
        for pn, data in parts.items():
            z.writestr(pn, data)


# ================================================================== the fixtures
# ---- w01 headings + title styles
build('w01-headings', ''.join([
    p('Main title alphatitle', style='Title'),
    p('Sub title alphasubtitle', style='Subtitle'),
    p('Heading one alphah1', style='Heading1'),
    p('Heading two alphah2', style='Heading2'),
    p('Heading three alphah3', style='Heading3'),
    p('Heading four alphah4', style='Heading4'),
    p('Heading five alphah5', style='Heading5'),
    p('Heading six alphah6', style='Heading6'),
    p('Body text after the headings.'),
    # a heading made by hand: bold 16pt Normal paragraph (no style) - Word users do this a lot
    p(r('Fake heading alphafake', '<w:b/><w:sz w:val="32"/>')),
    p('A paragraph with an outline level but Normal style.', ppr='<w:outlineLvl w:val="1"/>'),
], ), core_title='Audit headings document')

# ---- w02 inline character formatting
build('w02-inline', ''.join([
    p('Plain: ', r('alphabold', '<w:b/>'), ' ', r('alphaitalic', '<w:i/>'), ' ', r('alphaunder', '<w:u w:val="single"/>'),
      ' ', r('alphabolditalic', '<w:b/><w:i/>')),
    p('Underline kinds: ', r('alphadouble', '<w:u w:val="double"/>'), ' ', r('alphadotted', '<w:u w:val="dotted"/>'), ' ',
      r('alphawavy', '<w:u w:val="wave"/>'), ' ', r('alphawords', '<w:u w:val="words"/>'), ' ', r('alphathick', '<w:u w:val="thick"/>')),
    p('Strike: ', r('alphastrike', '<w:strike/>'), ' and ', r('alphadstrike', '<w:dstrike/>')),
    p('Scripts: H', r('2', '<w:vertAlign w:val="subscript"/>'), 'O and x', r('2', '<w:vertAlign w:val="superscript"/>'),
      ' and ', r('alphasubword', '<w:vertAlign w:val="subscript"/>'), ' and ', r('alphasupword', '<w:vertAlign w:val="superscript"/>')),
    p('Caps: ', r('alphasmallcaps', '<w:smallCaps/>'), ' ', r('alphaallcaps', '<w:caps/>')),
    p('Hidden: before ', r('alphahidden', '<w:vanish/>'), ' after'),
    p('Colour and highlight: ', r('alphahighlight', '<w:highlight w:val="yellow"/>'), ' ', r('alphacolour', '<w:color w:val="FF0000"/>'),
      ' ', r('alphashade', '<w:shd w:val="clear" w:color="auto" w:fill="DDDDDD"/>')),
    p('Character styles: ', r('alphastrong', '<w:rStyle w:val="Strong"/>'), ' ', r('alphaemphasis', '<w:rStyle w:val="Emphasis"/>')),
    p('Fonts: ', r('alphamono', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>'), ' ',
      r('alphascriptfont', '<w:rFonts w:ascii="Brush Script MT" w:hAnsi="Brush Script MT"/>'), ' ',
      r('alphaoutline', '<w:outline/>'), ' ', r('alphaemboss', '<w:emboss/>'), ' ', r('alphashadow', '<w:shadow/>')),
    p('Emphasis mix: ', r('alphabold', '<w:b/>'), r(' run on ', ''), r('alphabi', '<w:b/><w:i/><w:u w:val="single"/>')),
]), core_title='Audit inline formatting')

# ---- w03 symbols / emoji / special characters
build('w03-symbols', ''.join([
    p('Symbol font: ', r('', '<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>', '<w:sym w:font="Symbol" w:char="F061"/>'),
      ' alphasymfont ', r('', '', '<w:sym w:font="Wingdings" w:char="F0FC"/>'), ' alphawingtick ',
      r('', '', '<w:sym w:font="Wingdings" w:char="F0E8"/>'), ' alphawingarrow'),
    p('Private-use text: ', r('\uf0b7', '<w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/>'), ' alphapuabullet ',
      r('\uf0d8', '<w:rFonts w:ascii="Wingdings" w:hAnsi="Wingdings"/>'), ' alphapuawing'),
    p('Emoji: alphaemoji \U0001F600 and \U0001F44D and ❤️ and flag \U0001F1EC\U0001F1E7 end'),
    p('Punctuation: © ® ™ § ¶ † ‡ • … “quoted” ‘single’ — – alphapunct'),
    p('Maths symbols in text: ± × ÷ ≤ ≥ ≠ ∞ π α β alphamathsym'),
    p('Currency: £ € ¥ ¢ $ alphacurrency'),
    p('Fractions: ½ ¼ ¾ and ⅓ alphafraction'),
    p('Arrows and boxes: → ← ↔ ☑ ☐ ✓ ✗ alphaarrows'),
]))

# ---- w04 hyperlinks and fields
def fld(instr, result, rpr=''):
    return (r('', rpr, '<w:fldChar w:fldCharType="begin"/>') + r('', rpr, '<w:instrText xml:space="preserve"> %s </w:instrText>' % instr)
            + r('', rpr, '<w:fldChar w:fldCharType="separate"/>') + r(result, rpr) + r('', rpr, '<w:fldChar w:fldCharType="end"/>'))

build('w04-links-fields', ''.join([
    p('External: ', '<w:hyperlink r:id="rIdLink1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>alphalink text</w:t></w:r></w:hyperlink>', ' after.'),
    p('Internal: ', '<w:hyperlink w:anchor="target1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>alphainternal jump</w:t></w:r></w:hyperlink>', ' after.'),
    p('Bare URL: https://example.org/alphabare end.'),
    p('Mail: ', '<w:hyperlink r:id="rIdLink2"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>alphamail me</w:t></w:r></w:hyperlink>'),
    p('<w:bookmarkStart w:id="1" w:name="target1"/>', 'Bookmark target alphatarget', '<w:bookmarkEnd w:id="1"/>'),
    # TOC as Word writes it: an sdt docPartObj with a complex field
    '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>'
    + p(r('Contents', '<w:b/>'), style='TOC1')
    + p(r('', '', '<w:fldChar w:fldCharType="begin"/>'), r('', '', '<w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText>'),
        r('', '', '<w:fldChar w:fldCharType="separate"/>'), r('Heading alphatoc1\t3'), style='TOC1')
    + p(r('Second alphatoc2\t4'), style='TOC1')
    + p(r('', '', '<w:fldChar w:fldCharType="end"/>'))
    + '</w:sdtContent></w:sdt>',
    p('Page number field: page ', fld('PAGE', '7'), ' of ', fld('NUMPAGES', '9'), ' alphapagefield'),
    p('Date field: ', fld('DATE \\@ "d MMMM yyyy"', '30 September 2026'), ' alphadatefield'),
    p('Cross reference: see ', fld('REF target1 \\h', 'Bookmark target alphatarget'), ' alphareffield'),
    p('Simple field: ', '<w:fldSimple w:instr=" AUTHOR "><w:r><w:t>Audit Author alphasimplefield</w:t></w:r></w:fldSimple>'),
    p('Footnote-style SEQ: Figure ', fld('SEQ Figure \\* ARABIC', '1'), ' alphaseq'),
]), extra_rels=[('rIdLink1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'https://example.org/alpha', 'External'),
                ('rIdLink2', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'mailto:alpha@example.org', 'External')])

# ---- w05 footnotes / endnotes / comments
FN = lambda i, t, extra='': ('<w:footnote w:id="%d"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>'
                              '<w:r><w:t xml:space="preserve"> %s</w:t></w:r></w:p>%s</w:footnote>' % (i, esc(t), extra))
EN = lambda i, t: ('<w:endnote w:id="%d"><w:p><w:pPr><w:pStyle w:val="EndnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteRef/></w:r>'
                   '<w:r><w:t xml:space="preserve"> %s</w:t></w:r></w:p></w:endnote>' % (i, esc(t)))
fnref = lambda i: '<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="%d"/></w:r>' % i
enref = lambda i: '<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="%d"/></w:r>' % i
build('w05-notes-comments', ''.join([
    p('First sentence with a footnote', fnref(1), ' and more text alphafirst.'),
    p('Second with an endnote', enref(1), ' and more alphasecond.'),
    p('Third with a two-paragraph footnote', fnref(2), ' alphathird.'),
    p('Fourth with a custom mark', '<w:r><w:footnoteReference w:customMarkFollows="1" w:id="3"/></w:r>', r('*'), ' alphafourth.'),
    p('Fifth has a comment ', '<w:commentRangeStart w:id="0"/>', r('alphacommented'), '<w:commentRangeEnd w:id="0"/>',
      '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>', ' end.'),
]), notes=(FN(1, 'Footnote one text alphafootnoteone.') + FN(2, 'Footnote two first paragraph alphafootnotetwo.',
                                                        '<w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:t>Footnote two second paragraph alphafootnotetwob.</w:t></w:r></w:p>')
           + FN(3, 'Custom mark note alphafootnotestar.'), EN(1, 'Endnote text alphaendnoteone.')),
    comments='<w:comment w:id="0" w:author="Reviewer" w:date="2026-09-30T10:00:00Z" w:initials="R"><w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>'
             '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r><w:r><w:t>Comment body alphacommentbody.</w:t></w:r></w:p></w:comment>')

# ---- w06 tracked changes
D = 'w:id="%d" w:author="Editor" w:date="2026-09-30T09:00:00Z"'
build('w06-tracked', ''.join([
    p('Accepted view: keep ', '<w:ins %s><w:r><w:t>alphainserted</w:t></w:r></w:ins>' % (D % 1), ' and ',
      '<w:del %s><w:r><w:delText>alphadeleted</w:delText></w:r></w:del>' % (D % 2), ' tail.'),
    p('Moved: ', '<w:moveFromRangeStart w:id="10" w:name="move1"/><w:moveFrom %s><w:r><w:t>alphamovedfrom</w:t></w:r></w:moveFrom><w:moveFromRangeEnd w:id="10"/>' % (D % 3),
      ' middle ', '<w:moveToRangeStart w:id="11" w:name="move1"/><w:moveTo %s><w:r><w:t>alphamovedto</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="11"/>' % (D % 4)),
    # a whole paragraph deleted including its mark
    '<w:p><w:pPr><w:rPr><w:del %s/></w:rPr></w:pPr><w:del %s><w:r><w:delText>alphawholedeleted paragraph</w:delText></w:r></w:del></w:p>' % (D % 5, D % 6),
    p('Kept paragraph after the deleted one alphakept.'),
    p('Format change: ', '<w:r><w:rPr><w:b/><w:rPrChange %s><w:rPr/></w:rPrChange></w:rPr><w:t>alphaformatchange</w:t></w:r>' % (D % 7)),
    # a whole inserted paragraph
    '<w:p><w:pPr><w:rPr><w:ins %s/></w:rPr></w:pPr><w:ins %s><w:r><w:t>alphawholeinserted paragraph</w:t></w:r></w:ins></w:p>' % (D % 8, D % 9),
]))

# ---- w07 breaks, tabs, special spaces/hyphens
build('w07-breaks-tabs', ''.join([
    p('Line one alphalinebreak', '<w:r><w:br/></w:r>', 'line two after the line break.'),
    p('Before page break alphabefore'),
    p('<w:r><w:br w:type="page"/></w:r>', 'After page break alphaafter'),
    p('Column break alphacolbefore', '<w:r><w:br w:type="column"/></w:r>', 'alphacolafter'),
    p('Tab: left', r('', '', '<w:tab/>'), 'right alphatab'),
    p('Two tabs', r('', '', '<w:tab/><w:tab/>'), 'alphatabs2'),
    p('Non-breaking space: a b alphanbsp and non-breaking hyphen: ', r('', '', '<w:noBreakHyphen/>'), 'alphanbhyphen end'),
    p('Soft hyphen: hy', r('', '', '<w:softHyphen/>'), 'phenation and also U+00AD hy\u00adphen alphasofthyphen'),
    p('Rendered page break: before', '<w:r><w:lastRenderedPageBreak/><w:t>alpharendered</w:t></w:r>'),
    p('Page break before style', ppr='<w:pageBreakBefore/>'),
    p('Keep with next alphakeep', ppr='<w:keepNext/>'),
    p('Wrapped clear break', '<w:r><w:br w:type="textWrapping" w:clear="all"/></w:r>', 'alphaclear'),
    p('Empty paragraphs follow.'), p(), p(), p('After two empty paragraphs alphaempty'),
    p('Non-breaking space only paragraph follows.'), p(' '), p('After nbsp-only paragraph alphanbspgap'),
]))

# ---- w08 lists
build('w08-lists', ''.join([
    p('Bullets (Symbol/Courier/Wingdings):', style='Heading2'),
    li('alphabullet1', 1, 0), li('alphabullet2', 1, 1), li('alphabullet3', 1, 2), li('alphabullet4', 1, 0),
    p('Numbered multilevel 1 / a / i:', style='Heading2'),
    li('alphanum1', 2, 0), li('alphanum2', 2, 1), li('alphanum3', 2, 2), li('alphanum4', 2, 2), li('alphanum5', 2, 1), li('alphanum6', 2, 0),
    p('Restarted list (new num, start 1):', style='Heading2'),
    li('alpharestart1', 3, 0), li('alpharestart2', 3, 0),
    p('Interrupting paragraph, then the first list continues:', style='Heading2'),
    li('alphacont1', 2, 0), p('Interrupting normal paragraph alphainterrupt.'), li('alphacont2', 2, 0),
    p('Start-at-5 list:', style='Heading2'),
    li('alphastart5a', 8, 0), li('alphastart5b', 8, 0),
    p('Legal numbering:', style='Heading2'),
    li('alphalegal1', 4, 0), li('alphalegal11', 4, 1), li('alphalegal111', 4, 2), li('alphalegal112', 4, 2), li('alphalegal12', 4, 1), li('alphalegal2', 4, 0),
    p('Custom bullet characters (arrow / tick / dash):', style='Heading2'),
    li('alphacustom1', 5, 0), li('alphacustom2', 5, 1), li('alphacustom3', 5, 2),
    p('Upper alpha / roman / decimal paren:', style='Heading2'),
    li('alphaupper1', 7, 0), li('alphaupper2', 7, 1), li('alphaupper3', 7, 2),
    p('Bold run in list items and a multi-paragraph item:', style='Heading2'),
    li('alphamulti1', 2, 0, rpr='<w:b/>'),
    p('Second paragraph of item one alphamultib.', ppr='<w:ind w:left="720"/>'),
    li('alphamulti2', 2, 0),
]), numbering=True)

# ---- w09 outline-numbered headings
build('w09-numbered-headings', ''.join([
    li('Numbered chapter alphach1', 6, 0, style='Heading1'),
    li('Numbered section alphasec11', 6, 1, style='Heading2'),
    li('Numbered subsection alphasub111', 6, 2, style='Heading3'),
    li('Numbered section alphasec12', 6, 1, style='Heading2'),
    li('Numbered chapter alphach2', 6, 0, style='Heading1'),
    p('Body text.'),
]), numbering=True)

# ---- w10 paragraph layout
build('w10-paragraph-layout', ''.join([
    p('Centred alphacentre', ppr='<w:jc w:val="center"/>'),
    p('Right aligned alpharight', ppr='<w:jc w:val="right"/>'),
    p('Justified alphajustify text that runs on for a bit so that it wraps across more than one line when laid out in the page.', ppr='<w:jc w:val="both"/>'),
    p('Indented left alphaindent', ppr='<w:ind w:left="1440"/>'),
    p('First line indent alphafirstline', ppr='<w:ind w:firstLine="720"/>'),
    p('Hanging indent alphahanging with extra text to wrap onto a second line in the page.', ppr='<w:ind w:left="720" w:hanging="720"/>'),
    p('Block quote (Quote style) alphaquote', style='Quote'),
    p('Intense quote alphaintense', style='IntenseQuote'),
    p('Block text style alphablocktext', style='BlockText'),
    p('Wide indent on both sides alphaboth', ppr='<w:ind w:left="1440" w:right="1440"/>'),
    p('Source code paragraph alphacode', style='SourceCode'),
    p(r('Direct Courier paragraph alphacourier', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>')),
    p('Right-to-left: ', r('שלום עולם', '<w:rtl/>'), ' alpharegular end', ppr='<w:bidi/>'),
    p('Arabic: ', r('مرحبا بالعالم', '<w:rtl/><w:lang w:bidi="ar-SA"/>'), ' alphaarabic'),
    p('French: ', r('Bonjour le monde alphafrench', '<w:lang w:val="fr-FR"/>'), ' then Spanish ', r('Hola el mundo alphaspanish', '<w:lang w:val="es-ES"/>')),
    p('Greek: ', r('Αθήνα alphagreek', '<w:lang w:val="el-GR"/>')),
    p('Drop cap paragraph follows.'),
    '<w:p><w:pPr><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/></w:pPr><w:r><w:rPr><w:sz w:val="96"/></w:rPr><w:t>D</w:t></w:r></w:p>'
    + p('rop cap continues here alphadropcap with enough words to fill the line.'),
]))

# ---- w11 boxes, borders, shading, text boxes
BORDER = '<w:pBdr>' + ''.join('<w:%s w:val="single" w:sz="8" w:space="4" w:color="000000"/>' % s for s in ('top', 'left', 'bottom', 'right')) + '</w:pBdr>'
build('w11-boxes', ''.join([
    p('Boxed paragraph (all four borders) alphabordered', ppr=BORDER),
    p('Two-paragraph box first alphabox1', ppr=BORDER.replace('w:sz="8"', 'w:sz="12"')),
    p('Two-paragraph box second alphabox2', ppr=BORDER.replace('w:sz="8"', 'w:sz="12"')),
    p('Shaded paragraph alphashaded', ppr='<w:shd w:val="clear" w:color="auto" w:fill="FFFF99"/>'),
    p('Bottom border only (a rule) alpharule', ppr='<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr>'),
    # single-cell table used as a box
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="9026"/></w:tblGrid>'
    '<w:tr><w:tc><w:tcPr><w:tcW w:w="9026" w:type="dxa"/></w:tcPr>' + p(r('Sidebar title alphasidebar', '<w:b/>')) + p('Sidebar text alphasidebartext.') + '</w:tc></w:tr></w:tbl>',
    p('After the single-cell box.'),
    # a DrawingML text box (Word 2010+): mc:AlternateContent with a VML fallback
    '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
    '<wp:extent cx="2000000" cy="900000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/><wp:docPr id="10" name="Text Box 1"/><wp:cNvGraphicFramePr/>'
    '<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="900000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></wps:spPr>'
    '<wps:txbx><w:txbxContent>' + p('Text box contents alphatextbox') + '</w:txbxContent></wps:txbx><wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>'
    '<mc:Fallback><w:pict><v:shape id="_x0000_s1026" type="#_x0000_t202" style="position:absolute;width:157pt;height:71pt"><v:textbox><w:txbxContent>' + p('Text box contents alphatextbox') + '</w:txbxContent></v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>'
    + r('Paragraph carrying the text box alphacarrier') + '</w:p>',
    # frame (legacy): paragraph with framePr
    '<w:p><w:pPr><w:framePr w:w="3000" w:h="600" w:hRule="exact" w:wrap="around" w:vAnchor="text" w:hAnchor="margin" w:y="1"/></w:pPr><w:r><w:t>Framed paragraph alphaframe</w:t></w:r></w:p>',
    p('Last paragraph alphalast.'),
]))

# ---- w12 tables
def tc(content, w=2000, span=None, vmerge=None, shade=None, extra=''):
    pr = '<w:tcW w:w="%d" w:type="dxa"/>' % w
    if span:
        pr += '<w:gridSpan w:val="%d"/>' % span
    if vmerge is not None:
        pr += '<w:vMerge w:val="restart"/>' if vmerge == 'restart' else '<w:vMerge/>'
    if shade:
        pr += '<w:shd w:val="clear" w:color="auto" w:fill="%s"/>' % shade
    body = content if content.startswith('<w:p') or content.startswith('<w:tbl') else p(content)
    if body.startswith('<w:tbl'):
        body += '<w:p/>'
    return '<w:tc><w:tcPr>%s%s</w:tcPr>%s</w:tc>' % (pr, extra, body)


def tr(*cells, header=False):
    return '<w:tr>%s%s</w:tr>' % (('<w:trPr><w:tblHeader/></w:trPr>' if header else ''), ''.join(cells))


def tbl(*rows, cols=3, grid=None, w=2000):
    g = grid or [w] * cols
    return ('<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
            '<w:tblGrid>%s</w:tblGrid>%s</w:tbl>' % (''.join('<w:gridCol w:w="%d"/>' % x for x in g), ''.join(rows)))


build('w12-tables', ''.join([
    p('Table 1: simple with a repeat-header row', style='Heading2'),
    tbl(tr(tc('alphaH1'), tc('alphaH2'), tc('alphaH3'), header=True), tr(tc('a1'), tc('a2'), tc('a3')), tr(tc('b1'), tc('b2'), tc('b3'))),
    p('Table 2: header made only by bold', style='Heading2'),
    tbl(tr(tc(p(r('alphaBoldH1', '<w:b/>'))), tc(p(r('alphaBoldH2', '<w:b/>'))), tc(p(r('alphaBoldH3', '<w:b/>')))), tr(tc('c1'), tc('c2'), tc('c3'))),
    p('Table 3: horizontal merge (gridSpan 2) and vertical merge', style='Heading2'),
    tbl(tr(tc('alphaSpanHead', w=4000, span=2), tc('alphaH3b'), header=True),
        tr(tc('alphaVM', vmerge='restart'), tc('d2'), tc('d3')),
        tr(tc('', vmerge='cont'), tc('e2'), tc('e3')),
        tr(tc('f1'), tc('alphaSpan2', w=4000, span=2))),
    p('Table 4: empty cells', style='Heading2'),
    tbl(tr(tc('alphaE1'), tc('alphaE2'), tc('alphaE3'), header=True), tr(tc(''), tc('g2'), tc('')), tr(tc('h1'), tc(''), tc('h3'))),
    p('Table 5: nested table', style='Heading2'),
    tbl(tr(tc('alphaOuter1', w=4500), tc(tbl(tr(tc('alphaInner1', w=1500), tc('alphaInner2', w=1500)), cols=2, w=1500), w=4500)), cols=2, w=4500),
    p('Table 6: with a caption above and below', style='Heading2'),
    p('Table 6. Caption above alphacapabove', style='Caption'),
    tbl(tr(tc('alphaC1'), tc('alphaC2'), header=True), tr(tc('i1'), tc('i2')), cols=2),
    p('Caption below alphacapbelow', style='Caption'),
    p('Table 7: multi-paragraph cell, list in cell, formatted text', style='Heading2'),
    tbl(tr(tc(p('alphaPara1') + p('alphaPara2'), w=3000),
           tc(li('alphaCellList1', 2, 0) + li('alphaCellList2', 2, 0), w=3000),
           tc(p(r('alphaBoldCell', '<w:b/>'), ' ', r('alphaItalicCell', '<w:i/>')), w=3000)), cols=3, w=3000),
    p('Table 8: shaded header and numbers (numeric columns)', style='Heading2'),
    tbl(tr(tc('Item', shade='CCCCCC'), tc('alphaPrice', shade='CCCCCC'), tc('Qty', shade='CCCCCC'), header=True),
        tr(tc('Apple'), tc('1.50'), tc('12')), tr(tc('Pear'), tc('10.25'), tc('3')), cols=3),
    p('Table 9: a wide table with 8 columns', style='Heading2'),
    tbl(tr(*[tc('alphaW%d' % i, w=1000) for i in range(1, 9)], header=True), tr(*[tc('w%d' % i, w=1000) for i in range(1, 9)]), cols=8, w=1000),
]), numbering=True)

# ---- w13 images
img = png_bytes()
def inline_img(rid, docpr_id, name, descr=None, title=None):
    d = (' descr="%s"' % esc(descr)) if descr is not None else ''
    t = (' title="%s"' % esc(title)) if title is not None else ''
    return ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
            '<wp:docPr id="%d" name="%s"%s%s/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>'
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="%s.png"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
            % (docpr_id, name, d, t, name, rid))


def anchor_img(rid, docpr_id, name, descr):
    return ('<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251658240" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">'
            '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>'
            '<wp:extent cx="914400" cy="914400"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>'
            '<wp:docPr id="%d" name="%s" descr="%s"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
            '<pic:nvPicPr><pic:cNvPr id="0" name="%s.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>'
            % (docpr_id, name, esc(descr), name, rid))


IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
build('w13-images', ''.join([
    p('Image with alt text:'), p(inline_img('rIdImg1', 1, 'Picture 1', descr='alphaalttext a red square')),
    p('Image with a title and alt text:'), p(inline_img('rIdImg1', 2, 'Picture 2', descr='alphatitlealt blue circle', title='alphatitle')),
    p('Image with no alt text:'), p(inline_img('rIdImg1', 3, 'Picture 3')),
    p('Image with captions:'), p(inline_img('rIdImg1', 4, 'Picture 4', descr='alphacapimg figure')),
    p('Figure ', fld('SEQ Figure \\* ARABIC', '1'), ': alphacaption text for the figure', style='Caption'),
    p('Floating image:', ), p('Text next to the floating picture alphafloat. ', anchor_img('rIdImg1', 5, 'Picture 5', 'alphafloatalt small image')),
    p('Image inline within a sentence: before ', inline_img('rIdImg1', 6, 'Picture 6', descr='alphainlinealt'), ' after alphainlinetext.'),
]), extra_rels=[('rIdImg1', IMG_REL, 'media/image1.png', None)], images={'image1.png': img})

# ---- w14 equations: each in its own paragraph. label + OMML
x = mr('x'); y = mr('y'); a = mr('a'); b = mr('b'); n = mr('n'); two = mr('2')
eqs = [
    ('EQfrac', mfrac(mr('1'), mr('2')), True),
    ('EQradical', mrad(mr('x+1')), True),
    ('EQcuberoot', mrad(mr('x'), deg=mr('3')), True),
    ('EQsup', msup(x, two), False),
    ('EQsub', msub(x, mr('i')), False),
    ('EQsubsup', msubsup(x, mr('i'), two), False),
    ('EQsin', mfunc('sin', x), False),
    ('EQcosub', msub(mfunc('cos', mr('θ')), mr('n')), False),
    ('EQcossub2', mfunc('cos', msub(x, mr('n'))), False),
    ('EQlog', mfunc('log', mr('x')) , False),
    ('EQlogbase', mfunc('', mr('x')) .replace('<m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t></m:t></m:r></m:fName>', '<m:fName>' + msub(mr('log', 'p'), mr('2')) + '</m:fName>'), False),
    ('EQsum', mnary('∑', mr('n=1'), mr('∞'), msub(a, n)), True),
    ('EQint', mnary('∫', mr('0'), mr('1'), mr('f(x)dx')), True),
    ('EQintnolimits', mnary('∫', '', '', mr('g(x)dx')), False),
    ('EQparen', md(mr('a+b')), False),
    ('EQbracket', md(mr('a+b'), beg='[', end=']'), False),
    ('EQbrace', md(mr('a'), beg='{', end='}'), False),
    ('EQabs', md(mr('x'), beg='|', end='|'), False),
    ('EQstretchy', md(mfrac(mr('a'), mr('b'))), True),
    ('EQsepdelim', md(mr('a'), mr('b'), mr('c'), sep=','), False),
    ('EQmatrix', md(mmat([[mr('a'), mr('b')], [mr('c'), mr('d')]]), beg='[', end=']'), True),
    ('EQhat', macc('̂', mr('x')), False),
    ('EQvec', macc('⃗', mr('v')), False),
    ('EQbar', mbar(mr('x')), False),
    ('EQlimit', mlimlow(mr('lim', 'p'), mr('x→0')), True),
    ('EQeqarr', meqarr(mr('x+y=1'), mr('x-y=3')), True),
    ('EQquadratic', mr('x=') + mfrac(mr('-b±') + mrad(msup(b, two) + mr('-4ac')), mr('2a')), True),
    ('EQtext', mr('rate=') + '<m:r><m:rPr><m:nor/></m:rPr><m:t>distance over time</m:t></m:r>', False),
    ('EQgreek', mr('α+β=γ'), False),
    ('EQchem', msub(mr('H', 'p'), mr('2', 'p')) + mr('O', 'p'), False),
]
body14 = ''.join(eqp('alpha' + lab + ':', body, disp) for lab, body, disp in eqs)
build('w14-equations', body14)

# ---- w15 content controls
build('w15-content-controls', ''.join([
    '<w:sdt><w:sdtPr><w:alias w:val="Title"/><w:tag w:val="t"/><w:id w:val="1"/><w:text/></w:sdtPr><w:sdtContent>' + p('Block plain-text control alphablocksdt') + '</w:sdtContent></w:sdt>',
    p('Inline control: ', '<w:sdt><w:sdtPr><w:alias w:val="Name"/><w:id w:val="2"/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t>alphainlinesdt</w:t></w:r></w:sdtContent></w:sdt>', ' end.'),
    p('Dropdown: ', '<w:sdt><w:sdtPr><w:id w:val="3"/><w:dropDownList><w:listItem w:displayText="Red" w:value="r"/><w:listItem w:displayText="Blue" w:value="b"/></w:dropDownList></w:sdtPr><w:sdtContent><w:r><w:t>alphadropdown</w:t></w:r></w:sdtContent></w:sdt>'),
    p('Date: ', '<w:sdt><w:sdtPr><w:id w:val="4"/><w:date><w:dateFormat w:val="d MMMM yyyy"/></w:date></w:sdtPr><w:sdtContent><w:r><w:t>30 September 2026 alphadate</w:t></w:r></w:sdtContent></w:sdt>'),
    p('Checkbox: ', '<w:sdt><w:sdtPr><w:id w:val="5"/><w14:checkbox><w14:checked w14:val="1"/><w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rFonts w:ascii="MS Gothic" w:eastAsia="MS Gothic" w:hAnsi="MS Gothic"/></w:rPr><w:t>☒</w:t></w:r></w:sdtContent></w:sdt>', ' alphacheckbox'),
    p('Placeholder: ', '<w:sdt><w:sdtPr><w:id w:val="6"/><w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent><w:r><w:rPr><w:rStyle w:val="Emphasis"/></w:rPr><w:t>Click here to enter text alphaplaceholder</w:t></w:r></w:sdtContent></w:sdt>'),
    # A DATA table (marked header row, two rows) inside a block content control. (Until 30 Sep 2026 this was a single row of two
    # cells, which the reader treats as a LAYOUT table whether or not a content control is around it - table-kind.mjs "one row" -
    # so the check for "a table inside a content control stays a table" could never pass.) The second row sits in a row-level
    # content control and its second cell in a cell-level one, as Word writes them (Pandoc sdt_elements.docx).
    '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent><w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>'
    '<w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' + p('alphasdttable1') + '</w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' + p('alphasdttable2') + '</w:tc></w:tr>'
    '<w:sdt><w:sdtPr><w:id w:val="8"/></w:sdtPr><w:sdtContent><w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' + p('alphasdtrow1') + '</w:tc>'
    '<w:sdt><w:sdtPr><w:id w:val="9"/></w:sdtPr><w:sdtContent><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>' + p('alphasdtcell2') + '</w:tc></w:sdtContent></w:sdt></w:tr></w:sdtContent></w:sdt>'
    '</w:tbl></w:sdtContent></w:sdt>',
]))

# ---- w16 headers/footers, sections, columns
HDR = XML + '<w:hdr %s>%s</w:hdr>' % (NS, p('Running header alphaheader', style='Header'))
FTR = XML + '<w:ftr %s>%s</w:ftr>' % (NS, p('Running footer alphafooter page ', fld('PAGE', '1'), style='Footer'))
HDRF = XML + '<w:hdr %s>%s</w:hdr>' % (NS, p('First page header alphafirsthdr', style='Header'))
HT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/'
build('w16-sections', ''.join([
    p('Section one text alphasec1', style='Heading1'),
    p('Section one body.'),
    # section break (continuous) ending section 1 (single column)
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdH1"/><w:footerReference w:type="default" r:id="rIdF1"/><w:titlePg/><w:headerReference w:type="first" r:id="rIdH2"/><w:type w:val="nextPage"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:pPr></w:p>',
    p('Section two two-column text alphasec2 ', 'Some words to go in the columns of section two, enough to have some length and show the flow.'),
    '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:num="2" w:space="708"/></w:sectPr></w:pPr></w:p>',
    p('Section three landscape alphasec3'),
]), sect='<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>',
    extra_parts={'word/header1.xml': (HDR, W_CT % 'header', HT + 'header', 'rIdH1'), 'word/footer1.xml': (FTR, W_CT % 'footer', HT + 'footer', 'rIdF1'),
                 'word/header2.xml': (HDRF, W_CT % 'header', HT + 'header', 'rIdH2')})

# ---- w17 nested lists (the 30 Sep case): three levels, bullets and numbers mixed
build('w17-nested-lists', ''.join([
    p('Three-level bulleted:', ),
    li('alphaB1', 1, 0), li('alphaB2', 1, 1), li('alphaB3', 1, 2), li('alphaB4', 1, 2), li('alphaB5', 1, 1), li('alphaB6', 1, 0),
    p('Three-level numbered:'),
    li('alphaN1', 2, 0), li('alphaN2', 2, 1), li('alphaN3', 2, 2), li('alphaN4', 2, 1), li('alphaN5', 2, 0),
    p('Bullets containing numbers containing bullets:'),
    li('alphaM1', 1, 0), '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr></w:pPr>' + r('alphaM2') + '</w:p>',
    li('alphaM3', 5, 2), li('alphaM4', 1, 0),
]), numbering=True)

# ---- w18 misc: empty doc edges, long paragraph with mixed, caption paragraph, dates
build('w18-misc', ''.join([
    p('Document with metadata and a normal paragraph alphanormal.'),
    p(r('Direct bold paragraph alphaboldpara', '<w:b/>')),
    p(r('ALL CAPS ALREADY ALPHACAPS', '')),
    p('Number like 1,234.56 and date 30/09/2026 and time 12:30 alphanumbers.'),
    p('Line with two spaces  inside and trailing   spaces   alphaspaces'),
    p('Very long word: ' + 'supercalifragilisticexpialidocious' * 3 + ' alphalongword'),
    p('Shift-return poem line one', '<w:r><w:br/></w:r>', 'poem line two', '<w:r><w:br/></w:r>', 'poem line three alphapoem'),
    p('Ruby/phonetic guide: ', '<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="center"/></w:rubyPr><w:rt><w:r><w:t>alpharuby</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>base</w:t></w:r></w:rubyBase></w:ruby></w:r>'),
    p('Smart tag: ', '<w:smartTag w:uri="urn:schemas-microsoft-com:office:smarttags" w:element="place"><w:r><w:t>alphasmarttag</w:t></w:r></w:smartTag>'),
    p('Text with a bookmark and proofing marks: ', '<w:proofErr w:type="spellStart"/>', r('alphaproof'), '<w:proofErr w:type="spellEnd"/>'),
]), core_title='Audit misc document')

# ---- w19 rich text inside tables / lists / headings / notes (where the editor model differs from plain paragraphs)
SUB = '<w:vertAlign w:val="subscript"/>'
SUP = '<w:vertAlign w:val="superscript"/>'
build('w19-rich-contexts', ''.join([
    p(r('Heading with ', ''), r('alphaheadsub', SUB), r(' and ', ''), r('x', ''), r('2', SUP), style='Heading2'),
    p('Table with rich cells:'),
    tbl(tr(tc(p(r('alphaTH', '<w:b/>'), r('1', SUB))), tc('alphaTH2'), header=True),
        tr(tc(p(r('alphaCellsup', ''), r('2', SUP))), tc(p(r('alphaCellstrike', '<w:strike/>'), ' ', r('alphaCellunder', '<w:u w:val="single"/>')))),
        tr(tc(p('alphaCellnote', fnref(1))), tc(p('<w:hyperlink r:id="rIdLink1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>alphacelllink</w:t></w:r></w:hyperlink>'))), cols=2, w=3000),
    p('List with rich items:'),
    p(r('alphalistsub', ''), r('2', SUB), style='ListParagraph', ppr='<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
    p(r('alphalistbold', '<w:b/>'), ' and ', r('alphalistitalic', '<w:i/>'), style='ListParagraph', ppr='<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>'),
    p('alphalistfoot', fnref(2), style='ListParagraph', ppr='<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>'),
    p('Caption paragraph with script: Figure 1', r('a', SUP), ' alphacapsup', style='Caption'),
    p('Emphasis across sub: ', r('alphabolda', '<w:b/>'), r('2', '<w:b/>' + SUB), r('alphaboldb', '<w:b/>')),
    p('Footnote containing script:', fnref(3)),
]), numbering=True, notes=(FN(1, 'Table cell note alphacellnote1.') + FN(2, 'List note alphalistnote2.') + ('<w:footnote w:id="3"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> Note with H</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>2</w:t></w:r><w:r><w:t>O alphanotesub.</w:t></w:r></w:p></w:footnote>') , ''),
    extra_rels=[('rIdLink1', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', 'https://example.org/cell', 'External')])

# ---- w20 equations in contexts (list item, table cell, heading, footnote) and function/subscript adjacency
cosn = msub(a, n) + mfunc('cos', mfrac(mr('nπx'), mr('L')))
build('w20-equation-contexts', ''.join([
    p('Function after subscript (the 30 Sep case): ', omath(cosn), ' alphafuncsub'),
    eqp('alphaEQsubfunc:', msub(a, n) + mfunc('cos', mr('x')) + mr('+') + msub(b, n) + mfunc('sin', mr('x')), False),
    eqp('alphaEQsubfuncdisp:', mr('f(x)=') + msub(a, mr('0')) + mr('+') + mnary('∑', mr('n=1'), mr('∞'), md(msub(a, n) + mfunc('cos', mfrac(mr('nπx'), mr('L'))) + mr('+') + msub(b, n) + mfunc('sin', mfrac(mr('nπx'), mr('L'))))), True),
    eqp('alphaEQtrig:', mfunc('tan', mr('x')) + mr('=') + mfrac(mfunc('sin', mr('x')), mfunc('cos', mr('x'))), False),
    eqp('alphaEQln:', mfunc('ln', mr('x')) + mr('+') + mfunc('exp', mr('x')) + mr('+') + mfunc('max', md(mr('a'), mr('b'), sep=',')), False),
    eqp('alphaEQparenfrac:', md(mfrac(mr('a'), mr('b'))) + mr('+') + md(mfrac(mr('c'), mr('d')), beg='[', end=']'), False),
    eqp('alphaEQparentall:', md(mfrac(mr('1'), mr('2')) + msup(mr('x'), mr('2'))), False),
    '<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>' + r('alphalisteq ') + omath(mfrac(mr('a'), mr('b'))) + '</w:p>',
    tbl(tr(tc(p('alphatableq ', omath(msup(x, two)))), tc(p('plain'))), cols=2, w=3000),
    p('Heading equation ', omath(msub(x, mr('1'))), style='Heading2'),
    p('Equation in footnote', fnref(1)),
]), numbering=True, notes=(FN(1, 'Note with equation alphanoteeq.'), ''))

print('written to', OUT)
for f in sorted(os.listdir(OUT)):
    print(' ', f, os.path.getsize(os.path.join(OUT, f)))
