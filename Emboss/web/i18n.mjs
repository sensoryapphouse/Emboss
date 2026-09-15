// Emboss Global i18n Micro-Engine
// Lightweight (<2 KB), zero-dependency, high-performance client-side internationalization.

import { ALL_SUPPORTED_LOCALES } from './locales-data.mjs';

export const SUPPORTED_LOCALES = [...ALL_SUPPORTED_LOCALES];


const localeCache = new Map();
let currentLocale = 'en';
let fallbackDictionary = {};
let activeDictionary = {};

function normalizeCode(c) {
  return (c || 'en').toLowerCase().trim();
}

/**
 * Register an in-memory dictionary for a locale
 */
export function registerLocale(code, dictionary, info = null) {
  if (!code || !dictionary) return;
  const normalized = normalizeCode(code);
  localeCache.set(normalized, dictionary);
  if (info && !SUPPORTED_LOCALES.some(l => l.code === normalized)) {
    SUPPORTED_LOCALES.push({ code: normalized, dir: 'ltr', ...info });
  }
  if (normalized === 'en') {
    fallbackDictionary = dictionary;
  }
  if (normalized === currentLocale) {
    activeDictionary = dictionary;
  }
}

/**
 * Get metadata for a given locale code
 */
export function getLocaleInfo(code = currentLocale) {
  const normalized = normalizeCode(code);
  const base = normalized.split('-')[0];
  return SUPPORTED_LOCALES.find(l => l.code === normalized || l.code === base) || SUPPORTED_LOCALES[0];
}

/**
 * Get all supported locale metadata objects
 */
export function getSupportedLocales() {
  return [...SUPPORTED_LOCALES];
}

/**
 * Get locales ordered according to priority:
 * 1. English ('en')
 * 2. Active / current user locale (if different from en, es, fr)
 * 3. Spanish ('es')
 * 4. French ('fr')
 * 5. Remaining languages sorted alphabetically
 */
export function getOrderedLocales(currentCode = currentLocale) {
  const normCurrent = normalizeCode(currentCode).split('-')[0];
  const list = [...SUPPORTED_LOCALES];
  
  const pinnedOrder = ['en'];
  if (normCurrent && normCurrent !== 'en' && normCurrent !== 'es' && normCurrent !== 'fr') {
    pinnedOrder.push(normCurrent);
  }
  pinnedOrder.push('es', 'fr');

  const pinned = [];
  for (const code of pinnedOrder) {
    const found = list.find(l => l.code === code);
    if (found && !pinned.includes(found)) {
      pinned.push(found);
    }
  }

  const remaining = list.filter(l => !pinned.includes(l)).sort((a, b) => {
    return (a.name || a.nativeName).localeCompare(b.name || b.nativeName);
  });

  return [...pinned, ...remaining];
}

/**
 * Get current active locale code
 */
export function getLocale() {
  return currentLocale;
}

/**
 * Translate a dot-notation key (e.g. 'toolbar.insert') with optional parameter interpolation
 */
export function t(key, params = {}) {
  if (!key || typeof key !== 'string') return '';

  const getFromDict = (dict, path) => {
    if (!dict) return undefined;
    const parts = path.split('.');
    let cur = dict;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = cur[p];
    }
    return typeof cur === 'string' ? cur : undefined;
  };

  let raw = getFromDict(activeDictionary, key);
  if (raw === undefined && activeDictionary !== fallbackDictionary) {
    raw = getFromDict(fallbackDictionary, key);
  }
  if (raw === undefined) {
    // Return the key itself as safe fallback
    raw = key;
  }

  // Parameter interpolation: {name} -> value
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      raw = raw.replaceAll(`{${k}}`, String(v !== undefined && v !== null ? v : ''));
    }
  }

  return raw;
}

/**
 * Load a locale dictionary from disk or URL
 */
async function loadLocaleDictionary(code) {
  const normalized = normalizeCode(code);
  if (localeCache.has(normalized)) {
    return localeCache.get(normalized);
  }
  const base = normalized.split('-')[0];
  if (localeCache.has(base)) {
    return localeCache.get(base);
  }

  // Try browser fetch
  if (typeof fetch === 'function') {
    const candidatePaths = [
      `/web/locales/${normalized}.json`,
      `/locales/${normalized}.json`,
      `./locales/${normalized}.json`,
      `../locales/${normalized}.json`,
      `/web/locales/${base}.json`,
      `/locales/${base}.json`
    ];
    for (const p of candidatePaths) {
      try {
        const res = await fetch(`${p}?v=20260915_171500`, { cache: 'no-cache' });
        if (res.ok) {
          const dict = await res.json();
          localeCache.set(normalized, dict);
          return dict;
        }
      } catch (_) {
        // Try next path
      }
    }
  }

  // Try Node.js fs in testing / build environment
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      for (const fn of [`${normalized}.json`, `${base}.json`]) {
        const filePath = path.join(__dirname, 'locales', fn);
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          const dict = JSON.parse(content);
          localeCache.set(normalized, dict);
          return dict;
        }
      }
    } catch (_) {}
  }

  return null;
}

/**
 * Translate declarative HTML attributes on DOM elements
 */
export function translateDOM(root = null) {
  if (typeof document === 'undefined') return;
  const container = root || document;

  // 1. Text Content: data-i18n="key"
  const textEls = container.querySelectorAll('[data-i18n]');
  for (const el of textEls) {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  }

  // 2. Titles / Tooltips: data-i18n-title="key"
  const titleEls = container.querySelectorAll('[data-i18n-title]');
  for (const el of titleEls) {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.title = t(key);
    }
  }

  // 3. ARIA Labels: data-i18n-aria="key"
  const ariaEls = container.querySelectorAll('[data-i18n-aria]');
  for (const el of ariaEls) {
    const key = el.getAttribute('data-i18n-aria');
    if (key) {
      el.setAttribute('aria-label', t(key));
    }
  }

  // 4. Input Placeholders: data-i18n-placeholder="key"
  const phEls = container.querySelectorAll('[data-i18n-placeholder]');
  for (const el of phEls) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.placeholder = t(key);
    }
  }
}

/**
 * Set active UI language and trigger dynamic DOM & event updates
 */
export async function setLocale(code) {
  const normalized = normalizeCode(code);
  const info = getLocaleInfo(normalized);

  // Ensure fallback 'en' is loaded
  if (!localeCache.has('en')) {
    const enDict = await loadLocaleDictionary('en');
    if (enDict) {
      fallbackDictionary = enDict;
      localeCache.set('en', enDict);
    }
  }

  // Load target dictionary if different from 'en'
  let targetDict = null;
  if (normalized === 'en') {
    targetDict = fallbackDictionary;
  } else {
    targetDict = await loadLocaleDictionary(normalized);
    if (!targetDict) {
      console.warn(`Locale dictionary for '${normalized}' could not be loaded; falling back to English.`);
      targetDict = fallbackDictionary;
    }
  }

  currentLocale = normalized;
  activeDictionary = targetDict || fallbackDictionary;

  // Update HTML tag direction and lang attributes in browser
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalized;
    document.documentElement.dir = info.dir || 'ltr';
    translateDOM();
  }

  // Dispatch custom event for reactive listeners
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try {
      window.dispatchEvent(new CustomEvent('i18n:localechange', { detail: { locale: normalized, info } }));
    } catch (_) {}
  }

  return { locale: normalized, info };
}

/**
 * Initialize i18n subsystem
 */
export async function initI18n(initialLocale = 'en', customDictionaries = {}) {
  // Register any embedded custom dictionaries
  if (customDictionaries && typeof customDictionaries === 'object') {
    for (const [code, dict] of Object.entries(customDictionaries)) {
      registerLocale(code, dict);
    }
  }

  // Load English fallback dictionary
  const enDict = await loadLocaleDictionary('en');
  if (enDict) {
    fallbackDictionary = enDict;
    localeCache.set('en', enDict);
  }

  return await setLocale(initialLocale);
}
