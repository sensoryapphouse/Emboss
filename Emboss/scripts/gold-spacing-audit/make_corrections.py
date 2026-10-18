import json, os
from audit import GOLD, norm
HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'classified.json')))
P = json.load(open(os.path.join(HERE, 'book_lines.json')))
out = []
for r in C['corrected']:
    if r['file'] == 'section-6/sample-6-13.json':
        continue
    ev = ('page image PDF p.%d (index %d): cell-grid reconstruction (glyph origins, pitch %s pt, checked cell-by-cell '
          'against the rendered dots) gives %r; web edition: %s') % (
        r['page'], r['page'] - 1, 'per-block', r['book'], r['web'])
    out.append({'file': 'Emboss/tests/gold/bana-formats-2016/' + r['file'], 'line': r['line'], 'before': r['gold'],
                'after': r['book'], 'kind': r['kind'], 'constructs': r.get('constructs', []), 'evidence': ev})
# sample-6-13: block replacement of gold lines 7..14 by the book's lines (guide dots + separation line restored)
f = 'section-6/sample-6-13.json'
d = json.load(open(os.path.join(GOLD, f)))
g = d['braille']['lines']
pg = [x for x in C['corrected'] if x['file'] == f][0]['page'] - 1
bl = [l['text'] for l in P[pg]]
i0 = bl.index('                       #ahgj  #aibj')
after = bl[i0:i0 + 9]
assert after[-1].startswith(',agriculture'), after
out.append({'file': 'Emboss/tests/gold/bana-formats-2016/' + f, 'line': 7, 'lineEnd': 14, 'before': g[7:15], 'after': after,
            'kind': 'content + spacing (gold dropped the separation line and every guide-dot run; 2→1 column gaps)',
            'constructs': ['table separation line', 'column gap after guide dots'],
            'evidence': 'page image PDF p.%d (index %d), Option 2 table format: separation line `"3333  "3333` under the headings, guide dots after every row heading, two blank cells before each column; web edition agrees' % (pg + 1, pg)})
json.dump(out, open(os.path.join(HERE, 'corrections.json'), 'w'), indent=1, ensure_ascii=False)
print(len(out), 'entries;', len(set(o['file'] for o in out)), 'files')
for o in out[-1:]:
    print(json.dumps(o, indent=1))
