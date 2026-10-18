import json, re, os, collections
from audit import norm, runs, GOLD

HERE = os.path.dirname(os.path.abspath(__file__))
R = json.load(open(os.path.join(HERE, 'audit_raw.json')))
W = json.load(open(os.path.join(HERE, 'web_lines.json')))
WIDX = collections.defaultdict(list)
for f, l in W:
    if norm(l):
        WIDX[norm(l)].append(l)

PAGENUM = re.compile(r'^([a-z]?#[a-j]+(-[a-z]?#[a-j]+)?|[a-z]?#,-|[ivxlc]+|;[ivxlc]+|[pt]#[a-j]+|,c#[a-j]+|#[a-j]+"9|b#[a-j]+-#[a-j]+)$')
SEP = re.compile(r'^"3+$')
GUIDE = re.compile(r'^"{2,}$')

# Book lines where the page image puts a right-margin page number one cell short (ends at cell 39)
# while the gold (and rule 1.x/2.x: "at the right margin") ends at 40 — reported, not corrected.
BOOK_QUIRK = {('section-1/example-1-7.json', 0), ('section-8/example-8-8.json', 0), ('section-8/example-8-9.json', 0)}


def run_constructs(sec, book, gold):
    """describe each differing run by what sits either side of it (book layout)."""
    bl, bg, bw = runs(book)
    gl, gg, gw = runs(gold)
    out = []
    if bl != gl:
        out.append(('leading indentation / centring', bl, gl))
    if len(bg) == len(gg):
        for k, (a, b) in enumerate(zip(bg, gg)):
            if a == b:
                continue
            left, right = bw[k], bw[k + 1]
            last = (k + 1 == len(bw) - 1)
            tableish = any(GUIDE.match(t) or SEP.match(t) for t in bw) or sum(1 for x in bg if x >= 2) > 1
            if SEP.match(left) and SEP.match(right):
                c = 'table separation line'
            elif sec == '15':
                c = 'before line number (15.3.1c: at least two blank cells)'
            elif sec == '2' and last and PAGENUM.match(right):
                c = 'contents entry: gap before its page number (2.10.7a)'
            elif last and PAGENUM.match(right) and a >= 3 and not tableish and len(book) >= 36:
                c = 'before right-margin page number'
            elif GUIDE.match(left):
                c = 'column gap after guide dots'
            elif GUIDE.match(right):
                c = 'column gap before a guide-dotted (blank) entry'
            elif sec == '14':
                c = 'speaker name gap (14.10.5a / 14.11 / 14.5.2)'
            elif sec == '13':
                c = 'poetry stress/scansion mark positions'
            elif sec == '19':
                c = 'code/puzzle spacing'
            else:
                c = 'column gap (table / related columns / columned list)'
            out.append((c, a, b))
    else:
        out.append(('token count differs', None, None))
    return out


def main():
    rows, skipped = [], []
    for r in R:
        sec = r['file'].split('/')[0].split('-')[1]
        for d in r['diffs']:
            g = d['gold']
            b = d['book']
            rec = {'file': r['file'], 'id': r['id'], 'section': int(sec), 'line': d['line'], 'gold': g, 'book': b,
                   'page': d['page'] + 1, 'image_agrees': d['agree']}
            ws = WIDX.get(norm(g) if d['same_content'] else norm(b), [])
            rec['web'] = ('== book' if b in ws else ('== gold' if g.rstrip() in ws else ('differs' if ws else 'not found')))
            if d['errata_line']:
                rec['kind'] = 'errata-corrected line (K28) — excluded'
                skipped.append(rec)
                continue
            if (r['file'], d['line']) in BOOK_QUIRK:
                rec['kind'] = 'book quirk — page number ends at cell 39 in the image; gold (cell 40) kept'
                rec['constructs'] = ['before right-margin page number']
                skipped.append(rec)
                continue
            if not d['same_content']:
                rec['kind'] = 'content (gold dropped guide dots / separation line)'
                rec['constructs'] = ['column gap after guide dots']
                rows.append(rec)
                continue
            rc = run_constructs(sec, b, g)
            diffs = [(a, bb) for c, a, bb in rc if a is not None]
            only21 = all(a == 2 and bb == 1 for a, bb in diffs)
            has21 = any(a == 2 and bb == 1 for a, bb in diffs)
            if only21:
                kind = '2→1 collapse'
            elif has21:
                kind = '2→1 collapse, compensated by +1 in a later gap/lead'
            elif all(bb > a for a, bb in diffs) and len(g.rstrip()) > 40:
                kind = 'gold line too wide (spurious extra blanks; gold line > 40 cells)'
            else:
                kind = 'other misplaced run (not 2→1)'
            rec['kind'] = kind
            rec['runs'] = [{'construct': c, 'book': a, 'gold': bb} for c, a, bb in rc]
            rec['constructs'] = sorted(set(c for c, a, bb in rc))
            rows.append(rec)
    json.dump({'corrected': rows, 'not_corrected': skipped}, open(os.path.join(HERE, 'classified.json'), 'w'), indent=1, ensure_ascii=False)
    print('lines to correct', len(rows), 'not corrected', len(skipped))
    print(collections.Counter(r['kind'] for r in rows))
    print(collections.Counter(r['kind'] for r in skipped))
    print('web', collections.Counter(r['web'] for r in rows))
    print('image agree', collections.Counter(r['image_agrees'] for r in rows))
    bysec = collections.defaultdict(collections.Counter)
    for r in rows:
        bysec[r['section']][r['kind']] += 1
    for s in sorted(bysec):
        print(s, dict(bysec[s]), 'samples', len(set(r['id'] for r in rows if r['section'] == s)))
    cons = collections.Counter()
    for r in rows:
        for c in r.get('constructs', []):
            cons[c] += 1
    print(cons)


if __name__ == '__main__':
    main()
