# APH Braille Shadows — where it came from and on whose authority

## What it is

**APH Braille Shadows**, the braille typeface used by Paige. It is a *teaching*
face: the unraised dots of each cell are drawn as faint shadows, so a learner
sees the whole six-dot cell and not only the dots that are up. That is why it
suits an app used by children learning cell shapes, and why it looks different
from a plain braille font.

Files here: `.woff2` (6,960 bytes), `.woff` (11,060), `.ttf` (84,244). The `.eot`
that Paige also ships is deliberately not copied — it exists only for versions of
Internet Explorer that cannot run this app at all.

## Coverage — verified, not assumed

Many braille fonts are **ASCII-mapped**: you type `abc` and see braille shapes.
Applied to a pane holding real Unicode braille, such a font renders nothing.
This one was checked before it was wired in:

| mapping | glyphs |
|---|---|
| Unicode Braille Patterns U+2800–U+28FF | **256** — the complete 8-dot range |
| ASCII 0x20–0x7E | 95 |

So it covers every cell the engine can produce, including 8-dot, and the braille
pane can use it directly.

## Permission

**APH have agreed we may use this font.** Confirmed by Greg Hargraves and
relayed by PB on 2026-08-09, which is the authority this inclusion rests on.

The Translate audit of 2026-09-02 raised the gap between that and what the app
does - permission to *use* a font is not obviously permission to *redistribute*
it to every visitor of a public web app, which is what serving it as a webfont
is. **PB confirmed the same day that this is fine**, so the app ships it. If APH
ever put terms in writing, they belong in this file beside the sentence above.

That confirmation was needed because it could not be established from public
sources: APH's own downloads page (`aph.org/manuals-downloads`) publishes the
font with **no licence, permission or restriction statement attached**, and the
Paige repository the files were taken from declares no licence either. Checked
2026-08-09.

**If this ever needs re-establishing, ask APH directly rather than inferring
from the download being free.** A file being downloadable is not a grant of
redistribution, which is the whole reason this note exists — the same reasoning
that put the LGPL text into BrlType's bundle (task #423).

The font is third-party. It is **not** covered by this repository's CC BY-NC-SA
licence, exactly as liblouis and MathCAT are not; it is included under the
permission recorded above and keeps whatever terms APH apply to it.

## Where it is used

`Translate` — declared in `index.html` as `@font-face`
family `APHfont`, first in the braille pane's stack, with
`"Apple Braille","Segoe UI Symbol",monospace` behind it so the pane still
renders if the file is ever absent.

---

# Inter — the interface typeface

**Inter**, by Rasmus Andersson and the Inter Project Authors. Seven Unicode
subsets as `.woff2`, one variable face each covering weights 400–700:
latin, latin-ext, greek, greek-ext, cyrillic, cyrillic-ext, vietnamese —
224 KB in total.

## Licence

**SIL Open Font License 1.1**, which expressly permits redistribution. The full
text travels beside the files as `Inter-OFL.txt`. Unlike APH Braille Shadows,
this one needs no private permission: the licence is the permission.

## Why it is here and not on a CDN

It used to be loaded from `fonts.googleapis.com`, which cost two things:

- **The offline promise.** The app's own help says it "keeps working with no
  internet connection". That was true of everything except its typeface — on a
  school network that blocks Google, or with no connection at all, the interface
  silently changed face.
- **Privacy.** A cross-origin font request carries the user's IP address and
  User-Agent to a third party on every page load. For a children's app in UK and
  EU schools that is a question a data protection officer is entitled to ask, and
  a German court found the same arrangement breached GDPR in 2022.

## Why all seven subsets

This app back-translates 142 braille codes. Its print pane can therefore
legitimately contain Greek, Cyrillic and Vietnamese, and a latin-only font would
drop exactly those readers back to a system fallback. The subsets load on demand
by `unicode-range`, so an English user still fetches only the latin file.
