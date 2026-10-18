#!/usr/bin/env python3
"""Generates the hand-written ODT and EPUB fixtures for Emboss/scripts/audit-import-fidelity.mjs.

    python3 Emboss/tests/fixtures/import-audit/make-odt-epub-fixtures.py

OpenDocument (odt/*.odt) and EPUB 3 (epub/*.epub) packages written the way LibreOffice / a typical
EPUB build tool writes them; one small file per feature group. Every feature paragraph carries a
unique nonsense word ("alphastrike") the harness searches for.
"""
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
XML = '<?xml version="1.0" encoding="UTF-8"?>\n'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


# ============================================================================ ODT
ODT_NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
          'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
          'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" '
          'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" '
          'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:math="http://www.w3.org/1998/Math/MathML" '
          'xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0" office:version="1.3"')

ODT_STYLES = XML + '''<office:document-styles %s>
<office:font-face-decls><style:font-face style:name="Liberation Serif" svg:font-family="'Liberation Serif'"/></office:font-face-decls>
<office:styles>
<style:default-style style:family="paragraph"><style:paragraph-properties/><style:text-properties style:font-name="Liberation Serif" fo:font-size="12pt" fo:language="en" fo:country="GB"/></style:default-style>
<style:style style:name="Standard" style:family="paragraph" style:class="text"/>
<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Text_20_body" style:class="text"><style:text-properties fo:font-size="14pt"/></style:style>
<style:style style:name="Text_20_body" style:display-name="Text body" style:family="paragraph" style:parent-style-name="Standard" style:class="text"/>
<style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="1" style:class="text"><style:text-properties fo:font-size="18pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_2" style:display-name="Heading 2" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="2" style:class="text"><style:text-properties fo:font-size="16pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_3" style:display-name="Heading 3" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Text_20_body" style:default-outline-level="3" style:class="text"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Heading_20_4" style:display-name="Heading 4" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="4" style:class="text"/>
<style:style style:name="Heading_20_5" style:display-name="Heading 5" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="5" style:class="text"/>
<style:style style:name="Heading_20_6" style:display-name="Heading 6" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="6" style:class="text"/>
<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Heading" style:next-style-name="Subtitle" style:class="chapter"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="28pt" fo:font-weight="bold"/></style:style>
<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Heading" style:class="chapter"><style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="18pt"/></style:style>
<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="1cm" fo:margin-right="1cm"/></style:style>
<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:text-properties style:font-name="Courier New"/></style:style>
<style:style style:name="Caption" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:text-properties fo:font-style="italic" fo:font-size="10pt"/></style:style>
<style:style style:name="Table_20_Contents" style:display-name="Table Contents" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"/>
<style:style style:name="Table_20_Heading" style:display-name="Table Heading" style:family="paragraph" style:parent-style-name="Table_20_Contents" style:class="extra"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Footnote" style:family="paragraph" style:parent-style-name="Standard" style:class="extra"><style:text-properties fo:font-size="10pt"/></style:style>
<style:style style:name="List_20_Paragraph" style:display-name="List Paragraph" style:family="paragraph" style:parent-style-name="Standard"/>
<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="#000080" style:text-underline-style="solid" style:text-underline-width="auto"/></style:style>
<style:style style:name="Footnote_20_Symbol" style:display-name="Footnote Symbol" style:family="text"/>
<style:style style:name="Strong_20_Emphasis" style:display-name="Strong Emphasis" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Emphasis" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="Frame" style:family="graphic"><style:graphic-properties text:anchor-type="paragraph" svg:x="0cm" svg:y="0cm" style:wrap="parallel"/></style:style>
<text:notes-configuration text:note-class="footnote" style:num-format="1" text:start-value="0" text:footnotes-position="page"/>
<text:notes-configuration text:note-class="endnote" style:num-format="i" text:start-value="0"/>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm"/></style:page-layout>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"><style:header><text:p text:style-name="Standard">Running header alphaheader</text:p></style:header><style:footer><text:p text:style-name="Standard">Running footer alphafooter <text:page-number>1</text:page-number></text:p></style:footer></style:master-page></office:master-styles>
</office:document-styles>''' % ODT_NS

AUTO = '''<office:automatic-styles>
<style:style style:name="T_b" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="T_i" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="T_u" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto"/></style:style>
<style:style style:name="T_udbl" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-type="double"/></style:style>
<style:style style:name="T_udot" style:family="text"><style:text-properties style:text-underline-style="dotted"/></style:style>
<style:style style:name="T_strike" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>
<style:style style:name="T_dstrike" style:family="text"><style:text-properties style:text-line-through-style="solid" style:text-line-through-type="double"/></style:style>
<style:style style:name="T_sub" style:family="text"><style:text-properties style:text-position="sub 58%"/></style:style>
<style:style style:name="T_sup" style:family="text"><style:text-properties style:text-position="super 58%"/></style:style>
<style:style style:name="T_sc" style:family="text"><style:text-properties fo:font-variant="small-caps"/></style:style>
<style:style style:name="T_caps" style:family="text"><style:text-properties fo:text-transform="uppercase"/></style:style>
<style:style style:name="T_hid" style:family="text"><style:text-properties text:display="none"/></style:style>
<style:style style:name="T_hl" style:family="text"><style:text-properties fo:background-color="#ffff00"/></style:style>
<style:style style:name="T_col" style:family="text"><style:text-properties fo:color="#ff0000"/></style:style>
<style:style style:name="T_script" style:family="text"><style:text-properties style:font-name="Brush Script MT"/></style:style>
<style:style style:name="T_fr" style:family="text"><style:text-properties fo:language="fr" fo:country="FR"/></style:style>
<style:style style:name="P_center" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="P_right" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:text-align="end"/></style:style>
<style:style style:name="P_indent" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="2cm"/></style:style>
<style:style style:name="P_box" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border="0.06pt solid #000000" fo:padding="0.1cm"/></style:style>
<style:style style:name="P_pagebreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page"/></style:style>
<style:style style:name="P_rtl" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties style:writing-mode="rl-tb"/></style:style>
<text:list-style style:name="L_bul"><text:list-level-style-bullet text:level="1" text:bullet-char="&#8226;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="1.27cm" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-bullet>
<text:list-level-style-bullet text:level="2" text:bullet-char="&#9702;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="1.9cm" fo:text-indent="-0.635cm" fo:margin-left="1.9cm"/></style:list-level-properties></text:list-level-style-bullet>
<text:list-level-style-bullet text:level="3" text:bullet-char="&#9642;"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="2.5cm" fo:text-indent="-0.635cm" fo:margin-left="2.5cm"/></style:list-level-properties></text:list-level-style-bullet></text:list-style>
<text:list-style style:name="L_num"><text:list-level-style-number text:level="1" style:num-suffix="." style:num-format="1"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="1.27cm" fo:text-indent="-0.635cm" fo:margin-left="1.27cm"/></style:list-level-properties></text:list-level-style-number>
<text:list-level-style-number text:level="2" style:num-suffix="." style:num-format="a"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="1.9cm" fo:text-indent="-0.635cm" fo:margin-left="1.9cm"/></style:list-level-properties></text:list-level-style-number>
<text:list-level-style-number text:level="3" style:num-suffix="." style:num-format="i"><style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="2.5cm" fo:text-indent="-0.635cm" fo:margin-left="2.5cm"/></style:list-level-properties></text:list-level-style-number></text:list-style>
<style:style style:name="Tbl" style:family="table"><style:table-properties style:width="17cm" table:align="margins"/></style:style>
<style:style style:name="Tbl.A" style:family="table-column"><style:table-column-properties style:column-width="5.6cm"/></style:style>
<style:style style:name="Tbl.A1" style:family="table-cell"><style:table-cell-properties fo:border="0.05pt solid #000000" fo:padding="0.1cm"/></style:style>
<style:style style:name="Fr1" style:family="graphic" style:parent-style-name="Frame"><style:graphic-properties style:wrap="none" style:vertical-pos="top" style:horizontal-pos="center"/></style:style>
</office:automatic-styles>'''


def odt(name, body, extra_files=None, meta_title=None):
    content = XML + ('<office:document-content %s>%s<office:body><office:text>%s</office:text></office:body></office:document-content>' % (ODT_NS, AUTO, body))
    meta = XML + '<office:document-meta %s><office:meta><dc:title>%s</dc:title><meta:initial-creator>Audit Author</meta:initial-creator><dc:language>en-GB</dc:language></office:meta></office:document-meta>' % (ODT_NS, esc(meta_title or ''))
    manifest = XML + ('<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">'
                      '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
                      '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                      '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
                      '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>')
    os.makedirs(os.path.join(HERE, 'odt'), exist_ok=True)
    with zipfile.ZipFile(os.path.join(HERE, 'odt', name + '.odt'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/vnd.oasis.opendocument.text')
        z.writestr('META-INF/manifest.xml', manifest)
        z.writestr('content.xml', content)
        z.writestr('styles.xml', ODT_STYLES)
        z.writestr('meta.xml', meta)
        for n, d in (extra_files or {}).items():
            z.writestr(n, d)


def tp(style, *content):
    return '<text:p text:style-name="%s">%s</text:p>' % (style, ''.join(content))


def sp(style, text):
    return '<text:span text:style-name="%s">%s</text:span>' % (style, esc(text))


def h(level, text):
    return '<text:h text:style-name="Heading_20_%d" text:outline-level="%d">%s</text:h>' % (level, level, text)


# ---- o01 inline and structure
odt('o01-inline', ''.join([
    tp('Title', 'Main title alphatitle'), tp('Subtitle', 'Sub title alphasubtitle'),
    h(1, 'Heading one alphah1'), h(2, 'Heading two alphah2'), h(3, 'Heading three alphah3'), h(4, 'Heading four alphah4'), h(5, 'Heading five alphah5'), h(6, 'Heading six alphah6'),
    tp('Text_20_body', 'Plain: ', sp('T_b', 'alphabold'), ' ', sp('T_i', 'alphaitalic'), ' ', sp('T_u', 'alphaunder'), ' ', sp('Strong_20_Emphasis', 'alphastrongstyle'), ' ', sp('Emphasis', 'alphaemphstyle')),
    tp('Text_20_body', 'Underline kinds: ', sp('T_udbl', 'alphadouble'), ' ', sp('T_udot', 'alphadotted')),
    tp('Text_20_body', 'Strike: ', sp('T_strike', 'alphastrike'), ' and ', sp('T_dstrike', 'alphadstrike')),
    tp('Text_20_body', 'Scripts: H', sp('T_sub', '2'), 'O and x', sp('T_sup', '2'), ' and ', sp('T_sub', 'alphasubword'), ' and ', sp('T_sup', 'alphasupword')),
    tp('Text_20_body', 'Caps: ', sp('T_sc', 'alphasmallcaps'), ' ', sp('T_caps', 'alphaallcaps')),
    tp('Text_20_body', 'Hidden: before ', sp('T_hid', 'alphahidden'), ' after'),
    tp('Text_20_body', 'Colour: ', sp('T_hl', 'alphahighlight'), ' ', sp('T_col', 'alphacolour'), ' ', sp('T_script', 'alphascriptfont')),
    tp('Text_20_body', 'Breaks: line one alphaline<text:line-break/>line two. Tab: left<text:tab/>right alphatab. Spaces:<text:s text:c="3"/>alphaspaces.'),
    tp('Text_20_body', 'Language: ', sp('T_fr', 'Bonjour le monde alphafrench'), ' end.'),
    tp('Text_20_body', 'Link: <text:a xlink:type="simple" xlink:href="https://example.org/alpha" text:style-name="Internet_20_link">alphalink</text:a> and internal <text:a xlink:type="simple" xlink:href="#alphamark" text:style-name="Internet_20_link">alphainternal</text:a>.'),
    tp('Text_20_body', 'Bookmark <text:bookmark text:name="alphamark"/>here alphabookmark. Reference <text:bookmark-ref text:reference-format="text" text:ref-name="alphamark">alphabookmarkref</text:bookmark-ref>.'),
    tp('Text_20_body', 'Fields: page <text:page-number text:select-page="current">7</text:page-number> alphapage date <text:date style:data-style-name="N1" text:date-value="2026-09-30">30/09/2026</text:date> alphadate seq <text:sequence text:name="Figure" text:formula="ooow:Figure+1" style:num-format="1">1</text:sequence> alphaseq'),
    tp('P_center', 'Centred alphacentre'), tp('P_right', 'Right alpharight'), tp('P_indent', 'Indented alphaindent'),
    tp('Quotations', 'Quotation style alphaquotation'), tp('Preformatted_20_Text', 'Preformatted alphapre'),
    tp('P_box', 'Boxed paragraph alphaboxed'),
    tp('P_pagebreak', 'After page break alphapagebreak'),
    tp('P_rtl', 'Right to left writing mode alphartl'),
    tp('Text_20_body', 'Note here<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p text:style-name="Footnote">Footnote one text alphafootnoteone.</text:p></text:note-body></text:note> and endnote<text:note text:id="edn1" text:note-class="endnote"><text:note-citation>i</text:note-citation><text:note-body><text:p text:style-name="Footnote">Endnote text alphaendnoteone.</text:p></text:note-body></text:note> end alphanotes.'),
    tp('Text_20_body', 'Comment <office:annotation office:name="__Annotation__1"><dc:creator>Reviewer</dc:creator><dc:date>2026-09-30T10:00:00</dc:date><text:p>Comment body alphacommentbody</text:p></office:annotation>anchor alphacommentanchor<office:annotation-end office:name="__Annotation__1"/> end.'),
    '<text:tracked-changes text:track-changes="true"><text:changed-region text:id="ct1"><text:insertion><office:change-info><dc:creator>Ed</dc:creator><dc:date>2026-09-30T09:00:00</dc:date></office:change-info></text:insertion></text:changed-region>'
    '<text:changed-region text:id="ct2"><text:deletion><office:change-info><dc:creator>Ed</dc:creator><dc:date>2026-09-30T09:00:00</dc:date></office:change-info><text:p text:style-name="Standard">alphadeleted</text:p></text:deletion></text:changed-region></text:tracked-changes>',
    tp('Text_20_body', 'Tracked: keep <text:change-start text:change-id="ct1"/>alphainserted<text:change-end text:change-id="ct1"/> and <text:change text:change-id="ct2"/> tail.'),
    '<text:table-of-content text:name="Table of Contents1"><text:table-of-content-source text:outline-level="3"><text:index-title-template text:style-name="Standard">Contents</text:index-title-template></text:table-of-content-source><text:index-body><text:index-title text:name="Table of Contents1_Head"><text:p text:style-name="Standard">Contents</text:p></text:index-title><text:p text:style-name="Standard"><text:a xlink:type="simple" xlink:href="#h1">Heading alphatoc1<text:tab/>3</text:a></text:p></text:index-body></text:table-of-content>',
    tp('Text_20_body', 'Ruby <text:ruby><text:ruby-base>base</text:ruby-base><text:ruby-text>alpharuby</text:ruby-text></text:ruby> end.'),
    tp('Text_20_body', 'Unicode: café € \U0001F600  nbsp alphaunicode'),
]), meta_title='Audit ODT inline')

# ---- o02 lists and tables
def lst(style, items, cont=False):
    return '<text:list text:style-name="%s">%s</text:list>' % (style, items)


def item(text, sub=''):
    return '<text:list-item><text:p text:style-name="List_20_Paragraph">%s</text:p>%s</text:list-item>' % (text, sub)


def cell(content, span=None, rowspan=None, style='Tbl.A1', hdr=False):
    a = ''
    if span:
        a += ' table:number-columns-spanned="%d"' % span
    if rowspan:
        a += ' table:number-rows-spanned="%d"' % rowspan
    body = content if content.startswith('<text:') or content.startswith('<table:') else tp('Table_20_Heading' if hdr else 'Table_20_Contents', content)
    return '<table:table-cell table:style-name="%s" office:value-type="string"%s>%s</table:table-cell>' % (style, a, body)


covered = '<table:covered-table-cell/>'


def row(*cells):
    return '<table:table-row>%s</table:table-row>' % ''.join(cells)


def table(name, rows, cols=3, header_rows=None):
    hdr = ('<table:table-header-rows>%s</table:table-header-rows>' % header_rows) if header_rows else ''
    return ('<table:table table:name="%s" table:style-name="Tbl"><table:table-column table:style-name="Tbl.A" table:number-columns-repeated="%d"/>%s%s</table:table>'
            % (name, cols, hdr, rows))


odt('o02-lists-tables', ''.join([
    tp('Text_20_body', 'Three-level bullets:'),
    lst('L_bul', item('alphaB1', lst('L_bul', item('alphaB2', lst('L_bul', item('alphaB3') + item('alphaB4'))) + item('alphaB5'))) + item('alphaB6')),
    tp('Text_20_body', 'Three-level numbers:'),
    lst('L_num', item('alphaN1', lst('L_num', item('alphaN2', lst('L_num', item('alphaN3'))) + item('alphaN4'))) + item('alphaN5')),
    tp('Text_20_body', 'Numbering restart at 5:'),
    '<text:list text:style-name="L_num"><text:list-item text:start-value="5"><text:p text:style-name="List_20_Paragraph">alphastart5a</text:p></text:list-item><text:list-item><text:p text:style-name="List_20_Paragraph">alphastart5b</text:p></text:list-item></text:list>',
    tp('Text_20_body', 'Item with two paragraphs:'),
    '<text:list text:style-name="L_num"><text:list-item><text:p text:style-name="List_20_Paragraph">alphamulti1</text:p><text:p text:style-name="List_20_Paragraph">alphamulti1b second paragraph</text:p></text:list-item></text:list>',
    tp('Text_20_body', 'Table with header row, merged cells, empty cell:'),
    table('T1', row(cell('alphaSpanHead', span=2, hdr=True), covered, cell('alphaH3b', hdr=True)).replace('<table:table-row>', '<table:table-row>', 1)
          + row(cell('alphaVM', rowspan=2), cell('d2'), cell('d3'))
          + row(covered, cell('e2'), cell('e3'))
          + row(cell('f1'), cell('alphaSpan2', span=2), covered)
          + row(cell(''), cell('g2'), cell('')), header_rows=None),
    tp('Text_20_body', 'Table with proper header rows:'),
    table('T2', row(cell('alphaR1', hdr=True), cell('alphaR2', hdr=True)) and row(cell('a1'), cell('a2')), cols=2,
          header_rows=row(cell('alphaR1', hdr=True), cell('alphaR2', hdr=True))),
    tp('Text_20_body', 'Nested table:'),
    table('T3', row(cell('alphaOuter1'), '<table:table-cell table:style-name="Tbl.A1" office:value-type="string">' + table('T3in', row(cell('alphaInner1'), cell('alphaInner2')), cols=2) + '</table:table-cell>'), cols=2),
    tp('Caption', 'Table 1: alphacaption text'),
    tp('Text_20_body', 'Table with list in cell:'),
    table('T4', row(cell(lst('L_bul', item('alphacellbullet1') + item('alphacellbullet2'))), cell(tp('Table_20_Contents', 'alphacellp1') + tp('Table_20_Contents', 'alphacellp2'))), cols=2),
]))

# ---- o03 objects: images, text box, formula, section
PNG = bytes.fromhex('89504e470d0a1a0a0000000d49484452000000080000000808020000004b6d29dc0000001249444154789c63fccfc0f0df0044c066160020d2cf5a6e0000000049454e44ae426082')
SVG_NS = 'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"'
MATH = XML + ('<math:math xmlns:math="http://www.w3.org/1998/Math/MathML" display="block"><math:semantics><math:mrow><math:mfrac><math:mn>1</math:mn><math:mn>2</math:mn></math:mfrac></math:mrow>'
              '<math:annotation math:encoding="StarMath 5.0">{1} over {2}</math:annotation></math:semantics></math:math>')
odt('o03-objects', ''.join([
    tp('Text_20_body', 'Image with alt: <draw:frame draw:style-name="Fr1" draw:name="Image1" text:anchor-type="as-char" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="Pictures/img1.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/><svg:title>alphaalttitle</svg:title><svg:desc>alphaaltdesc a red square</svg:desc></draw:frame> end.'),
    tp('Text_20_body', 'Image with no alt: <draw:frame draw:style-name="Fr1" draw:name="Image2" text:anchor-type="as-char" svg:width="2cm" svg:height="2cm"><draw:image xlink:href="Pictures/img1.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame> end alphanoalt.'),
    tp('Text_20_body', 'Text box: <draw:frame draw:style-name="Fr1" draw:name="Frame1" text:anchor-type="paragraph" svg:width="5cm" svg:height="2cm"><draw:text-box><text:p text:style-name="Standard">Text box contents alphatextbox</text:p></draw:text-box></draw:frame> end.'),
    tp('Text_20_body', 'Formula: <draw:frame draw:style-name="Fr1" draw:name="Object1" text:anchor-type="as-char" svg:width="1cm" svg:height="1cm"><draw:object xlink:href="./Object 1" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame> alphaformula end.'),
    '<text:section text:style-name="Standard" text:name="Section1"><text:p text:style-name="Standard">Section content alphasection</text:p></text:section>',
    tp('Caption', 'Figure 1: alphafigcaption'),
]), extra_files={'Pictures/img1.png': PNG, 'Object 1/content.xml': MATH})

# ============================================================================ EPUB
EPUB_CSS = 'body{font-family:serif} .hidden{display:none}'


def epub(name, files, opf_items, spine, nav_xml, metadata=None):
    os.makedirs(os.path.join(HERE, 'epub'), exist_ok=True)
    meta = metadata or ('<dc:identifier id="uid">urn:uuid:12345678-1234-1234-1234-123456789abc</dc:identifier><dc:title>Audit EPUB alphabooktitle</dc:title>'
                        '<dc:creator>Audit Author</dc:creator><dc:language>en-GB</dc:language><dc:publisher>Audit Press</dc:publisher><dc:date>2026-09-30</dc:date>'
                        '<meta property="dcterms:modified">2026-09-30T00:00:00Z</meta>')
    opf = XML + ('<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">%s</metadata>'
                 '<manifest>%s</manifest><spine>%s</spine></package>' % (meta, opf_items, spine))
    with zipfile.ZipFile(os.path.join(HERE, 'epub', name + '.epub'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr(zipfile.ZipInfo('mimetype'), 'application/epub+zip')
        z.writestr('META-INF/container.xml', XML + '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
        z.writestr('OEBPS/content.opf', opf)
        z.writestr('OEBPS/nav.xhtml', nav_xml)
        z.writestr('OEBPS/style.css', EPUB_CSS)
        for n, d in files.items():
            z.writestr('OEBPS/' + n, d)


def xhtml(title, body):
    return XML + ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en-GB"><head><title>%s</title><link rel="stylesheet" href="style.css"/></head><body>%s</body></html>' % (esc(title), body))


NAV = XML + ('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body>'
             '<nav epub:type="toc" id="toc"><h1>Contents alphanavtitle</h1><ol><li><a href="ch1.xhtml">Chapter one alphanav1</a><ol><li><a href="ch1.xhtml#s1">Section alphanav11</a></li></ol></li>'
             '<li><a href="ch2.xhtml">Chapter two alphanav2</a></li></ol></nav>'
             '<nav epub:type="landmarks" hidden=""><ol><li><a epub:type="bodymatter" href="ch1.xhtml">Start</a></li></ol></nav>'
             '<nav epub:type="page-list" hidden=""><ol><li><a href="ch1.xhtml#p1">1</a></li></ol></nav></body></html>')
PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z8DwnwEJMGFzAGIhAgQSz9RoAAAAAElFTkSuQmCC'
CH1 = xhtml('Chapter one', ''.join([
    '<section epub:type="chapter" id="c1"><h1 id="h1">Chapter one alphach1</h1>',
    '<p>First paragraph with a note<a epub:type="noteref" role="doc-noteref" href="#fn1" id="r1"><sup>1</sup></a> and pagebreak<span epub:type="pagebreak" role="doc-pagebreak" id="p1" title="1"/> alphapb.</p>',
    '<h2 id="s1">Section alphasection</h2>',
    '<p><b>alphabold</b> <i>alphaitalic</i> <u>alphaunder</u> <s>alphastrike</s> H<sub>2</sub>O x<sup>2</sup> <span class="hidden">alphacsshidden</span></p>',
    '<ul><li>alphaB1<ul><li>alphaB2<ul><li>alphaB3</li></ul></li></ul></li><li>alphaB4</li></ul>',
    '<ol><li>alphaN1<ol><li>alphaN2</li></ol></li></ol>',
    '<table><caption>Caption alphacaption</caption><thead><tr><th colspan="2">alphaSpanHead</th></tr></thead><tbody><tr><td rowspan="2">alphaRowspan</td><td>d2</td></tr><tr><td>e2</td></tr></tbody></table>',
    '<figure><img src="data:image/png;base64,%s" alt="alphafigalt"/><figcaption>alphafigcaption</figcaption></figure>' % PNG_B64,
    '<p><img src="data:image/png;base64,%s"/> no alt alphanoalt</p>' % PNG_B64,
    '<p>Maths: <math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math> alphamath</p>',
    '<blockquote><p>Quote alphaquote</p></blockquote>',
    '<aside epub:type="footnote" role="doc-footnote" id="fn1"><p>Footnote body alphafootnote.</p></aside>',
    '<p epub:type="pagebreak" role="doc-pagebreak" id="p2" title="2">2</p>',
    '</section>']))
CH2 = xhtml('Chapter two', '<section epub:type="chapter"><h1>Chapter two alphach2</h1><p>Second chapter text alphasecond.</p><p lang="fr">Bonjour le monde alphafrench</p><dl><dt>alphaterm</dt><dd>alphadef</dd></dl></section>')
NOTES = xhtml('Notes', '<section epub:type="endnotes"><h1>Notes alphanotes</h1><ol><li id="en1">Endnote alphaendnote <a href="ch1.xhtml#r1">back</a></li></ol></section>')
COVER = xhtml('Cover', '<section epub:type="cover"><h1>Cover alphacover</h1><img src="data:image/png;base64,%s" alt="alphacoveralt"/></section>' % PNG_B64)
TITLEPG = xhtml('Title page', '<section epub:type="titlepage"><h1>Audit EPUB alphatitlepage</h1><p>by Audit Author</p></section>')
epub('e01-basic',
     {'ch1.xhtml': CH1, 'ch2.xhtml': CH2, 'notes.xhtml': NOTES, 'cover.xhtml': COVER, 'title.xhtml': TITLEPG},
     '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>'
     '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>'
     '<item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>'
     '<item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>',
     '<itemref idref="cover" linear="no"/><itemref idref="title"/><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="notes" linear="no"/>',
     NAV)
print('odt/epub written')
