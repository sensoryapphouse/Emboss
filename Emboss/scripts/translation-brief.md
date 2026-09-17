# Emboss interface translation brief

Emboss is a braille transcription web app: an editor that turns documents into braille and sends
them to braille embossers. Its users are braille transcribers, teachers of blind students and
blind people themselves. You are translating its interface (buttons, menus, settings, messages).

## Files

- English source: `Emboss/web/locales/en.json` (307 strings, nested JSON).
- Your output: `Emboss/web/locales/<code>.json`, one file per language, using the **locale code**
  you are given (for example `be.json` for Bengali — the codes are braille-table prefixes, not
  language tags; do not rename them).
- Checker: `node Emboss/scripts/check-locale.mjs <code>` (run from the repository root
  `/Users/paulblenkhorn/Documents/Development/PWAs/To do next/Braille`).

## What to write

- Exactly the same nested keys as en.json, in the same order. Omit the top-level `"_meta"` object.
- Every value translated into the target language, in the script given for it.
- UTF-8 JSON, 2-space indentation.
- `settings.language_label` is the label "Interface Language" — translate it like any other
  string; it is not the place for the language's own name.

## Rules

1. Natural, concise interface wording, as a native software localiser would write it.
2. Keep every placeholder in curly braces exactly, in Latin letters: `{name}`, `{page}`, `{total}`,
   `{pages}`, `{count}`, `{dots}`, `{char}`, `{language}`, `{device}`, `{message}`, `{style}`,
   `{rows}`, `{cols}`, `{title}`, `{filename}`, `{blocks}`. You may move them within the sentence.
3. Keep keyboard shortcuts (`Ctrl+Z`, `⌘Z`, `Ctrl+E` …) and symbols (`(* * *)`, `…`, `—`) as they are.
4. Keep leading and trailing spaces exactly as in the English value.
5. Do not translate names and standards (keep them in Latin letters): Emboss, BANA, UKAAF, UEB,
   NIMAS, DAISY, DTBook, BRF, PEF, eBraille, MathML, LaTeX, SVG, Nemeth, liblouis, MathLive,
   DotPad, BrailleBlaster, Tiger, ViewPlus, Index, Braillo, Enabling, Web Bluetooth, WebSerial, HID.
6. Braille terms: use the language's established braille terminology where it exists (from its
   national braille authority or schools for the blind). Otherwise use a clear descriptive term.
   Concepts: braille; braille cell; braille dots; contracted and uncontracted braille; embosser
   (a printer that punches braille); embossing; transcriber's note; tactile graphic; print page
   (the page of the original printed book); running head; sidebar box.
7. If a word is normally borrowed from English in that language's software (e.g. "PDF", "USB"),
   borrowing is fine.
8. Fewer than 10% of values may stay identical to English (names and codes only).

## Checking

After writing each file run the checker for that code and fix everything it reports until it
prints `ok    <code>`.

## Honesty

If you cannot translate a language with reasonable confidence (you do not know it well enough to
write correct, natural sentences in it), do **not** write a file for it — say so in your report.
A missing language is better than a wrong one: users who choose it would see garbled text.

Do not edit any other file. Do not run git.

Report, per language: the checker's final line (or "not written" and why), and anything you were
unsure about.

## Adding new strings to an existing translation

When en.json gains keys (for example the `app.*` section and a few new `slash.*` keys), complete
each existing `<code>.json` without touching the strings it already has:

1. Write a Node script in the scratch directory that reads `en.json` and `<code>.json`, and builds a
   new object that walks `en.json` in order: for every key, use the existing translation if there is
   one, otherwise your new translation. Write it with `JSON.stringify(obj, null, 2)` (never hand-write
   the JSON text), dropping any key that en.json does not have.
2. Keep the terminology the file already uses (its word for braille, embosser, cell, print page,
   transcriber's note, table, etc.) so the new strings match the old ones.
3. Some new strings are short labels for narrow toolbars (`app.styles.short_*`, `app.styles.mini_*`);
   keep them short — a common abbreviation of the full style name in that language.
4. Run the checker until it prints `ok    <code>`.
