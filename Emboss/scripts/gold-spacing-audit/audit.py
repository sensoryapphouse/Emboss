import json, glob, os, re, difflib, collections

HERE = os.path.dirname(os.path.abspath(__file__))
# Repo root of WHICHEVER checkout/worktree this script is running from — never hard-coded to the
# main checkout, so gold files are always read from (and, via apply.py, written to) the caller's
# own worktree.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
GOLD = os.path.join(REPO_ROOT, 'Emboss', 'tests', 'gold', 'bana-formats-2016')
P = json.load(open(os.path.join(HERE, 'book_lines.json')))


def norm(s):
    return re.sub(r'[ ⠀\xa0]', '', s).lower()


def runs(s):
    """leading run, list of inner runs, tokens"""
    s = s.rstrip()
    m = re.match(r' *', s)
    lead = len(m.group(0))
    toks = re.split(r'( +)', s[lead:])
    words = toks[0::2]
    gaps = [len(g) for g in toks[1::2]]
    return lead, gaps, words


def book_seq(pages):
    seq = []
    for pg in pages:
        if 0 <= pg < len(P):
            for i, l in enumerate(P[pg]):
                if norm(l['text']):
                    seq.append(l)
    return seq


def _match(a, b, gi, book, pairs, ia, ib, key):
    """match a[ia] vs b[ib] index lists with SequenceMatcher on key(); recurse into gaps"""
    A = [key[0](a[i]) for i in ia]
    B = [key[0](b[j]) for j in ib]
    sm = difflib.SequenceMatcher(None, A, B, autojunk=False)
    gaps = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == 'equal':
            for k in range(i2 - i1):
                pairs[gi[ia[i1 + k]][0]] = (book[ib[j1 + k]], key[1])
        elif i2 > i1 and j2 > j1:
            gaps.append((ia[i1:i2], ib[j1:j2]))
    return gaps


def align(gold_lines, book):
    best = None
    for exact_first in (True, False):
        pr, n = align1(gold_lines, book, exact_first)
        score = (len(pr), sum(1 for i, (bl, h) in pr.items() if bl['text'].rstrip() == gold_lines[i].rstrip()))
        if best is None or score > best[0]:
            best = (score, pr, n)
    return best[1], best[2]


def align1(gold_lines, book, exact_first):
    gi = [(i, g) for i, g in enumerate(gold_lines) if norm(g)]
    a = [g for _, g in gi]
    b = [l['text'] for l in book]
    pairs = {}
    if exact_first:
        gaps = _match(a, b, gi, book, pairs, list(range(len(a))), list(range(len(b))), (lambda s: s.rstrip().lower(), 'exact'))
    else:
        gaps = [(list(range(len(a))), list(range(len(b))))]
    gaps2 = []
    for ia, ib in gaps:
        gaps2 += _match(a, b, gi, book, pairs, ia, ib, (norm, 'norm'))
    for ia, ib in gaps2:
        used = set()
        for k in ia:
            best, bj = 0, None
            for j in ib:
                if j in used:
                    continue
                r = difflib.SequenceMatcher(None, norm(a[k]), norm(b[j]), autojunk=False).ratio()
                if r > best:
                    best, bj = r, j
            if bj is not None and best >= 0.8:
                used.add(bj)
                pairs[gi[k][0]] = (book[bj], 'fuzzy%.2f' % best)
    return pairs, len(gi)


IDX = collections.defaultdict(list)
for _pg in P:
    for _l in _pg:
        _n = norm(_l['text'])
        if _n:
            IDX[_n].append(_l['page'])


def main():
    results = []
    for f in sorted(glob.glob(GOLD + '/section-*/*.json')):
        if f.endswith('status.json'):
            continue
        d = json.load(open(f))
        br = d.get('braille') or {}
        lines = br.get('lines') if isinstance(br, dict) else None
        if not lines:
            continue
        pdfp = d.get('pdfPages') or []
        pages = sorted(set(p - 1 + k for p in pdfp for k in (-1, 0, 1)))
        book = book_seq(pages)
        pairs, nnon = align(lines, book)
        if len(pairs) < nnon:
            found = collections.Counter()
            for g in lines:
                for pg in IDX.get(norm(g), []):
                    found[pg] += 1
            if found:
                mode = found.most_common(1)[0][0]
                near = [pg for pg in found if abs(pg - mode) <= 3]
                pages2 = sorted(set(pg + k for pg in near for k in (-1, 0, 1)))
                book2 = book_seq(pages2)
                pairs2, _ = align(lines, book2)
                if len(pairs2) > len(pairs):
                    pairs, book, pages = pairs2, book2, pages2
        corrected_after = set()
        for c in d.get('corrections') or []:
            if c.get('field') == 'braille.lines':
                for x in c.get('after') or []:
                    corrected_after.add(x)
        rec = {'file': os.path.relpath(f, GOLD), 'id': d.get('id'), 'nonempty': nnon, 'matched': len(pairs),
               'unmatched': [], 'diffs': [], 'offsets': collections.Counter()}
        for i, g in enumerate(lines):
            if not norm(g):
                continue
            if i not in pairs:
                rec['unmatched'].append((i, g))
                continue
            bl, how = pairs[i]
            bt = bl['text'].rstrip()
            gl, gg, gw = runs(g)
            bL, bg, bw = runs(bt)
            if norm(g) == norm(bt):
                rec['offsets'][bL - gl] += 1
            if g.rstrip() != bt:
                rec['diffs'].append({'line': i, 'gold': g, 'book': bt, 'how': how, 'page': bl['page'],
                                     'y': bl['y'], 'agree': bl['agree'], 'x0_std': bl['x0_std'],
                                     'gold_runs': [gl, gg], 'book_runs': [bL, bg],
                                     'same_content': norm(g) == norm(bt),
                                     'errata_line': g in corrected_after})
        rec['offsets'] = dict(rec['offsets'])
        results.append(rec)
    json.dump(results, open(os.path.join(HERE, 'audit_raw.json'), 'w'), indent=1, ensure_ascii=False)
    tot = sum(r['nonempty'] for r in results)
    mat = sum(r['matched'] for r in results)
    print('samples', len(results), 'nonempty gold lines', tot, 'matched', mat)
    print('diff lines', sum(len(r['diffs']) for r in results))
    off = [(r['id'], r['offsets']) for r in results if any(k != 0 for k in r['offsets'])]
    print('samples with nonzero lead offsets', len(off))
    for o in off:
        print('  OFF', o)
    um = [(r['id'], len(r['unmatched']), r['nonempty']) for r in results if r['unmatched']]
    print('samples with unmatched lines', len(um))
    for u in um:
        print('  UM', u)


if __name__ == '__main__':
    main()
