//! Emboss <-> MathCAT WASM bridge.
//!
//! Exposes a single JS-callable function, `mathml_to_braille`, that converts a MathML
//! string into a braille (Unicode braille dot-pattern) string using DAISY MathCAT,
//! in either the Nemeth or UEB braille code.
//!
//! Rules are embedded into the WASM binary at compile time via MathCAT's own
//! `include-zip` feature (see MathCAT's `build.rs` / `src/shim_filesystem.rs`):
//! MathCAT's build script zips up its `Rules/` directory into `$OUT_DIR/rules.zip`,
//! and `shim_filesystem.rs` embeds those bytes with `include_bytes!` and serves them
//! through an in-memory virtual filesystem shim. No real filesystem access is needed
//! or performed at runtime, which is what makes this work under WASM.

use std::cell::Cell;
use wasm_bindgen::prelude::*;

thread_local! {
    static RULES_INITIALIZED: Cell<bool> = const { Cell::new(false) };
}

/// Make sure `set_rules_dir` has been called exactly once.
/// The string "Rules" is not a real filesystem path here -- with the `include-zip`
/// feature active, all file-system calls inside MathCAT are intercepted by
/// `shim_filesystem.rs` and served from the embedded `rules.zip`, whose entries are
/// stored with a "Rules/..." prefix. So the argument must match that prefix, but it
/// is never used to touch the real filesystem.
fn ensure_rules_initialized() -> Result<(), String> {
    RULES_INITIALIZED.with(|initialized| {
        if initialized.get() {
            return Ok(());
        }
        libmathcat::set_rules_dir("Rules").map_err(|e| format!("set_rules_dir failed: {e}"))?;
        // Silence MathCAT's own file-freshness/self-check logic -- irrelevant for an
        // embedded, read-only, zipped rules set.
        let _ = libmathcat::set_preference("CheckRuleFiles", "None");
        initialized.set(true);
        Ok(())
    })
}

/// Convert a MathML string into braille using the given braille code.
///
/// `code` must be exactly "Nemeth" or "UEB" (case-sensitive; these are the values
/// MathCAT's `BrailleCode` preference accepts, confirmed from `Rules/prefs.yaml`
/// and `src/braille.rs` in the MathCAT source).
///
/// On any internal error (bad MathML, bad code, rules failed to load) this returns
/// a string starting with "ERROR: " rather than panicking, so JS callers always get
/// a string back.
#[wasm_bindgen]
pub fn mathml_to_braille(mathml: &str, code: &str) -> String {
    if let Err(e) = ensure_rules_initialized() {
        return format!("ERROR: {e}");
    }

    if let Err(e) = libmathcat::set_preference("BrailleCode", code) {
        return format!("ERROR: set_preference(BrailleCode, {code}) failed: {e}");
    }

    if let Err(e) = libmathcat::set_mathml(mathml) {
        return format!("ERROR: set_mathml failed: {e}");
    }

    match libmathcat::get_braille("") {
        Ok(braille) => braille,
        Err(e) => format!("ERROR: get_braille failed: {e}"),
    }
}

/// Speak a MathML string, returning the words MathCAT would say.
///
/// The rules that produce this are the SAME ones already embedded for braille —
/// MathCAT ships speech and braille together and this build always carried both.
/// Only the entry point was missing, which is why the app has spoken maths from
/// 140 lines of its own instead.
///
/// Preferences (see `speak_set_preference`) decide how much is said. They are
/// deliberately NOT set here: speech verbosity is a choice about the reader, not
/// a property of an expression, so the caller owns it and it persists across
/// calls the way MathCAT intends.
///
/// Same error convention as `mathml_to_braille`: a string starting "ERROR: "
/// rather than a panic, so a JS caller always gets a string.
#[wasm_bindgen]
pub fn mathml_to_speech(mathml: &str) -> String {
    if let Err(e) = ensure_rules_initialized() {
        return format!("ERROR: {e}");
    }

    if let Err(e) = libmathcat::set_mathml(mathml) {
        return format!("ERROR: set_mathml failed: {e}");
    }

    match libmathcat::get_spoken_text() {
        Ok(speech) => speech,
        Err(e) => format!("ERROR: get_spoken_text failed: {e}"),
    }
}

/// Set one MathCAT preference, for the speech dials.
///
/// The ones that matter here, with their accepted values taken from
/// `Rules/prefs.yaml` in the pinned source:
///   Language     "Auto", or a code such as "en", "es", "fr"
///   SpeechStyle  "SimpleSpeak" or "ClearSpeak"
///   Verbosity    "Terse", "Medium" or "Verbose"
///   MathRate     a percentage of the surrounding text rate, e.g. "80"
///
/// Returns "" on success and "ERROR: …" otherwise, so a caller can tell a
/// rejected value from an accepted one instead of discovering it in the speech.
#[wasm_bindgen]
pub fn speak_set_preference(name: &str, value: &str) -> String {
    if let Err(e) = ensure_rules_initialized() {
        return format!("ERROR: {e}");
    }
    match libmathcat::set_preference(name, value) {
        Ok(()) => String::new(),
        Err(e) => format!("ERROR: set_preference({name}, {value}) failed: {e}"),
    }
}

/// Return MathCAT's own version string (from its Cargo.toml), useful as a smoke test
/// that the module loaded and initialized correctly.
#[wasm_bindgen]
pub fn mathcat_version() -> String {
    libmathcat::get_version()
}

/// Return the comma-separated list of braille codes MathCAT reports as supported
/// (e.g. "Nemeth, UEB, CMU, ..."), for diagnostics.
#[wasm_bindgen]
pub fn supported_braille_codes() -> String {
    if let Err(e) = ensure_rules_initialized() {
        return format!("ERROR: {e}");
    }
    libmathcat::get_supported_braille_codes()
        .unwrap_or_default()
        .join(", ")
}
