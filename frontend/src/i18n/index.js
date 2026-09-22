/* i18n core. Resolution and translation are pure; every DOM write is confined
   to applyLocale()'s body so importing this module under bare node:test (no
   DOM) stays safe. There is no module-level window/document access, and no JSX
   here on purpose — h() keeps the module transform-free and node-importable. */
import { createContext, h } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useState } from 'preact/hooks';

import { formatNumber as intlFormatNumber, shortDate, shortDay, shortTime } from '../lib/format.js';
import { resolveLocale, SUPPORTED_LOCALES } from './detect.js';
import en from './locales/en.js';
import es from './locales/es.js';
import fr from './locales/fr.js';
import pt from './locales/pt.js';

export { SUPPORTED_LOCALES };

export const LOCALE_KEY = 'champions_draw_locale';

const CATALOGS = { en, es, pt, fr };
const FALLBACK_LOCALE = 'en';

/* Storage is guarded exactly like lib/theme.js: a blocked read yields the
   default, a blocked write degrades to session-only. Only LOCALE_KEY is
   touched — never the theme, player-name or prediction keys. */
function readStoredLocale() {
  try {
    return window.localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

function writeStoredLocale(locale) {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    // Storage unavailable (private mode) — the locale still applies for this session.
  }
}

/* {{name}} placeholders. A missing param leaves the placeholder visible rather
   than silently blanking the text. */
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

function interpolate(template, params) {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

/* A catalogue entry is either a string or a { one, other } plural map. */
function renderEntry(entry, locale, params) {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  const count = params ? params.count : undefined;
  const form = count == null ? 'other' : new Intl.PluralRules(locale).select(count);
  return entry[form] ?? entry.other;
}

/* Pure: builds a (key, params) => string for a locale. Lookup order is the
   active locale, then English, then the key itself. The key is a visible
   diagnostic the drift test makes unreachable — it is never returned when the
   key exists in English. */
export function createTranslator(locale) {
  const active = CATALOGS[locale] ? locale : FALLBACK_LOCALE;
  const activeCatalog = CATALOGS[active];
  return function t(key, params) {
    const entry = activeCatalog[key] ?? CATALOGS[FALLBACK_LOCALE][key];
    const text = renderEntry(entry, active, params);
    return text == null ? key : interpolate(text, params);
  };
}

/* DOM only. `lang` drives :lang() styling and the accessibility tree. */
export function applyLocale(locale) {
  document.documentElement.lang = locale;
}

const I18nContext = createContext(null);

export function I18nProvider({ children }) {
  const [locale, setLocaleState] = useState(() =>
    resolveLocale(readStoredLocale(), typeof navigator === 'undefined' ? null : navigator.languages),
  );

  const setLocale = useCallback((next) => {
    const canonical = resolveLocale(next, null);
    writeStoredLocale(canonical);
    setLocaleState(canonical);
  }, []);

  // One DOM path: mount and every change go through applyLocale here.
  useEffect(() => {
    applyLocale(locale);
  }, [locale]);

  const value = useMemo(
    () => ({
      t: createTranslator(locale),
      locale,
      setLocale,
      formatTime: (value) => shortTime(value, locale),
      formatDay: (value) => shortDay(value, locale),
      formatDate: (value) => shortDate(value, locale),
      formatNumber: (value) => intlFormatNumber(value, locale),
    }),
    [locale, setLocale],
  );

  return h(I18nContext.Provider, { value }, children);
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n() must be used inside <I18nProvider>.');
  return value;
}
