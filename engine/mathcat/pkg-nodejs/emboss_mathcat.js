/* @ts-self-types="./emboss_mathcat.d.ts" */

/**
 * Return MathCAT's own version string (from its Cargo.toml), useful as a smoke test
 * that the module loaded and initialized correctly.
 * @returns {string}
 */
function mathcat_version() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.mathcat_version();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.mathcat_version = mathcat_version;

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
 * @param {string} mathml
 * @param {string} code
 * @returns {string}
 */
function mathml_to_braille(mathml, code) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(mathml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(code, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.mathml_to_braille(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.mathml_to_braille = mathml_to_braille;

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
 * @param {string} mathml
 * @returns {string}
 */
function mathml_to_speech(mathml) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(mathml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mathml_to_speech(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}
exports.mathml_to_speech = mathml_to_speech;

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
 * @param {string} name
 * @param {string} value
 * @returns {string}
 */
function speak_set_preference(name, value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.speak_set_preference(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
exports.speak_set_preference = speak_set_preference;

/**
 * Return the comma-separated list of braille codes MathCAT reports as supported
 * (e.g. "Nemeth, UEB, CMU, ..."), for diagnostics.
 * @returns {string}
 */
function supported_braille_codes() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.supported_braille_codes();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}
exports.supported_braille_codes = supported_braille_codes;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./emboss_mathcat_bg.js": import0,
    };
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
function decodeText(ptr, len) {
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

const wasmPath = `${__dirname}/emboss_mathcat_bg.wasm`;
const wasmBytes = require('fs').readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBytes);
let wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
