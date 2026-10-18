"""Phase 2: apply corrections.json to the gold files with minimal text edits, recording a `corrections` entry."""
import json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
# Always the caller's own checkout/worktree root (never hard-coded to the main checkout), so this
# writes gold files in the worktree that is running it, never in the canonical repo.
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE))) + '/'
C = json.load(open(os.path.join(HERE, 'corrections.json')))
DRY = '--dry' in sys.argv
dec = json.JSONDecoder()

by_file = collections.defaultdict(list)
for c in C:
    by_file[c['file']].append(c)


def enc(s):
    return json.dumps(s, ensure_ascii=False)


def array_spans(text, start):
    """text[start] == '['; return list of (s, e) spans of each element, and the end index of ']'."""
    assert text[start] == '['
    i = start + 1
    spans = []
    while True:
        while text[i] in ' \t\r\n,':
            i += 1
        if text[i] == ']':
            return spans, i
        _, e = dec.raw_decode(text, i)
        spans.append((i, e))
        i = e


def describe(entries):
    kinds = collections.Counter()
    cons = collections.Counter()
    for c in entries:
        k = c['kind']
        k = ('two blank cells collapsed to one' if k == '2→1 collapse' else
             'two blank cells collapsed to one, with a later gap widened by one' if k.startswith('2→1 collapse,') else
             'spurious extra blanks (gold line wider than 40 cells)' if k.startswith('gold line too') else
             'run misplaced' if k.startswith('other') else k)
        kinds[k] += 1
        for x in c['constructs']:
            cons[x] += 1
    return kinds, cons


total_lines = 0
for f, entries in sorted(by_file.items()):
    path = ROOT + f
    text = open(path, encoding='utf-8').read()
    d = json.loads(text)
    lines = d['braille']['lines']
    new_lines = list(lines)
    before, after = [], []
    block = [c for c in entries if 'lineEnd' in c]
    single = sorted([c for c in entries if 'lineEnd' not in c], key=lambda c: c['line'])
    for c in single:
        assert lines[c['line']] == c['before'], (f, c['line'], lines[c['line']], c['before'])
        new_lines[c['line']] = c['after']
        before.append(c['before'])
        after.append(c['after'])
    # locate braille.lines in the raw text
    bpos = text.index('"braille"')
    lpos = text.index('"lines"', bpos)
    apos = text.index('[', lpos)
    spans, aend = array_spans(text, apos)
    assert len(spans) == len(lines)
    edits = []  # (s, e, replacement)
    for c in single:
        s, e = spans[c['line']]
        edits.append((s, e, enc(c['after'])))
    for c in block:
        a, b = c['line'], c['lineEnd']
        assert lines[a:b + 1] == c['before'], f
        s = spans[a][0]
        e = spans[b][1]
        sep = text[spans[a][1]:spans[a + 1][0]]  # the file's own separator between elements
        edits.append((s, e, sep.join(enc(x) for x in c['after'])))
        new_lines[a:b + 1] = c['after']
        before.extend(c['before'])
        after.extend(c['after'])
    for s, e, r in sorted(edits, reverse=True):
        text = text[:s] + r + text[e:]
    kinds, cons = describe(entries)
    nchanged = sum((c['lineEnd'] - c['line'] + 1) if 'lineEnd' in c else 1 for c in entries)
    total_lines += nchanged
    idx = ', '.join(str(c['line']) + ('-' + str(c['lineEnd']) if 'lineEnd' in c else '') for c in sorted(entries, key=lambda c: c['line']))
    pages = sorted(set(int(re.search(r'PDF p\.(\d+)', c['evidence']).group(1)) for c in entries))
    note = ('K33: the gold was transcribed from a text dump of the PDF that collapses a run of exactly two blank cells '
            'to one (and in some lines adds spurious blanks). Line(s) %s rewritten to the book\'s exact cell positions, '
            'measured from the SimBraille glyph origins on PDF page %s and checked cell by cell against the 300 dpi page '
            'image (blank vs dotted cell). What changed: %s. Where: %s.' % (
                idx, ', '.join(map(str, pages)),
                '; '.join('%s (%d)' % kv for kv in kinds.most_common()),
                '; '.join('%s (%d)' % kv for kv in cons.most_common())))
    if block:
        note += (' Lines 7-14 also restore what the page image shows and the gold had left out: the column separation line '
                 'under the headings (a new line 8) and the guide dots after every row heading, so the "Row leader-dot '
                 'bar-length fills omitted" sentence in braille.notes no longer applies (they are ordinary table guide dots).')
    corr = {'date': '2026-09-26', 'source': 'page image (PDF text layer drops one of two spaces)', 'field': 'braille.lines',
            'before': before, 'after': after, 'note': note}
    # add the corrections entry
    d2 = json.loads(text)
    if 'corrections' in d2:
        cpos = text.rindex('"corrections"')
        capos = text.index('[', cpos)
        cspans, cend = array_spans(text, capos)
        # indentation of existing items
        last_s = cspans[-1][0]
        line_start = text.rindex('\n', 0, last_s) + 1
        ind = text[line_start:last_s]
        item = json.dumps(corr, indent=2, ensure_ascii=False).replace('\n', '\n' + ind)
        text = text[:cspans[-1][1]] + ',\n' + ind + item + text[cspans[-1][1]:]
    else:
        endb = text.rstrip().rindex('}')
        body_end = text[:endb].rstrip()
        item = json.dumps([corr], indent=2, ensure_ascii=False).replace('\n', '\n  ')
        text = body_end + ',\n  "corrections": ' + item + '\n' + text[endb:]
    # verify
    d3 = json.loads(text)
    exp = json.loads(open(path, encoding='utf-8').read())
    exp['braille']['lines'] = new_lines
    exp.setdefault('corrections', []).append(corr)
    assert d3 == exp, f
    if not DRY:
        open(path, 'w', encoding='utf-8').write(text)
print('files', len(by_file), 'lines changed', total_lines, 'dry' if DRY else 'WRITTEN')
