"""Apply regen.py's unambiguous blank-line corrections to the gold files, extending apply.py's own
`corrections`-entry convention (never inventing a second one): each touched file gets one more
entry appended to its `corrections` array, with `source: "pdf-glyphs"` and `reasonClass:
"blank-line"` so it is easy to tell apart from the K33 spacing entries (`source: "page image ..."`).
Only touches `braille.lines` (never `print`, `illustrates`, `status.json`, or anything else).

Usage: `python3 apply_regen.py [--dry]`. Reads regen_raw.json (run regen.py first).
"""
import json, os, sys, collections
import audit
from audit import GOLD

HERE = os.path.dirname(os.path.abspath(__file__))
DRY = '--dry' in sys.argv
dec = json.JSONDecoder()


def enc(s):
    return json.dumps(s, ensure_ascii=False)


def array_spans(text, start):
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


def apply_one_file(f, diffs):
    path = os.path.join(GOLD, f)
    text = open(path, encoding='utf-8').read()
    d = json.loads(text)
    lines = d['braille']['lines']
    bpos = text.index('"braille"')
    lpos = text.index('"lines"', bpos)
    apos = text.index('[', lpos)
    spans, aend = array_spans(text, apos)
    assert len(spans) == len(lines), (f, len(spans), len(lines))

    # Apply from the LAST gap to the FIRST so earlier indices/spans stay valid while we edit.
    diffs_sorted = sorted(diffs, key=lambda x: -x['gold_start'])
    new_lines = list(lines)
    edits = []  # (s, e, replacement_text)
    for gd in diffs_sorted:
        a, b = gd['gold_start'], gd['gold_end']  # half-open [a, b) into the CURRENT (pre-edit) array
        before, after = gd['before'], gd['after']
        assert lines[a:b] == before, (f, a, b, lines[a:b], before)
        if a == b:
            # pure insertion: nothing existing to replace. Two shapes: interior (0 < a < len(spans),
            # splice right before spans[a], reusing the separator between spans[a-1] and spans[a])
            # or a trailing append (a == len(spans), splice right after the last element, reusing
            # the separator between the last two elements) -- both reuse the file's own separator
            # style rather than inventing one.
            assert 0 < a <= len(spans), (f, a, len(spans))
            if a < len(spans):
                sep = text[spans[a - 1][1]:spans[a][0]]
                ins = ''.join(enc(x) + sep for x in after)
                s = e = spans[a][0]
            else:
                assert len(spans) >= 2, (f, 'cannot infer a separator style with < 2 existing elements')
                sep = text[spans[-2][1]:spans[-1][0]]
                ins = ''.join(sep + enc(x) for x in after)
                s = e = spans[-1][1]
            edits.append((s, e, ins))
        elif not after:
            # pure deletion of existing elements a..b-1, nothing to put back -- must also consume
            # one of the two separators around them, or we leave a dangling ",," behind.
            s, e = spans[a][0], spans[b - 1][1]
            if a > 0:
                s = spans[a - 1][1]  # eat the separator BEFORE (keeps a trailing one, if any)
            elif b < len(spans):
                e = spans[b][0]  # a == 0: nothing before to eat, so eat the one AFTER instead
            edits.append((s, e, ''))
        else:
            # replacement of existing elements a..b-1 with a non-empty `after`
            s = spans[a][0]
            e = spans[b - 1][1]
            sep = text[spans[a][1]:spans[a + 1][0]] if len(spans) > a + 1 else ', '
            edits.append((s, e, sep.join(enc(x) for x in after)))
        new_lines[a:b] = after

    for s, e, r in edits:  # edits already back-to-front since diffs_sorted is
        text = text[:s] + r + text[e:]

    # append one `corrections` entry summarising every gap fixed in this file
    kinds = collections.Counter('insert' if not gd['before'] else ('delete' if not gd['after'] else 'replace') for gd in diffs)
    note = ('Gold regeneration from the PDF (Fable review recommendation 1): the K33 spacing audit '
            '(gold-spacing-audit/) never checked blank-line counts, since a text dump has no way to '
            'show a wholly blank line at all. This regenerates blank-line counts from the vertical '
            'gap between the book\'s own SimBraille text rows either side of the gap (gap in points '
            'divided by this box\'s own measured single-line pitch, rounded), which is unaffected by '
            'the earlier 2-cells-collapsed-to-1 text-dump bug. %s. Evidence per gap: %s'
            % ('; '.join('%d %s' % (n, k) for k, n in kinds.items()),
               ' | '.join(gd['evidence'] for gd in sorted(diffs, key=lambda x: x['gold_start']))))
    ordered = sorted(diffs, key=lambda x: x['gold_start'])
    corr = {'date': '2026-09-26', 'source': 'pdf-glyphs', 'field': 'braille.lines', 'reasonClass': 'blank-line',
            'before': [x for gd in ordered for x in gd['before']],
            'after': [x for gd in ordered for x in gd['after']],
            'note': note}
    if 'corrections' in d:
        cpos = text.rindex('"corrections"')
        capos = text.index('[', cpos)
        cspans, cend = array_spans(text, capos)
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

    d3 = json.loads(text)
    exp = json.loads(open(path, encoding='utf-8').read())
    exp['braille']['lines'] = new_lines
    exp.setdefault('corrections', []).append(corr)
    assert d3 == exp, f
    if not DRY:
        open(path, 'w', encoding='utf-8').write(text)
    return len(diffs)


def main():
    R = json.load(open(os.path.join(HERE, 'regen_raw.json')))
    total_files = 0
    total_gaps = 0
    for r in R:
        diffs = r.get('blank_diffs') or []
        if not diffs:
            continue
        n = apply_one_file(r['file'], diffs)
        total_files += 1
        total_gaps += n
        print(r['file'], n, 'gap(s)')
    print('files', total_files, 'gaps', total_gaps, 'dry' if DRY else 'WRITTEN')


if __name__ == '__main__':
    main()
