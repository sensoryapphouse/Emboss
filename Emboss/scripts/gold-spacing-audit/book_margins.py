"""Extract this book's PRIMARY evidence for blank lines and page breaks: the left-margin line
number (font `LucidaConsole`, e.g. "1 ", "2 ", ... "25 ") printed beside every braille line inside
a numbered worked-example box -- INCLUDING a wholly blank braille line, which still gets its own
number (it is a row of literal U+2800 blank-cell glyphs, not the absence of a row) -- and every
"-New Braille Page-" marker (plain running text, font `TimesNewRomanPSMT`, between two boxes on
the same PDF page when a box's own braille pagination breaks without a physical page turn).

This is a separate pass from book.py (which only reads the `SimBraille` font and actively drops
non-`SimBraille` spans): margin numbers and page-break markers are ordinary print text, and this
script reads exactly that. Not every box in this book carries margin numbers (see regen-report.md
for the count); where they are absent, regen.py falls back to book.py's vertical-gap measurement.

Usage: `python3 book_margins.py` writes `book_margins.json`: a list (one entry per PDF page) of
`{"margins": [{"y", "num"}, ...], "markers": [{"y", "text"}, ...]}`.
"""
import json, os
import pymupdf
import book  # reuses book.PDF (resolves the untracked PDF's path the same way)

HERE = os.path.dirname(os.path.abspath(__file__))
PDF = book.PDF


def _cluster(chars, tol=3):
    """chars: list of (y, x, char). Cluster into rows by y (tolerance), return [{'y', 'chars':[(x,c),...]}]."""
    chars = sorted(chars, key=lambda c: c[0])
    rows = []
    for y, x, c in chars:
        if rows and abs(rows[-1]['y'] - y) < tol:
            rows[-1]['chars'].append((x, c))
        else:
            rows.append({'y': y, 'chars': [(x, c)]})
    for r in rows:
        r['chars'].sort(key=lambda xc: xc[0])
    return rows


def page_margins(p):
    t = p.get_text('rawdict')
    margin_chars = []
    other_chars = []
    for b in t['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                font = s['font']
                for c in s['chars']:
                    y, x, ch = c['origin'][1], c['origin'][0], c['c']
                    if font == 'LucidaConsole':
                        margin_chars.append((y, x, ch))
                    elif font != 'SimBraille':
                        other_chars.append((y, x, ch))
    margins = []
    for r in _cluster(margin_chars):
        txt = ''.join(c for _, c in r['chars']).strip()
        if txt.isdigit():
            margins.append({'y': round(r['y'], 1), 'num': int(txt)})
    markers = []
    for r in _cluster(other_chars):
        txt = ''.join(c for _, c in r['chars'])
        if 'New Braille Page' in txt:
            markers.append({'y': round(r['y'], 1), 'text': txt.strip()})
    return margins, markers


def build():
    d = pymupdf.open(PDF)
    pages = []
    for p in d:
        margins, markers = page_margins(p)
        pages.append({'margins': margins, 'markers': markers})
    return pages


if __name__ == '__main__':
    pages = build()
    json.dump(pages, open(os.path.join(HERE, 'book_margins.json'), 'w'), ensure_ascii=False)
    n_margin_pages = sum(1 for pg in pages if pg['margins'])
    n_markers = sum(len(pg['markers']) for pg in pages)
    n_margin_lines = sum(len(pg['margins']) for pg in pages)
    print('pages with margin numbers:', n_margin_pages, '/', len(pages))
    print('total margin-numbered lines:', n_margin_lines)
    print('"-New Braille Page-" markers found:', n_markers)
    for i, pg in enumerate(pages):
        for m in pg['markers']:
            print('  marker: page', i, '(printed %d)' % (i + 1), repr(m['text']), 'y=', m['y'])
