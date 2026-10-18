"""Regression check for the PDF-mechanical gold regeneration (Fable review recommendation 1).

Two checks, both against the CURRENT gold files:

1. Finds every gold file that carries a `source: "pdf-glyphs"` correction (i.e. every file
   apply_regen.py has touched) and re-derives its blank-line/content diffs fresh from the PDF's
   own left-margin line numbers (primary evidence; see book_margins.py) or, where a box has none,
   the K33-era vertical-gap measurement (fallback) -- exactly as regen.py does. Fails if any of
   them now disagrees -- which would mean either the file was hand-edited afterwards without
   re-running the regeneration, or (if this ever regresses) the regeneration logic itself changed
   behaviour.
2. Across EVERY gold file (not just pdf-glyphs-touched ones), checks that every line PROTECTED by
   an existing non-`pdf-glyphs` correction (an errata/addendum wording, or a pair of lines that
   correction deliberately left adjacent -- see regen.py's `protected_lines`/`protected_pairs`) is
   still present, verbatim and in place, in `braille.lines`. Fails if not -- regeneration must
   never touch a line or gap a correction has already decided (an errata/addendum wins over a
   fresh PDF reading, since the PDF predates the correction).

The PDF (references/bana/braille-formats-2016.pdf) is untracked -- it exists only in a real
checkout that has it copied in, never in CI or a fresh clone -- so this SKIPS cleanly (exit 0,
a clear message, no failure) whenever the PDF, pymupdf, or numpy are unavailable.

Usage: `python3 check_regen.py`
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def skip(msg):
    print('SKIP:', msg)
    sys.exit(0)


def main():
    try:
        import pymupdf  # noqa: F401
        import numpy  # noqa: F401
    except ImportError as e:
        skip('required Python package not installed (%s) -- run this from a checkout with '
             'pymupdf and numpy available.' % e)

    import book  # local import: resolves the PDF path itself (worktree-local, else main checkout)
    if not os.path.exists(book.PDF):
        skip('PDF not found at %s (it is untracked -- only the main checkout has a copy).' % book.PDF)

    # Rebuild book_lines.json AND book_margins.json fresh (never trust a stale one left over from
    # a previous run) -- book_margins.json is the PRIMARY evidence (margin line numbers and
    # "-New Braille Page-" markers; see book_margins.py), book_lines.json a fallback / the source
    # of each margin number's own braille text.
    print('Rebuilding book_lines.json and book_margins.json from the PDF...')
    subprocess.run([sys.executable, os.path.join(HERE, 'book.py')], check=True, cwd=HERE,
                    stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, os.path.join(HERE, 'book_margins.py')], check=True, cwd=HERE,
                    stdout=subprocess.DEVNULL)

    import importlib
    import audit
    importlib.reload(audit)  # re-read the just-rebuilt book_lines.json and the CURRENT gold files
    import regen
    importlib.reload(regen)
    from audit import GOLD

    all_files = []
    touched = []
    for root, _dirs, files in os.walk(GOLD):
        for fn in files:
            if not fn.endswith('.json') or fn == 'status.json':
                continue
            path = os.path.join(root, fn)
            d = json.load(open(path, encoding='utf-8'))
            br = d.get('braille') or {}
            if not (isinstance(br, dict) and br.get('lines')):
                continue
            rel = os.path.relpath(path, GOLD)
            all_files.append((rel, d))
            if any(c.get('source') == 'pdf-glyphs' for c in (d.get('corrections') or [])):
                touched.append((rel, d))

    ok = True

    # --- check 1: every pdf-glyphs-touched file still agrees with a fresh regeneration ---
    if not touched:
        print('No gold file carries a pdf-glyphs correction yet -- check 1 skipped.')
    else:
        failures = []
        for f, d in touched:
            rec = regen.classify_example(f, d)
            if rec.get('blank_diffs'):
                failures.append((f, rec['blank_diffs']))
        print('Check 1: checked', len(touched), 'gold file(s) with a pdf-glyphs correction.')
        if failures:
            ok = False
            print('FAIL: the following file(s) no longer agree with a fresh PDF regeneration:')
            for f, diffs in failures:
                print(' ', f)
                for gd in diffs:
                    print('    gold lines %d..%d: book says %r, gold currently has %r'
                          % (gd['gold_start'], gd['gold_end'], gd['after'], gd['before']))
        else:
            print('OK: every pdf-glyphs-corrected gold file still agrees with the PDF.')

    # --- check 2: every line/pair PROTECTED by an existing non-pdf-glyphs correction is intact,
    # in every gold file (not just pdf-glyphs-touched ones) ---
    prot_failures = []
    n_protected_files = 0
    for f, d in all_files:
        lines = d['braille']['lines']
        prot_lines = regen.protected_lines(d)
        prot_pairs = regen.protected_pairs(d)
        if not prot_lines and not prot_pairs:
            continue
        n_protected_files += 1
        stripped = [l.rstrip() if isinstance(l, str) else l for l in lines]
        for t in prot_lines:
            if t not in stripped:
                prot_failures.append((f, 'protected line missing: %r' % t))
        for a, b in prot_pairs:
            # only meaningful to check a pair that is CURRENTLY expected adjacent -- i.e. both its
            # lines are still present at all; if the pair's own lines were themselves rewritten
            # that is already caught by the protected-line check above.
            if a in stripped and b in stripped:
                idx = [i for i, l in enumerate(stripped) if l == a]
                if not any(i + 1 < len(stripped) and stripped[i + 1] == b for i in idx):
                    prot_failures.append((f, 'protected pair no longer adjacent: %r -> %r' % (a, b)))

    print('Check 2: checked', n_protected_files, 'gold file(s) with a protected line/pair.')
    if prot_failures:
        ok = False
        print('FAIL: the following protected line(s)/pair(s) were altered:')
        for f, msg in prot_failures:
            print(' ', f, '-', msg)
    else:
        print('OK: every protected line/pair is still intact.')

    if not ok:
        sys.exit(1)


if __name__ == '__main__':
    main()
