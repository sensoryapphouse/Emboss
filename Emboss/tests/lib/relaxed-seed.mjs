// What the relaxed-braille browser tests put in localStorage before a page loads (Paul, 2 Nov 2026: "relaxed braille is part of the template (one name)").
// A template holds the contractions a reader has learned (its "ticks"); the ticks in force are the setting `contractions` of emboss-settings, and the
// templates are kept in emboss-templates (web/templates.mjs). This builds both the way the app stores them, so a test can start with "the template Sam is
// active and its ticks are in force" without driving Settings first.
import { cleanTemplateSettings, TEMPLATE_STORE_KEY, TEMPLATE_STORE_VERSION, cleanContractions } from '../../web/templates.mjs';
import { sanitizeSettings } from '../../web/settings.mjs';

export const SETTINGS_KEY = 'emboss-settings';
export const OLD_PROFILES_KEY = 'emboss-reader-profiles';
export const OLD_ACTIVE_KEY = 'emboss-reader-profile';

/**
 * seedEntries({ settings, templates: [{ name, contractions }], active })  ->  { 'emboss-settings': text, 'emboss-templates': text }
 *   settings: the settings in force apart from the ticks (default: BANA, UEB contracted, Quick Mode as given by `simpleMode`)
 *   templates: own templates made from those settings, each with its ticks (null = All)
 *   active: the name of the template in use (a built-in 'BANA' / 'UKAAF', or one of `templates`); its ticks are put in force
 */
export function seedEntries({ settings = {}, templates = [], active = null } = {}) {
  const base = { mode: 'bana', grade: 'g2', brailleCode: 'en-ueb-g2', uiLanguage: 'en', ...settings };
  const clean = cleanTemplateSettings(base);
  const list = templates.map((t, i) => ({ id: `u-seed${i + 1}`, name: t.name, settings: clean, doc: {}, producer: {}, contractions: cleanContractions(t.contractions) }));
  const mine = list.find((t) => t.name === active);
  const builtin = (active || '').toLowerCase() === 'ukaaf' ? 'ukaaf' : 'bana';
  const store = { version: TEMPLATE_STORE_VERSION, active: mine ? mine.id : builtin, list, docTemplate: null };
  const inForce = mine ? mine.contractions : null;
  return {
    [SETTINGS_KEY]: JSON.stringify({ ...sanitizeSettings(base), contractions: inForce }),
    [TEMPLATE_STORE_KEY]: JSON.stringify(store),
  };
}
