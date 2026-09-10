/* tslint:disable */
/* eslint-disable */

/**
 * Return MathCAT's own version string (from its Cargo.toml), useful as a smoke test
 * that the module loaded and initialized correctly.
 */
export function mathcat_version(): string;

/**
 * Convert a MathML string into braille using the given braille code.
 *
 * `code` must be exactly "Nemeth" or "UEB" (case-sensitive; these are the values
 * MathCAT's `BrailleCode` preference accepts, confirmed from `Rules/prefs.yaml`
 * and `src/braille.rs` in the MathCAT source).
 *
 * On any internal error (bad MathML, bad code, rules failed to load) this returns
 * a string starting with "ERROR: " rather than panicking, so JS callers always get
 * a string back.
 */
export function mathml_to_braille(mathml: string, code: string): string;

/**
 * Speak a MathML string, returning the words MathCAT would say.
 *
 * The rules that produce this are the SAME ones already embedded for braille —
 * MathCAT ships speech and braille together and this build always carried both.
 * Only the entry point was missing, which is why the app has spoken maths from
 * 140 lines of its own instead.
 *
 * Preferences (see `speak_set_preference`) decide how much is said. They are
 * deliberately NOT set here: speech verbosity is a choice about the reader, not
 * a property of an expression, so the caller owns it and it persists across
 * calls the way MathCAT intends.
 *
 * Same error convention as `mathml_to_braille`: a string starting "ERROR: "
 * rather than a panic, so a JS caller always gets a string.
 */
export function mathml_to_speech(mathml: string): string;

/**
 * Set one MathCAT preference, for the speech dials.
 *
 * The ones that matter here, with their accepted values taken from
 * `Rules/prefs.yaml` in the pinned source:
 *   Language     "Auto", or a code such as "en", "es", "fr"
 *   SpeechStyle  "SimpleSpeak" or "ClearSpeak"
 *   Verbosity    "Terse", "Medium" or "Verbose"
 *   MathRate     a percentage of the surrounding text rate, e.g. "80"
 *
 * Returns "" on success and "ERROR: …" otherwise, so a caller can tell a
 * rejected value from an accepted one instead of discovering it in the speech.
 */
export function speak_set_preference(name: string, value: string): string;

/**
 * Return the comma-separated list of braille codes MathCAT reports as supported
 * (e.g. "Nemeth, UEB, CMU, ..."), for diagnostics.
 */
export function supported_braille_codes(): string;
