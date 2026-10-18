"""Reconstruct every SimBraille line of braille-formats-2016.pdf with exact cell positions.

Text side: the x origin of every non-blank glyph -> cell = round((x - x0) / pitch).
Image side: render at 300 dpi and classify each cell of the same grid as
  'F' (at least one solid dot), 'g' (faint 6-dot grid only = U+2800 blank cell), ' ' (no ink).
"""
import pymupdf, json, collections, pickle, os
import numpy as np

# The PDF is untracked (not in git) and lives only in the main checkout's references/bana/,
# never in a worktree. A worktree-local copy is used if one happens to exist (e.g. a symlink
# set up by hand); otherwise fall back to the main checkout, overridable via EMBOSS_MAIN_REPO.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))  # .../gold-spacing-audit/../../..
_local_pdf = os.path.join(REPO_ROOT, 'references', 'bana', 'braille-formats-2016.pdf')
_main_repo = os.environ.get('EMBOSS_MAIN_REPO', '/Users/paulblenkhorn/Documents/Development/PWAs/To do next/Braille')
_main_pdf = os.path.join(_main_repo, 'references', 'bana', 'braille-formats-2016.pdf')
PDF = _local_pdf if os.path.exists(_local_pdf) else _main_pdf
PITCH = {14: 10.1199, 16: 11.5693}
STD = {14: [131.6, 132.0, 131.9], 16: [54.0]}
BLANK = (' ', '⠀', '\xa0')
DPI = 300
S = DPI / 72


def raw_lines(p):
    t = p.get_text('rawdict')
    chars = []
    for b in t['blocks']:
        for l in b.get('lines', []):
            for s in l['spans']:
                if s['font'] != 'SimBraille':
                    continue
                sz = round(s['size'])
                if sz not in PITCH:
                    continue
                for c in s['chars']:
                    chars.append((sz, c['origin'][1], c['origin'][0], c['c'], c['bbox']))
    # cluster by size + baseline (tolerance 3pt)
    chars.sort(key=lambda c: (c[0], c[1]))
    rows = []
    for c in chars:
        if rows and rows[-1]['size'] == c[0] and abs(rows[-1]['y'] - c[1]) < 3:
            rows[-1]['chars'].append(c)
        else:
            rows.append({'size': c[0], 'y': c[1], 'chars': [c]})
    for r in rows:
        r['chars'].sort(key=lambda c: c[2])
        r['top'] = min(c[4][1] for c in r['chars'])
        r['bot'] = max(c[4][3] for c in r['chars'])
    rows.sort(key=lambda r: r['y'])
    return rows


def first_ink_x(r):
    xs = [c[2] for c in r['chars'] if c[3] not in BLANK]
    return min(xs) if xs else None


def first_any_x(r):
    return r['chars'][0][2]


def assign_x0(rows):
    """Blocks of consecutive same-size lines whose starts are congruent modulo the pitch."""
    blocks = []
    for r in rows:
        sx = first_any_x(r)
        pitch = PITCH[r['size']]
        b = blocks[-1] if blocks else None
        ok = False
        if b and b['size'] == r['size']:
            q = (sx - b['x0']) / pitch
            ok = abs(q - round(q)) < 0.1
        if not ok:
            b = {'size': r['size'], 'x0': sx, 'rows': []}
            blocks.append(b)
        b['rows'].append(r)
        if sx < b['x0']:
            b['x0'] = sx
    for b in blocks:
        nom = PITCH[b['size']]
        diffs = [c2[2] - c1[2] for r in b['rows'] for c1, c2 in zip(r['chars'], r['chars'][1:])
                 if 0.9 * nom < c2[2] - c1[2] < 1.1 * nom]
        b['pitch'] = sum(diffs) / len(diffs) if len(diffs) >= 5 else nom
        pitch = b['pitch']
        for std in STD[b['size']]:
            q = (b['x0'] - std) / pitch
            if -0.1 < q and abs(q - round(q)) < 0.08 and round(q) <= 6:
                b['x0'] = std
                b['x0_std'] = True
                break
        for r in b['rows']:
            r['x0'] = b['x0']
            r['x0_std'] = b.get('x0_std', False)
            r['pitch'] = b['pitch']
    return rows


def text_cells(r):
    pitch = r['pitch']
    cells = {}
    maxres = 0.0
    collide = False
    for sz, y, x, c, bb in r['chars']:
        q = (x - r['x0']) / pitch
        k = int(round(q))
        if c in BLANK:
            continue
        maxres = max(maxres, abs(q - k))
        if k in cells:
            collide = True
        cells[k] = c
    n = max(cells) + 1 if cells else 0
    s = ''.join(cells.get(i, ' ') for i in range(n))
    return s, maxres, collide


def image_cells(r, img, ncells):
    pitch = r['pitch']
    top = int(r['top'] * S)
    bot = int(r['bot'] * S)
    faint = 48 * (r['size'] / 14) ** 2
    out = []
    for k in range(ncells):
        xa = int((r['x0'] + k * pitch) * S) + 1
        xb = int((r['x0'] + (k + 1) * pitch) * S) - 1
        sub = img[top:bot, xa:xb]
        n = int((sub < 128).sum())
        if n == 0:
            out.append(' ')
        elif n < faint * 1.6:
            out.append('g')
        else:
            out.append('F')
    return ''.join(out)


def build():
    d = pymupdf.open(PDF)
    pages = []
    for i, p in enumerate(d):
        rows = raw_lines(p)
        if not rows:
            pages.append([])
            continue
        assign_x0(rows)
        pix = p.get_pixmap(dpi=DPI, colorspace=pymupdf.csGRAY)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w)
        out = []
        for r in rows:
            s, res, col = text_cells(r)
            ncell = int(round((r['chars'][-1][2] - r['x0']) / r['pitch'])) + 3
            ncell = max(ncell, len(s) + 2)
            im = image_cells(r, img, ncell)
            tf = ''.join('F' if (k < len(s) and s[k] != ' ') else '.' for k in range(ncell))
            imf = ''.join('F' if c == 'F' else '.' for c in im)
            out.append({'page': i, 'size': r['size'], 'y': round(r['y'], 1), 'x0': round(r['x0'], 2),
                        'x0_std': r['x0_std'], 'pitch': round(r['pitch'], 4), 'text': s, 'maxres': round(res, 3), 'collide': col,
                        'img': im, 'agree': tf[:len(s)] == imf[:len(s)], 'trail_ink': 'F' in imf[len(s):min(len(imf), 40)],
                        'raw': ''.join(c[3] for c in r['chars'])})
        pages.append(out)
    return pages


if __name__ == '__main__':
    pages = build()
    json.dump(pages, open(os.path.join(os.path.dirname(__file__), 'book_lines.json'), 'w'), ensure_ascii=False)
    n = sum(len(p) for p in pages)
    bad = [(l['page'], l['text'], l['img']) for p in pages for l in p if not l['agree']]
    hires = [(l['page'], l['text'], l['maxres']) for p in pages for l in p if l['maxres'] > 0.2]
    col = [(l['page'], l['raw']) for p in pages for l in p if l['collide']]
    print('lines', n, 'image/text disagreements', len(bad), 'residual>0.2', len(hires), 'collisions', len(col))
    for b in bad[:40]:
        print('DISAGREE', b)
    for b in hires[:20]:
        print('RES', b)
    for b in col[:20]:
        print('COL', b)
