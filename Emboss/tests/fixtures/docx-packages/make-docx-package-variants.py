#!/usr/bin/env python3
"""Make Strict Open XML and renamed-main-part variants of ordinary Word files (import fix list #1, 30 Sep 2026).

strict-<name>.docx:  every Transitional namespace http://schemas.openxmlformats.org/<group>/2006/<name> renamed to its
                     Strict twin http://purl.oclc.org/ooxml/<group>/<name>, w:conformance="strict", and twips
                     measurements (w:ind, w:spacing, w:tab, w:tblInd...) written in points ("36pt") as Strict files do.
renamed-<name>.docx: word/document.xml moved to word/main-body.xml (and its relationships), with _rels/.rels and
                     [Content_Types].xml pointing at the new name.
Run from this folder: python3 make-docx-package-variants.py
"""
import re, zipfile, os
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'import-audit', 'docx')
SOURCES = ['w00-paul-test-word-doc-2.docx', 'w08-lists.docx', 'w12-tables.docx', 'w02-inline.docx']

def to_strict(name, data):
    if not re.search(r'\.(xml|rels)$', name):
        return data
    x = data.decode('utf-8')
    x = re.sub(r'http://schemas\.openxmlformats\.org/([A-Za-z]+)/2006/', r'http://purl.oclc.org/ooxml/\1/', x)
    if name == 'word/document.xml':
        x = re.sub(r'<w:document\b', '<w:document w:conformance="strict"', x, count=1)
    # twips -> points on the common measurement attributes (Strict writes units)
    def pts(m):
        return f'{m.group(1)}{int(m.group(2)) / 20:g}pt"'
    x = re.sub(r'(\bw:(?:left|right|start|end|hanging|firstLine|before|after|pos)=")(-?\d+)"', pts, x)
    x = re.sub(r'(<w:(?:sz|szCs)\b[^>]*\bw:val=")(\d+)"', lambda m: f'{m.group(1)}{int(m.group(2)) / 2:g}pt"', x)
    return x.encode('utf-8')

def renamed(name, data):
    if name == 'word/document.xml':
        return 'word/main-body.xml', data
    if name == 'word/_rels/document.xml.rels':
        return 'word/_rels/main-body.xml.rels', data
    if name in ('_rels/.rels', '[Content_Types].xml'):
        return name, data.decode('utf-8').replace('word/document.xml', 'word/main-body.xml').encode('utf-8')
    return name, data

for src in SOURCES:
    with zipfile.ZipFile(os.path.join(SRC, src)) as z:
        parts = [(i.filename, z.read(i.filename)) for i in z.infolist()]
    base = src.split('-', 1)[0]
    with zipfile.ZipFile(os.path.join(HERE, f'strict-{base}.docx'), 'w', zipfile.ZIP_DEFLATED) as out:
        for n, d in parts:
            out.writestr(n, to_strict(n, d))
    with zipfile.ZipFile(os.path.join(HERE, f'renamed-{base}.docx'), 'w', zipfile.ZIP_DEFLATED) as out:
        for n, d in parts:
            nn, dd = renamed(n, d)
            out.writestr(nn, dd)
print('ok')
