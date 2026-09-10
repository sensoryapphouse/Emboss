// Emboss Global Localization & Multi-Language Test Suite
// Covers:
// Part 1: Node ESM Unit Tests (All 112 Liblouis languages, pinned ordering, key lookup, interpolation, fallback, metadata, schema integrity)
// Part 2: Headless Chrome Browser Integration (DOM translation, dynamic language dropdown, pinned options, dir=rtl, ARIA)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { initI18n, t, setLocale, getLocale, getLocaleInfo, getSupportedLocales, getOrderedLocales, registerLocale } from '../web/i18n.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, '../web/locales');
const EN_PATH = path.join(LOCALES_DIR, 'en.json');

console.log('--- Running Emboss Global Localization & Multi-Language Architecture Tests ---');

let pass = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ok    ${name}`);
  } else {
    failures.push({ name, detail });
    console.error(`  ✖ FAIL  ${name}${detail ? ': ' + JSON.stringify(detail) : ''}`);
  }
}

// =========================================================================
// Part 1: Core i18n Engine & All 112 Liblouis Locales Unit Tests
// =========================================================================
console.log('\nPart 1: Core i18n Engine & All 112 Liblouis Locales Unit Tests');

// 1. Check en.json dictionary
ok('en.json exists on disk', fs.existsSync(EN_PATH));
const enRaw = fs.readFileSync(EN_PATH, 'utf8');
let enDict = null;
try {
  enDict = JSON.parse(enRaw);
} catch (e) {
  enDict = null;
}
ok('en.json is valid JSON', !!enDict);

const requiredNamespaces = ['common', 'toolbar', 'styles', 'slash', 'settings', 'table', 'tactile', 'spooler', 'proofread', 'aria'];
for (const ns of requiredNamespaces) {
  ok(`en.json contains namespace '${ns}'`, enDict && typeof enDict[ns] === 'object' && Object.keys(enDict[ns]).length > 0);
}

// 2. Check all 112 locales in SUPPORTED_LOCALES
const supportedLocales = getSupportedLocales();
ok('SUPPORTED_LOCALES contains all 112 Liblouis languages', supportedLocales.length === 112, `Found ${supportedLocales.length}`);

// Verify all 112 locale JSON files exist on disk and parse as valid JSON with required namespaces
let validLocaleFilesCount = 0;
for (const loc of supportedLocales) {
  const filePath = path.join(LOCALES_DIR, `${loc.code}.json`);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data && typeof data === 'object' && requiredNamespaces.every(ns => typeof data[ns] === 'object')) {
        validLocaleFilesCount++;
      }
    } catch (_) {}
  }
}
ok('All 112 locale JSON files exist and have valid structure', validLocaleFilesCount === 112, `Valid files: ${validLocaleFilesCount}`);

// 3. Test getOrderedLocales() Pinned Ordering
// Requirement: English ('en'), current locale (if not en, es, fr), Spanish ('es'), French ('fr') at the top.
const orderEn = getOrderedLocales('en');
ok('Order with current=en: position 0 is en', orderEn[0].code === 'en');
ok('Order with current=en: position 1 is es', orderEn[1].code === 'es');
ok('Order with current=en: position 2 is fr', orderEn[2].code === 'fr');

const orderDe = getOrderedLocales('de');
ok('Order with current=de: position 0 is en', orderDe[0].code === 'en');
ok('Order with current=de: position 1 is de (current user locale)', orderDe[1].code === 'de');
ok('Order with current=de: position 2 is es', orderDe[2].code === 'es');
ok('Order with current=de: position 3 is fr', orderDe[3].code === 'fr');

const orderEs = getOrderedLocales('es');
ok('Order with current=es: position 0 is en', orderEs[0].code === 'en');
ok('Order with current=es: position 1 is es', orderEs[1].code === 'es');
ok('Order with current=es: position 2 is fr', orderEs[2].code === 'fr');

const orderAr = getOrderedLocales('ar');
ok('Order with current=ar: position 0 is en', orderAr[0].code === 'en');
ok('Order with current=ar: position 1 is ar', orderAr[1].code === 'ar');
ok('Order with current=ar: position 2 is es', orderAr[2].code === 'es');
ok('Order with current=ar: position 3 is fr', orderAr[3].code === 'fr');

// 4. Test RTL metadata
ok('Arabic (ar) is marked RTL', getLocaleInfo('ar').dir === 'rtl');
ok('Hebrew (he) is marked RTL', getLocaleInfo('he').dir === 'rtl');
ok('Persian (fa) is marked RTL', getLocaleInfo('fa').dir === 'rtl');
ok('Urdu (ur) is marked RTL', getLocaleInfo('ur').dir === 'rtl');
ok('Spanish (es) is marked LTR', getLocaleInfo('es').dir === 'ltr');
ok('German (de) is marked LTR', getLocaleInfo('de').dir === 'ltr');

// 5. Parameter Interpolation & Lookups
await initI18n('en', { en: enDict });
ok('Lookup common.save in en is "Save"', t('common.save') === 'Save');
ok('Lookup styles.body in en is "Body Text (3-1)"', t('styles.body') === 'Body Text (3-1)');
ok('Parameter interpolation test', t('aria.document_saved', { filename: 'test.xml' }) === 'Document saved as test.xml.');

// Switch to Spanish
await setLocale('es');
ok('Active locale is es', getLocale() === 'es');
ok('Lookup common.save in es is "Guardar"', t('common.save') === 'Guardar');
ok('Lookup toolbar.insert in es is "Insertar"', t('toolbar.insert') === 'Insertar');
ok('Lookup styles.body in es is "Cuerpo de texto (3-1)"', t('styles.body') === 'Cuerpo de texto (3-1)');

// Switch to French
await setLocale('fr');
ok('Active locale is fr', getLocale() === 'fr');
ok('Lookup common.save in fr is "Enregistrer"', t('common.save') === 'Enregistrer');
ok('Lookup toolbar.insert in fr is "Insérer"', t('toolbar.insert') === 'Insérer');

// Switch to German
await setLocale('de');
ok('Active locale is de', getLocale() === 'de');
ok('Lookup common.save in de is "Speichern"', t('common.save') === 'Speichern');
ok('Lookup toolbar.insert in de is "Einfügen"', t('toolbar.insert') === 'Einfügen');

// Switch back to English
await setLocale('en');
ok('Restored active locale to en', getLocale() === 'en');
ok('common.save is "Save"', t('common.save') === 'Save');

// =========================================================================
// Part 2: Headless Chrome Direct Braille Editor DOM & ARIA Validation
// =========================================================================
console.log('\nPart 2: Headless Chrome Direct Braille Editor Integration');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: !process.argv.includes('--show'),
  args: ['--no-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

await context.addInitScript(() => {
  try {
    localStorage.setItem('emboss-settings', JSON.stringify({ simpleMode: false, sixKeyInput: true, mode: 'bana', grade: 'g2', cells: 40, lines: 25, uiLanguage: 'en' }));
  } catch {}
});

const page = await context.newPage();

const waitFor = async (fn, what, ms = 12000) => {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn)) return true;
    if (Date.now() - t0 > ms) { failures.push(`timed out waiting for ${what}`); console.log(`  ✖ FAIL  timed out waiting for ${what}`); return false; }
    await new Promise((r) => setTimeout(r, 50));
  }
};

page.on('pageerror', (err) => console.error('  ✖ Page error:', err.message));

try {
  await page.goto('http://localhost:8137/editor/index.html', { waitUntil: 'load' });
  await waitFor(() => typeof window.t === 'function' && typeof window.setLocale === 'function', 'i18n engine on window');
  await new Promise((r) => setTimeout(r, 300));

  // 1. Verify Global i18n APIs on window
  const apis = await page.evaluate(() => {
    return {
      hasT: typeof window.t === 'function',
      hasSetLocale: typeof window.setLocale === 'function',
      hasGetLocale: typeof window.getLocale === 'function',
      hasTranslateDOM: typeof window.translateDOM === 'function',
      activeLocale: window.getLocale ? window.getLocale() : null
    };
  });

  ok('window.t is exposed and available', apis.hasT);
  ok('window.setLocale is exposed and available', apis.hasSetLocale);
  ok('window.getLocale is exposed and returns "en"', apis.activeLocale === 'en', apis.activeLocale);

  // 2. Verify Dynamic Population of Interface Language dropdown (#set-uiLanguage)
  const langDropdownCheck = await page.evaluate(() => {
    const sel = document.getElementById('set-uiLanguage');
    if (!sel) return { exists: false, count: 0, topOptions: [] };
    const options = Array.from(sel.options).map(o => ({ value: o.value, text: o.textContent }));
    return {
      exists: true,
      count: options.length,
      topOptions: options.slice(0, 4)
    };
  });

  ok('set-uiLanguage dropdown exists', langDropdownCheck.exists);
  ok('set-uiLanguage dropdown contains 112 options', langDropdownCheck.count === 112, langDropdownCheck.count);
  ok('set-uiLanguage top option 0 is English (en)', langDropdownCheck.topOptions[0]?.value === 'en', langDropdownCheck.topOptions[0]);
  ok('set-uiLanguage top option 1 is Spanish (es)', langDropdownCheck.topOptions[1]?.value === 'es', langDropdownCheck.topOptions[1]);
  ok('set-uiLanguage top option 2 is French (fr)', langDropdownCheck.topOptions[2]?.value === 'fr', langDropdownCheck.topOptions[2]);

  // 3. Test Dynamic Switch to Spanish (es)
  const esSwitch = await page.evaluate(async () => {
    await window.setLocale('es');
    return {
      activeLocale: window.getLocale(),
      docLang: document.documentElement.lang,
      docDir: document.documentElement.dir,
      boldTitle: document.getElementById('btnBold')?.title || '',
      insertText: document.querySelector('#btnInsertMenu .btn-lbl')?.textContent || '',
      quickModeText: document.querySelector('#backToSimple .btn-lbl')?.textContent || ''
    };
  });

  ok('In-browser switch to Spanish: activeLocale is "es"', esSwitch.activeLocale === 'es', esSwitch);
  ok('In-browser switch to Spanish: docLang is "es"', esSwitch.docLang === 'es', esSwitch);
  ok('In-browser switch to Spanish: docDir is "ltr"', esSwitch.docDir === 'ltr', esSwitch);
  ok('In-browser switch to Spanish: btnBold title translated', esSwitch.boldTitle.includes('Negrita'), esSwitch.boldTitle);
  ok('In-browser switch to Spanish: btnInsertMenu translated', esSwitch.insertText === 'Insertar', esSwitch.insertText);

  // 4. Test Dynamic Switch to French (fr)
  const frSwitch = await page.evaluate(async () => {
    await window.setLocale('fr');
    return {
      activeLocale: window.getLocale(),
      docLang: document.documentElement.lang,
      boldTitle: document.getElementById('btnBold')?.title || '',
      insertText: document.querySelector('#btnInsertMenu .btn-lbl')?.textContent || ''
    };
  });

  ok('In-browser switch to French: activeLocale is "fr"', frSwitch.activeLocale === 'fr', frSwitch);
  ok('In-browser switch to French: btnBold title is "Gras (Ctrl+B)"', frSwitch.boldTitle.includes('Gras'), frSwitch.boldTitle);
  ok('In-browser switch to French: btnInsertMenu is "Insérer"', frSwitch.insertText === 'Insérer', frSwitch.insertText);

  // 5. Test Dynamic Switch to German (de)
  const deSwitch = await page.evaluate(async () => {
    await window.setLocale('de');
    return {
      activeLocale: window.getLocale(),
      docLang: document.documentElement.lang,
      boldTitle: document.getElementById('btnBold')?.title || '',
      insertText: document.querySelector('#btnInsertMenu .btn-lbl')?.textContent || ''
    };
  });

  ok('In-browser switch to German: activeLocale is "de"', deSwitch.activeLocale === 'de', deSwitch);
  ok('In-browser switch to German: btnBold title is "Fett (Strg+B)"', deSwitch.boldTitle.includes('Fett'), deSwitch.boldTitle);
  ok('In-browser switch to German: btnInsertMenu is "Einfügen"', deSwitch.insertText === 'Einfügen', deSwitch.insertText);

  // 6. Test BiDi / RTL Dynamic Switch to Arabic (ar)
  const arSwitch = await page.evaluate(async () => {
    await window.setLocale('ar');
    return {
      activeLocale: window.getLocale(),
      docLang: document.documentElement.lang,
      docDir: document.documentElement.dir,
      boldTitle: document.getElementById('btnBold')?.title || '',
      insertText: document.querySelector('#btnInsertMenu .btn-lbl')?.textContent || ''
    };
  });

  ok('In-browser switch to Arabic: activeLocale is "ar"', arSwitch.activeLocale === 'ar', arSwitch);
  ok('In-browser switch to Arabic: docDir is "rtl"', arSwitch.docDir === 'rtl', arSwitch);
  ok('In-browser switch to Arabic: btnInsertMenu is "إدراج"', arSwitch.insertText === 'إدراج', arSwitch.insertText);

  // 7. Test BiDi / RTL Dynamic Switch to Hebrew (he)
  const heSwitch = await page.evaluate(async () => {
    await window.setLocale('he');
    return {
      activeLocale: window.getLocale(),
      docLang: document.documentElement.lang,
      docDir: document.documentElement.dir,
      insertText: document.querySelector('#btnInsertMenu .btn-lbl')?.textContent || ''
    };
  });

  ok('In-browser switch to Hebrew: activeLocale is "he"', heSwitch.activeLocale === 'he', heSwitch);
  ok('In-browser switch to Hebrew: docDir is "rtl"', heSwitch.docDir === 'rtl', heSwitch);
  ok('In-browser switch to Hebrew: btnInsertMenu is "הוסף"', heSwitch.insertText === 'הוסף', heSwitch.insertText);

  // 8. Restore to English
  const restoreResult = await page.evaluate(async () => {
    await window.setLocale('en');
    return {
      activeLocale: window.getLocale(),
      docLang: document.documentElement.lang,
      docDir: document.documentElement.dir,
      insertText: document.querySelector('#btnInsertMenu .btn-lbl')?.textContent || ''
    };
  });

  ok('Restored to English: activeLocale is "en"', restoreResult.activeLocale === 'en', restoreResult);
  ok('Restored to English: docDir is "ltr"', restoreResult.docDir === 'ltr', restoreResult);
  ok('Restored to English: insertText is "Insert"', restoreResult.insertText === 'Insert', restoreResult.insertText);

} finally {
  await browser.close();
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Emboss Global Localization Test Results: ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.error('Failures:', failures);
  process.exit(1);
} else {
  console.log('All Emboss Global Localization & Multi-Language tests passed 100% cleanly!');
}
