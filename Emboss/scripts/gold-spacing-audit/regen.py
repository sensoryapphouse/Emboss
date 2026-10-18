"""Regenerate every gold example's braille lines mechanically from the PDF (Fable review
recommendation 1), building on audit.py's line-for-line matching (which already proves matched
lines' text/spacing/case are correct post-K33 -- see regen-report.md). This script adds what the
K33 audit never checked:

  * blank lines and page breaks. PRIMARY evidence is this book's own left-margin line number
    (font `LucidaConsole`, printed beside every braille line inside a numbered worked-example
    box) -- see book_margins.py. A wholly blank braille line still gets a number: it is a row of
    literal U+2800 blank-cell glyphs, not the absence of a row, so the margin number sequence is
    definitive for both blank-line counts and leading/trailing padding, and the numbering
    restarting at 1 (or a "-New Braille Page-" marker line) definitively marks a page break.
    Only when a box has NO margin numbers at all (see regen-report.md for the count) does this
    fall back to the K33-era vertical-gap measurement between the book's own SimBraille text rows,
    in that box's own measured single-line pitch -- strictly a fallback, never the primary source;
  * lines present in the book but missing from gold, or vice versa (reported only -- never applied
    without review, since these often mean the matched window itself is wrong);
  * never against an existing `corrections` entry: if a file already records a deliberate,
    evidenced change to `braille.lines` (a BANA errata correction, or an earlier K33 spacing fix),
    the adjacent-line pairing that entry's own `after` deliberately produced is treated as
    protected and is never re-opened by a new blank-line diff -- the errata/prior correction wins
    over a fresh PDF reading, since the PDF is the book BEFORE that correction.

Usage: `python3 regen.py` writes regen_raw.json (one record per example) and prints a summary.
Requires book_lines.json and book_margins.json (run book.py and book_margins.py first).
audit_raw.json is not required -- this recomputes its own alignment via audit.align()/book_seq()
so it always sees the CURRENT gold.
"""
import json, os, re, sys, collections
import audit
from audit import GOLD, P, norm, runs, align, book_seq, IDX

HERE = os.path.dirname(os.path.abspath(__file__))
MARGINS_PATH = os.path.join(HERE, 'book_margins.json')
M = json.load(open(MARGINS_PATH, encoding='utf-8')) if os.path.exists(MARGINS_PATH) else None
Y_TOL = 1.5  # pt: a margin number and its braille row share (near enough) the same baseline y


def margin_num_at(page, y):
    """The LucidaConsole margin number printed beside the braille row at (page, y), or None if
    this page carries no margin numbers, or none is close enough to this specific y."""
    if M is None or page >= len(M):
        return None
    best = None
    for m in M[page]['margins']:
        dy = abs(m['y'] - y)
        if dy < Y_TOL and (best is None or dy < best[0]):
            best = (dy, m['num'])
    return best[1] if best else None


def marker_between(page, y_lo, y_hi):
    """True if a "-New Braille Page-" marker line falls strictly between y_lo and y_hi on `page`."""
    if M is None or page >= len(M):
        return False
    return any(y_lo < mk['y'] < y_hi for mk in M[page]['markers'])


def margin_rows_for_page(page):
    """[{'num','y','text'}], one per margin-numbered row on `page`, in Y (reading) order, with its
    braille text (via nearest-y lookup into book_lines.json's own per-page row list -- None if no
    SimBraille row sits at that y, i.e. this margin number's row could not be matched).

    IMPORTANT: a page's margin numbers are NOT unique -- numbering restarts at 1 for every
    independent box on the page (two side-by-side worked-example "Option 1"/"Option 2" boxes both
    numbered from 1, or the old/new page either side of a same-page "-New Braille Page-" break).
    Callers MUST scope by Y position (between two anchors' own y, both already known to belong to
    the one box being read) -- never by `num` value alone, which can collide across boxes."""
    if M is None or page >= len(M) or page >= len(P):
        return []
    rows = P[page]
    out = []
    for m in M[page]['margins']:
        best = None
        for r in rows:
            dy = abs(r['y'] - m['y'])
            if dy < Y_TOL and (best is None or dy < best[0]):
                best = (dy, r)
        out.append({'num': m['num'], 'y': m['y'], 'text': best[1]['text'].rstrip() if best else None})
    out.sort(key=lambda r: r['y'])
    return out


def margin_rows_between(page, y_lo, y_hi):
    """Margin-numbered rows on `page` strictly between two Y positions -- the safe way to read a
    box's own rows (see margin_rows_for_page): scoped to the one contiguous run the two given
    anchors (already known to be y_lo and y_hi on this same box) actually belong to."""
    return [r for r in margin_rows_for_page(page) if y_lo < r['y'] < y_hi]


def _non_pdf_glyphs_corrections(d):
    """Every EXISTING `braille.lines` `corrections` entry (errata, addendum, page image / K33,
    anything already in the file) whose `source` is NOT `pdf-glyphs` -- i.e. never one this script
    itself is about to add. `source` is missing on a couple of very early entries; treat those as
    non-`pdf-glyphs` too (safest default: protect, don't silently reopen)."""
    return [c for c in (d.get('corrections') or [])
            if c.get('field') == 'braille.lines' and c.get('source') != 'pdf-glyphs']


def protected_lines(d):
    """Every line of TEXT that an EXISTING non-`pdf-glyphs` correction's own `after` deliberately
    produced -- e.g. a BANA errata or addendum's replacement wording, which differs from this PDF
    ON PURPOSE (the PDF predates the correction). Any gold line matching one of these must never be
    changed OR removed by regeneration, no matter where in a gap it sits (not just when it happens
    to be one of the two lines immediately flanking a gap -- see protected_pairs for that, a
    narrower and complementary check for a gap the correction closed but whose own two flanking
    lines were not themselves rewritten)."""
    lines = set()
    for c in _non_pdf_glyphs_corrections(d):
        after = c.get('after')
        if isinstance(after, list) and after and isinstance(after[0], str):
            for a in after:
                if a:  # an empty string ('' -- a blank line) is never itself "protected content"
                    lines.add(a.rstrip())
    return lines


def protected_pairs(d):
    """Adjacent-line text pairs that an EXISTING non-`pdf-glyphs` correction (errata, addendum, an
    earlier K33 spacing fix) deliberately closed by REMOVING one or more blank lines between them
    -- e.g. example-18-8's errata, which removed the blank line between two otherwise-unchanged
    lines. A candidate blank-line insertion whose two surrounding anchor lines match such a pair is
    never touched: the existing, evidenced correction wins over a fresh PDF reading (the PDF is
    the book BEFORE that correction).

    Deliberately narrow: computed from a before/after DIFF (`difflib`), taking only a pair either
    side of a pure blank-line deletion, never every adjacent pair in a correction's `after` --
    that naive, broader version flagged nearly every OTHER pair in any multi-line correction's own
    ordinary content as "protected" too (any two lines that happen to sit next to each other in
    some past correction's output), which is not what "protected" means and made this check fire
    on completely unrelated, legitimate edits elsewhere in the same block."""
    import difflib
    pairs = set()
    for c in _non_pdf_glyphs_corrections(d):
        before, after = c.get('before'), c.get('after')
        if not (isinstance(before, list) and isinstance(after, list) and before and after
                and isinstance(before[0], str) and isinstance(after[0], str)):
            continue
        sm = difflib.SequenceMatcher(None, before, after, autojunk=False)
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'delete' and all(x == '' for x in before[i1:i2]) and 0 <= j1 - 1 and j1 < len(after):
                pairs.add((after[j1 - 1].rstrip(), after[j1].rstrip()))
    return pairs


def gap_is_protected(gap_gold, prot_lines, pair=None, prot_pairs=None):
    """True if this candidate gap must not be touched: either one of its OWN current lines is
    protected content (protected_lines), or (for an interior gap only, when both `pair` and
    `prot_pairs` are given) the two anchor lines flanking it match a pair an existing correction
    deliberately closed (protected_pairs)."""
    if any(x and x.rstrip() in prot_lines for x in gap_gold):
        return True
    if pair is not None and prot_pairs is not None and pair in prot_pairs:
        return True
    return False

# Global fallback vertical line-pitch per SimBraille font size, used only when an example itself
# offers no confident-bootstrap zero-blank gap to measure its own local pitch from (see pitch_for()).
# Measured corpuswide (gold-spacing-audit/README's approach, mirrored vertically): consecutive
# same-page same-size row deltas cluster tightly at these values for size 16 (single cluster) and
# in three separate clusters for size 14 (different box/line-spacing styles both set in 14pt type).
GLOBAL_PITCH = {16: 20.8}
GLOBAL_PITCH_CLUSTERS = {14: [16.5, 17.7, 21.4], 16: [20.8]}


def nearest_cluster(size, x):
    cands = GLOBAL_PITCH_CLUSTERS.get(size, [x])
    return min(cands, key=lambda c: abs(c - x))


def pitch_for(size, local_samples):
    """Local single-line pitch for this example: median of its own zero-blank (dy<30) gaps if it
    has at least 2; otherwise the nearest known global cluster for this font size."""
    small = [d for d in local_samples if d < 30]
    if len(small) >= 2:
        small.sort()
        return small[len(small) // 2]
    if local_samples:
        return nearest_cluster(size, min(local_samples))
    return GLOBAL_PITCH.get(size, 16.5)


def pagebreak_gold_gaps(d):
    """0-based gold-line index `ga` such that a NEW BRAILLE PAGE starts right after gold.lines[ga]
    -- per the gold's OWN, already-well-evidenced `braille.pageBreaks` (never re-derived here; see
    the regen-report's "page breaks" section for how this book represents one). `pageBreaks`'
    schema is not consistent across files (K28-era hand annotation, not a fixed format):
      - a bare int, or a dict with `afterLineIndex`: both use a 1-based "after this many lines"
        count, so the 0-based array index of the LAST line before the break is (value - 1);
      - a dict with `index` and a `label` mentioning "New Braille Page": same arithmetic --
        `index` here is the 0-based array index of the FIRST line of the new page, which is
        numerically identical to (afterLineIndex - 1);
      - a dict with `index` whose `label` says something else (seen: "print page change
        indicator") is NOT a braille-page break at all -- it marks an embedded indicator LINE
        within one continuous braille page (the print, not braille, page turned), so it is
        ignored here; it has no effect on vertical spacing.
    """
    br = d.get('braille') or {}
    pb = br.get('pageBreaks') or []
    gaps = set()
    for x in pb:
        if isinstance(x, int):
            gaps.add(x - 1)
        elif isinstance(x, dict) and 'afterLineIndex' in x:
            gaps.add(x['afterLineIndex'] - 1)
        elif isinstance(x, dict) and 'index' in x and re.search(r'new braille page', str(x.get('label', '')), re.I):
            gaps.add(x['index'] - 1)
    return gaps


def get_book_window(d):
    """Reproduce audit.main()'s page-window selection (initial pdfPages +-1, widened via IDX if
    that under-matches) for one gold example dict; return (pairs, book, pages, nnon)."""
    br = d.get('braille') or {}
    lines = br.get('lines') if isinstance(br, dict) else None
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
    return pairs, book, pages, nnon


def classify_example(f, d):
    br = d['braille']
    lines = br['lines']
    pairs, book, pages, nnon = get_book_window(d)
    idx_of = {id(row): i for i, row in enumerate(book)}
    anchors = sorted(((i, idx_of[id(bl)]) for i, (bl, how) in pairs.items()), key=lambda p: p[0])
    # SAFETY: this book repeats near-identical lines between neighbouring examples on the same
    # page (worked-example pairs that share opening lines but differ in what comes after -- e.g.
    # Example 21-3 "Blank Lines Indicating..." and Example 21-4 "...not Indicated" share their
    # first two lines verbatim a few lines apart, on the SAME PDF page, illustrating opposite
    # rules about the very blank line in question). Silently trusting whichever occurrence
    # align()'s SequenceMatcher happened to pick would misattribute inter-example spacing.
    # Any anchor whose own text appears more than once in this example's book window is
    # therefore treated as ambiguous and excluded from blank-line inference and missing/extra
    # detection -- both of which depend on knowing exactly which book row an anchor is.
    # Only a NEARBY duplicate PAIR is the real risk: a neighbouring worked example a handful of
    # lines away that shares a whole RUN of opening lines verbatim (e.g. Example 21-3 and Example
    # 21-4 share their first two lines, a few lines apart, on the very same page, before diverging
    # on the blank line this check exists to protect). A single short line recurring in isolation
    # (a page-number reference like "#aebe" used twice for two different entries in one and the
    # same example, "444", a blank filler row) is not, by itself, a realistic source of anchor
    # confusion for align()'s SequenceMatcher, and would swamp this check if flagged alone -- so an
    # anchor is only "ambiguous" when its OWN neighbour (the next book row, or the previous one)
    # ALSO matches the corresponding neighbour of some other nearby occurrence, i.e. a genuine
    # parallel run of >= 2 lines, not a coincidental one-line repeat.
    NEARBY = 12
    ambiguous_book_idx = set()
    for i, row in enumerate(book):
        t = row['text'].rstrip()
        if not t:
            continue
        lo, hi = max(0, i - NEARBY), min(len(book), i + NEARBY + 1)
        for j in range(lo, hi):
            if j == i or book[j]['text'].rstrip() != t:
                continue
            next_match = (i + 1 < len(book) and j + 1 < len(book) and book[i + 1]['text'].rstrip() == book[j + 1]['text'].rstrip() and book[i+1]['text'].rstrip())
            prev_match = (i - 1 >= 0 and j - 1 >= 0 and book[i - 1]['text'].rstrip() == book[j - 1]['text'].rstrip() and book[i-1]['text'].rstrip())
            if next_match or prev_match:
                ambiguous_book_idx.add(i)
                break

    rec = {'file': f, 'id': d.get('id'), 'pages': pages, 'nonempty': nnon, 'matched': len(pairs),
           'anchors_n': len(anchors), 'issues': [], 'corrections': [], 'regen_lines': list(lines)}

    if not anchors:
        rec['issues'].append(('example boundary unclear', 'no book line matched at all'))
        rec['has_margin'] = False
        return rec
    rec['has_margin'] = bool(M and any(M[book[bi]['page']]['margins'] for _, bi in anchors if book[bi]['page'] < len(M)))

    # monotonic check
    book_idxs = [b for _, b in anchors]
    if book_idxs != sorted(book_idxs):
        rec['issues'].append(('example boundary unclear', 'matched book lines are out of order'))
        return rec

    # local pitch bootstrap samples: dy between consecutive anchors that have ZERO gold blank
    # lines between them (gold most likely already got that right -- blank-line miscounts are a
    # multi-line-run problem, not a single-adjacency one)
    local_dy = collections.defaultdict(list)  # size -> [dy,...]
    for (ga, ba), (gb, bb) in zip(anchors, anchors[1:]):
        if bb - ba == 1 and gb - ga >= 1 and ba not in ambiguous_book_idx and bb not in ambiguous_book_idx:
            gap_gold = lines[ga + 1:gb]
            if all(x == '' for x in gap_gold) and not gap_gold:
                # ga+1..gb-1 empty range means gb == ga+1, i.e. no gold lines between at all
                sa, sb = book[ba]['size'], book[bb]['size']
                if sa == sb and book[ba]['page'] == book[bb]['page']:
                    local_dy[sa].append(book[bb]['y'] - book[ba]['y'])

    any_missing_extra = False
    any_boundary_issue = False
    any_protected = False
    blank_diffs = []  # (gold_idx_range, old_lines, new_lines, evidence)
    pb_gaps = pagebreak_gold_gaps(d)
    protected = protected_pairs(d)
    prot_lines = protected_lines(d)

    for (ga, ba), (gb, bb) in zip(anchors, anchors[1:]):
        if ba in ambiguous_book_idx or bb in ambiguous_book_idx:
            rec['issues'].append(('example boundary unclear',
                                   'gold lines %d..%d: an anchor\'s text (%r) repeats elsewhere in this example\'s own book window -- which occurrence align() picked is not trustworthy here, so this gap is left for review'
                                   % (ga, gb, book[ba]['text'].rstrip() if ba in ambiguous_book_idx else book[bb]['text'].rstrip())))
            any_boundary_issue = True
            continue
        gap_gold = lines[ga + 1:gb]
        pair = (book[ba]['text'].rstrip(), book[bb]['text'].rstrip())
        is_protected = gap_is_protected(gap_gold, prot_lines, pair, protected)

        # PRIMARY evidence: the book's own left-margin line numbers, when this box has them and
        # both anchors are on the same PDF page. The margin-number run between them is definitive
        # -- both for the blank-line count AND for any missing/extra content line -- UNLESS a
        # "-New Braille Page-" marker sits between them (a real page break: the vertical/margin
        # gap is the marker and page footer/header, never blank braille lines).
        ma = margin_num_at(book[ba]['page'], book[ba]['y'])
        mb = margin_num_at(book[bb]['page'], book[bb]['y'])
        if ma is not None and mb is not None and book[ba]['page'] == book[bb]['page']:
            page = book[ba]['page']
            if marker_between(page, book[ba]['y'], book[bb]['y']) or mb <= ma:
                # a real page break (marker text, or the numbering restarting) -- exclude, and
                # cross-check against the gold's own recorded pageBreaks separately (see main()).
                if any(x == '' for x in gap_gold):
                    rec['issues'].append(('example boundary unclear' if ga not in pb_gaps else 'page break (confirmed)',
                                           'gold has %d blank line(s) exactly at a braille-page boundary (margin numbering %s%s) (gold lines %d..%d)%s'
                                           % (len(gap_gold), '%d->%d' % (ma, mb), ', marker' if marker_between(page, book[ba]['y'], book[bb]['y']) else '',
                                              ga, gb, '' if ga not in pb_gaps else ' -- matches braille.pageBreaks, left untouched')))
                    if ga not in pb_gaps:
                        any_boundary_issue = True
                continue
            between = margin_rows_between(page, book[ba]['y'], book[bb]['y'])
            expected_nums = [r['num'] for r in between]
            if expected_nums != list(range(ma + 1, mb)):
                rec['issues'].append(('example boundary unclear',
                                       'gold lines %d..%d: margin numbers between this box\'s own y-window on PDF p.%d are %r, not the expected contiguous %d..%d -- left for review'
                                       % (ga, gb, page + 1, expected_nums, ma + 1, mb - 1)))
                any_boundary_issue = True
                continue
            expected = [r['text'] for r in between]
            if any(t is None for t in expected):
                rec['issues'].append(('example boundary unclear',
                                       'gold lines %d..%d: a margin-numbered row between %d and %d on PDF p.%d could not be matched to a braille row -- left for review'
                                       % (ga, gb, ma, mb, page + 1)))
                any_boundary_issue = True
                continue
            if expected == [x for x in gap_gold]:
                continue  # margin evidence confirms gold is already exactly right
            if is_protected:
                rec['issues'].append(('protected by correction',
                                       'gold lines %d..%d: margin numbers %d->%d on PDF p.%d say %r, gold has %r, but an existing `corrections` entry already made this pairing deliberately -- left untouched'
                                       % (ga, gb, ma, mb, page + 1, expected, list(gap_gold))))
                any_protected = True
                continue
            blank_diffs.append((ga + 1, gb, list(gap_gold), expected,
                                 'PDF p.%d, margin line numbers %d..%d (primary evidence: this book\'s own left-margin numbering, including numbered blank rows): gives %r; gold had %r'
                                 % (page + 1, ma + 1, mb - 1, expected, list(gap_gold))))
            continue

        # FALLBACK: no margin numbers on this box (or the anchors cross a page) -- the K33-era
        # vertical-gap measurement, strictly secondary to margin-number evidence above.
        n_between_book = bb - ba - 1
        gap_nonblank = [x for x in gap_gold if norm(x)]
        if n_between_book > 0 or gap_nonblank:
            # content lines the book has that gold lacks (or an unmatched gold line in the gap) --
            # needs a human/careful merge, never auto-applied.
            extra_book_texts = [book[k]['text'].rstrip() for k in range(ba + 1, bb)]
            rec['issues'].append(('lines missing or extra',
                                   'between gold lines %d..%d: book has %d unmatched line(s) %r; gold has %d unmatched non-blank line(s) %r'
                                   % (ga, gb, n_between_book, extra_book_texts, len(gap_nonblank), gap_nonblank)))
            any_missing_extra = True
            continue
        # pure blank-line gap: same page needed to infer from y; a braille-PAGE boundary here
        # (per the gold's own pageBreaks, or a differing PDF page index as a fallback signal)
        # means the vertical gap is the "-New Braille Page-" marker/footer/header, not blank
        # braille lines -- never invent blank lines across one.
        if ga in pb_gaps or book[ba]['page'] != book[bb]['page']:
            if any(x == '' for x in gap_gold):
                rec['issues'].append(('example boundary unclear' if ga not in pb_gaps else 'page break (confirmed)',
                                       'gold has %d blank line(s) exactly at a braille-page boundary (gold lines %d..%d)%s'
                                       % (len(gap_gold), ga, gb, '' if ga not in pb_gaps else ' -- matches braille.pageBreaks, left untouched')))
                if ga not in pb_gaps:
                    any_boundary_issue = True
            continue
        size = book[ba]['size']
        dy = book[bb]['y'] - book[ba]['y']
        pitch = pitch_for(size, local_dy.get(size, []))
        ratio = dy / pitch
        nblanks_book = max(0, round(ratio) - 1)
        resid = abs(ratio - round(ratio))
        nblanks_gold = len(gap_gold)  # gap_gold here is all '' since gap_nonblank was empty
        if nblanks_book == nblanks_gold:
            continue  # no disagreement -- the pitch estimate's residual doesn't matter here
        if resid > 0.15:
            rec['issues'].append(('example boundary unclear',
                                   'low-confidence blank-line count between gold lines %d..%d (dy=%.2f pitch=%.3f ratio=%.3f; book would give %d, gold has %d)'
                                   % (ga, gb, dy, pitch, ratio, nblanks_book, nblanks_gold)))
            any_boundary_issue = True
            continue
        if is_protected:
            rec['issues'].append(('protected by correction',
                                   'gold lines %d..%d: vertical gap says %d blank line(s), gold has %d, but an existing `corrections` entry already made this pairing deliberately -- left untouched'
                                   % (ga, gb, nblanks_book, nblanks_gold)))
            any_protected = True
            continue
        blank_diffs.append((ga + 1, gb, list(gap_gold), [''] * nblanks_book,
                             'PDF pp.%d (SimBraille row y=%.1f/%.1f, size %dpt, pitch %.3fpt): %d line-pitch(es) of vertical gap => %d blank line(s); gold had %d'
                             % (book[ba]['page'] + 1, book[ba]['y'], book[bb]['y'], size, pitch, round(ratio), nblanks_book, nblanks_gold)))

    # Leading/trailing: with margin numbers, a leading/trailing gap can often be CONFIRMED --
    # margin numbers 1..(first anchor's number - 1) on the same page are, by construction, part of
    # the SAME box (margin numbering only resets at a page break, never mid-box), so if every one
    # of them is a blank (U+2800) row, the box itself proves how many leading blanks belong there.
    # Only ever proposes a fix when EVERY row in the run is confirmed blank; if any is real content
    # the excerpt is deliberately starting/ending partway through the box and this is left as an
    # unverified boundary (its content is still reported, since that is useful on its own).
    ga0, ba0 = anchors[0]
    gbN, baN = anchors[-1]
    gold_leading = list(lines[:ga0])
    gold_trailing = list(lines[gbN + 1:])
    ma0 = margin_num_at(book[ba0]['page'], book[ba0]['y'])
    mN = margin_num_at(book[baN]['page'], book[baN]['y'])
    handled_leading = handled_trailing = False

    # Both walks work purely in Y-order on THIS page (never by comparing `num` values alone, which
    # collide across independent boxes -- see margin_rows_for_page's docstring) -- immediate
    # neighbour rows are only ever accepted while their margin number is exactly +-1 of the last
    # accepted one AND no "-New Braille Page-" marker sits between them, so the walk can never
    # cross into a different box or a different numbering run even if it shares number values.
    if ma0 is not None:
        page = book[ba0]['page']
        rows = margin_rows_for_page(page)
        idx0 = next((i for i, r in enumerate(rows) if abs(r['y'] - book[ba0]['y']) < Y_TOL), None)
        prefix = []  # nearest-first (walking backward), then reversed to reading order
        want = None
        if idx0 is not None:
            want, prev_y = ma0 - 1, book[ba0]['y']
            i = idx0 - 1
            while i >= 0 and rows[i]['num'] == want and not marker_between(page, rows[i]['y'], prev_y):
                prefix.append(rows[i])
                want -= 1
                prev_y = rows[i]['y']
                i -= 1
        prefix.reverse()
        if prefix and want == 0 and all(r['text'] == '' for r in prefix):
            handled_leading = True
            expected_leading = [''] * len(prefix)
            if gold_leading != expected_leading:
                if gap_is_protected(gold_leading, prot_lines):
                    rec['issues'].append(('protected by correction',
                                           'leading: PDF p.%d says %d blank line(s), gold has %d, but an existing `corrections` entry already made this deliberately -- left untouched'
                                           % (page + 1, len(expected_leading), len(gold_leading))))
                    any_protected = True
                else:
                    blank_diffs.append((0, ga0, gold_leading, expected_leading,
                                         'PDF p.%d, margin line numbers 1..%d (all confirmed blank, immediately preceding this box\'s first matched line): %d leading blank line(s); gold had %d'
                                         % (page + 1, ma0 - 1, len(expected_leading), len(gold_leading))))
        elif ma0 == 1:
            handled_leading = True  # box starts exactly here: 0 leading lines, by construction
            if gold_leading:
                if gap_is_protected(gold_leading, prot_lines):
                    rec['issues'].append(('protected by correction',
                                           'leading: PDF p.%d: this box\'s first matched line is itself margin line 1 -- 0 leading blank line(s), gold has %d, but an existing `corrections` entry already made this deliberately -- left untouched'
                                           % (page + 1, len(gold_leading))))
                    any_protected = True
                else:
                    blank_diffs.append((0, ga0, gold_leading, [],
                                         'PDF p.%d: this box\'s first matched line is itself margin line 1 -- 0 leading blank line(s); gold had %d'
                                         % (page + 1, len(gold_leading))))
        elif prefix and any(r['text'] != '' for r in prefix):
            rec['issues'].append(('example boundary unclear',
                                   'leading: margin line(s) %s on PDF p.%d before this box\'s first matched line are NOT all blank (e.g. %r) -- gold\'s %d leading blank line(s) left unverified (the excerpt may deliberately start past real content)'
                                   % ([r['num'] for r in prefix], page + 1, next(r['text'] for r in prefix if r['text'] != ''), len(gold_leading))))
            any_boundary_issue = True
            handled_leading = True

    if mN is not None:
        page = book[baN]['page']
        rows = margin_rows_for_page(page)
        idxN = next((i for i, r in enumerate(rows) if abs(r['y'] - book[baN]['y']) < Y_TOL), None)
        run = []
        if idxN is not None:
            want, prev_y = mN + 1, book[baN]['y']
            i = idxN + 1
            while i < len(rows) and rows[i]['num'] == want and not marker_between(page, prev_y, rows[i]['y']) and rows[i]['text'] == '':
                run.append(rows[i])
                want += 1
                prev_y = rows[i]['y']
                i += 1
            handled_trailing = True
        if handled_trailing:
            expected_trailing = [''] * len(run)
            if gold_trailing != expected_trailing:
                if gap_is_protected(gold_trailing, prot_lines):
                    rec['issues'].append(('protected by correction',
                                           'trailing: PDF p.%d says %d blank line(s), gold has %d, but an existing `corrections` entry already made this deliberately -- left untouched'
                                           % (page + 1, len(expected_trailing), len(gold_trailing))))
                    any_protected = True
                else:
                    blank_diffs.append((gbN + 1, len(lines), gold_trailing, expected_trailing,
                                         'PDF p.%d, margin line numbers %d..%d (confirmed blank, immediately following this box\'s last matched line): %d trailing blank line(s); gold had %d'
                                         % (page + 1, mN + 1, mN + len(run), len(expected_trailing), len(gold_trailing))))

    if not handled_leading and gold_leading and any(x == '' for x in gold_leading):
        rec['issues'].append(('example boundary unclear', 'gold has %d leading blank line(s) before the first matched line -- not verified (this box has no margin numbers)' % sum(1 for x in gold_leading if x == '')))
        any_boundary_issue = True
    if not handled_trailing and gold_trailing and any(x == '' for x in gold_trailing):
        rec['issues'].append(('example boundary unclear', 'gold has %d trailing blank line(s) after the last matched line -- not verified (this box has no margin numbers)' % sum(1 for x in gold_trailing if x == '')))
        any_boundary_issue = True

    rec['blank_diffs'] = [{'gold_start': a, 'gold_end': b, 'before': bef, 'after': aft, 'evidence': ev}
                           for a, b, bef, aft, ev in blank_diffs]
    rec['any_missing_extra'] = any_missing_extra
    rec['any_boundary_issue'] = any_boundary_issue
    rec['any_protected'] = any_protected

    # apply blank_diffs to regen_lines (right-to-left so indices stay valid)
    new_lines = list(lines)
    for a, b, bef, aft, ev in sorted(blank_diffs, key=lambda t: -t[0]):
        assert new_lines[a:b] == bef, (f, a, b)
        new_lines[a:b] = aft
    rec['regen_lines'] = new_lines
    return rec


def true_breaks(d):
    """Find every REAL page break within this example's own anchored span, straight from the
    book's margin numbers/markers (never from `pageBreaks` itself) -- a list of (ga, evidence)
    where `ga` is the 0-based gold-array index of the LAST line before the break. Used only to
    verify `pageBreaks` against the book (regen-report.md); never used to alter gold."""
    br = d.get('braille') or {}
    lines = br.get('lines') if isinstance(br, dict) else None
    if not lines:
        return []
    pairs, book, pages, nnon = get_book_window(d)
    idx_of = {id(row): i for i, row in enumerate(book)}
    anchors = sorted(((i, idx_of[id(bl)]) for i, (bl, how) in pairs.items()), key=lambda p: p[0])
    out = []
    for (ga, ba), (gb, bb) in zip(anchors, anchors[1:]):
        same_page = book[ba]['page'] == book[bb]['page']
        ma = margin_num_at(book[ba]['page'], book[ba]['y']) if same_page else None
        mb = margin_num_at(book[bb]['page'], book[bb]['y']) if same_page else None
        if not same_page:
            out.append((ga, 'PDF page %d -> %d' % (book[ba]['page'] + 1, book[bb]['page'] + 1)))
        elif ma is not None and mb is not None and mb <= ma:
            out.append((ga, 'margin numbering %d -> %d on PDF p.%d' % (ma, mb, book[ba]['page'] + 1)))
        elif marker_between(book[ba]['page'], book[ba]['y'], book[bb]['y']):
            out.append((ga, '"-New Braille Page-" marker on PDF p.%d' % (book[ba]['page'] + 1,)))
    return out


def pagebreaks_report(d):
    """Every recorded `braille.pageBreaks` entry's various possible readings vs the TRUE break
    position(s) found directly from the book (see true_breaks): used to work out (and report) what
    this field's inconsistent schema actually means file by file, never to alter gold."""
    br = d.get('braille') or {}
    pb = br.get('pageBreaks') or []
    if not pb:
        return None
    tb = true_breaks(d)
    entries = []
    for x in pb:
        if isinstance(x, int):
            entries.append({'raw': x, 'kind': 'bareint'})
        elif isinstance(x, dict) and 'afterLineIndex' in x:
            entries.append({'raw': x['afterLineIndex'], 'kind': 'afterLineIndex'})
        elif isinstance(x, dict) and 'index' in x:
            is_break = bool(re.search(r'new braille page', str(x.get('label', '')), re.I))
            entries.append({'raw': x['index'], 'kind': 'index(New Braille Page)' if is_break else 'index(other, not a break)'})
    return {'true_breaks': tb, 'entries': entries}


def main():
    files = sorted(f for f in [os.path.relpath(p, GOLD) for p in
                                __import__('glob').glob(GOLD + '/section-*/*.json')] if not f.endswith('status.json'))
    results = []
    for f in files:
        path = os.path.join(GOLD, f)
        d = json.load(open(path, encoding='utf-8'))
        br = d.get('braille') or {}
        lines = br.get('lines') if isinstance(br, dict) else None
        if not lines:
            continue
        rec = classify_example(f, d)
        results.append(rec)
    json.dump(results, open(os.path.join(HERE, 'regen_raw.json'), 'w'), indent=1, ensure_ascii=False)
    n_blank_diff_examples = sum(1 for r in results if r.get('blank_diffs'))
    n_blank_diff_lines = sum(len(r.get('blank_diffs', [])) for r in results)
    n_missing_extra = sum(1 for r in results if r.get('any_missing_extra'))
    n_boundary = sum(1 for r in results if r.get('any_boundary_issue'))
    n_protected = sum(1 for r in results if r.get('any_protected'))
    n_clean = sum(1 for r in results if not r['issues'] and not r.get('blank_diffs'))
    n_margin = sum(1 for r in results if r.get('has_margin'))
    print('examples', len(results))
    print('examples whose box has margin line numbers (primary evidence)', n_margin)
    print('examples whose box has NO margin numbers (vertical-gap fallback)', len(results) - n_margin)
    print('clean (no issues at all)', n_clean)
    print('examples with a blank-line difference', n_blank_diff_examples, '(', n_blank_diff_lines, 'gaps )')
    print('examples with missing/extra lines (not applied)', n_missing_extra)
    print('examples with a boundary issue (not applied)', n_boundary)
    print('examples with a gap protected by an existing correction (not applied)', n_protected)


if __name__ == '__main__':
    main()
