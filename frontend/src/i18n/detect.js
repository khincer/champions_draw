/* Locale resolution, kept pure so the browser and node:test observe the same
   rule. No window, no document, no storage access in this module. */

export const SUPPORTED_LOCALES = ['en', 'es', 'pt', 'fr'];

const DEFAULT_LOCALE = 'en';

// 'es-NI' -> 'es', 'pt_BR' -> 'pt', 'FR' -> 'fr'; anything else -> null.
function baseLanguage(tag) {
  if (typeof tag !== 'string') return null;
  const base = tag.trim().split(/[-_]/)[0].toLowerCase();
  return base.length > 0 ? base : null;
}

/* stored: the persisted preference ('' / null / unsupported all tolerated).
   browser: a single tag or a list of tags, e.g. navigator.languages.
   A stored value outside the supported set is treated as absent, so a usable
   browser preference is still honoured. */
export function resolveLocale(stored, browser) {
  const candidates = [stored, ...(Array.isArray(browser) ? browser : [browser])];
  for (const candidate of candidates) {
    const base = baseLanguage(candidate);
    if (base && SUPPORTED_LOCALES.includes(base)) return base;
  }
  return DEFAULT_LOCALE;
}
