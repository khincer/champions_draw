import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { resolveLocale, SUPPORTED_LOCALES } from '../i18n/detect.js';
import { createTranslator, LOCALE_KEY } from '../i18n/index.js';
import { KEYS, NAMESPACES } from '../i18n/keys.js';
import en from '../i18n/locales/en.js';
import es from '../i18n/locales/es.js';
import fr from '../i18n/locales/fr.js';
import pt from '../i18n/locales/pt.js';
import { shortTime, shortDay, shortDate, formatNumber } from '../lib/format.js';


/* resolveLocale is pure: no window, no document, no storage access. */

test('resolveLocale: a stored preference wins over the browser', () => {
  assert.equal(resolveLocale('fr', 'es-NI'), 'fr');
  assert.equal(resolveLocale('pt', ['es-NI', 'fr']), 'pt');
});

test('resolveLocale: browser tags are region-stripped on - and _', () => {
  assert.equal(resolveLocale(null, 'es-NI'), 'es');
  assert.equal(resolveLocale(null, 'es_NI'), 'es');
  assert.equal(resolveLocale(null, 'pt-BR'), 'pt');
  assert.equal(resolveLocale(null, 'fr-CA'), 'fr');
  assert.equal(resolveLocale(null, 'en-US'), 'en');
});

test('resolveLocale: an unsupported browser language falls back to en', () => {
  assert.equal(resolveLocale(null, 'de-DE'), 'en');
  assert.equal(resolveLocale(null, 'it-IT'), 'en');
  assert.equal(resolveLocale(null, 'xx-YY-ZZ'), 'en');
});

test('resolveLocale: a regionless or already-canonical tag resolves to itself', () => {
  assert.equal(resolveLocale(null, 'fr'), 'fr');
  assert.equal(resolveLocale('pt', null), 'pt');
  assert.equal(resolveLocale('ES', 'de-DE'), 'es');
});

test('resolveLocale: an unsupported or malformed stored value falls through to the browser', () => {
  assert.equal(resolveLocale('de-DE', 'pt-BR'), 'pt');
  assert.equal(resolveLocale('', 'es'), 'es');
  assert.equal(resolveLocale(null, 'fr'), 'fr');
  assert.equal(resolveLocale(undefined, 'fr'), 'fr');
  assert.equal(resolveLocale(42, 'fr'), 'fr');
  assert.equal(resolveLocale({}, 'fr'), 'fr');
});

test('resolveLocale: a list of browser languages picks the first supported one', () => {
  assert.equal(resolveLocale(null, ['de-DE', 'pt-BR', 'en']), 'pt');
  assert.equal(resolveLocale(null, []), 'en');
});

test('resolveLocale: malformed input never throws and always yields a canonical locale', () => {
  for (const value of ['', null, undefined, 7, {}, [], '   ']) {
    assert.equal(resolveLocale(value, value), 'en');
  }
  assert.deepEqual(SUPPORTED_LOCALES, ['en', 'es', 'pt', 'fr']);
});


/* Formatting assertions are structural: Intl output varies by ICU build, so
   never assert a literal month or date string. */

const SAMPLE = '2026-09-22T20:00:00Z';

test('formatters accept a locale and return strings', () => {
  assert.equal(typeof shortTime(SAMPLE, 'fr'), 'string');
  assert.equal(typeof shortDay(SAMPLE, 'es'), 'string');
  assert.equal(typeof shortDate(SAMPLE, 'pt'), 'string');
  assert.equal(typeof formatNumber(1234.5, 'en'), 'string');
});

test('a locale changes the rendered time, day, date and number', () => {
  assert.notEqual(shortTime(SAMPLE, 'en'), shortTime(SAMPLE, 'fr'));
  assert.notEqual(shortDay(SAMPLE, 'en'), shortDay(SAMPLE, 'fr'));
  assert.notEqual(shortDate(SAMPLE, 'en'), shortDate(SAMPLE, 'fr'));
  assert.notEqual(formatNumber(1234.5, 'en'), formatNumber(1234.5, 'fr'));
});

test('omitting the locale keeps the previous behaviour and its guards', () => {
  assert.equal(shortTime(null), 'TBD');
  assert.equal(shortDay(null), '');
  assert.equal(shortDate(undefined), '');
  assert.equal(typeof shortDay(SAMPLE), 'string');
  assert.equal(typeof shortDate(SAMPLE), 'string');
});


/* Catalogues, the key inventory and drift. keys.js is the independent oracle:
   comparing the catalogues only to each other cannot catch a key that was
   accidentally added to all four. */

const CATALOGS = [
  ['en', en],
  ['es', es],
  ['pt', pt],
  ['fr', fr],
];

/* Every value is a non-empty string or a { one, other } plural map. A malformed
   value must fail here rather than reach the app. */
function checkWellFormed(catalog, label) {
  for (const [key, value] of Object.entries(catalog)) {
    if (typeof value === 'string') {
      assert.ok(value.length > 0, `${label}:${key} is an empty string`);
      continue;
    }
    assert.ok(
      value && typeof value === 'object',
      `${label}:${key} is neither a string nor a plural map`,
    );
    for (const form of ['one', 'other']) {
      assert.equal(typeof value[form], 'string', `${label}:${key} is missing the "${form}" form`);
    }
  }
}

test('keys.js is a duplicate-free inventory whose namespaces are all declared', () => {
  const oracle = new Set(KEYS);
  assert.equal(KEYS.length, oracle.size, 'keys.js contains duplicate keys');
  for (const key of KEYS) {
    const namespace = key.split('.')[0];
    assert.ok(NAMESPACES.includes(namespace), `${key} uses undeclared namespace ${namespace}`);
  }
});

test('every catalogue exposes exactly the keys.js inventory', () => {
  const oracle = new Set(KEYS);
  for (const [label, catalog] of CATALOGS) {
    const actual = new Set(Object.keys(catalog));
    const missing = [...oracle].filter((key) => !actual.has(key));
    const extra = [...actual].filter((key) => !oracle.has(key));
    assert.deepEqual(missing, [], `${label} is missing keys`);
    assert.deepEqual(extra, [], `${label} has keys absent from keys.js`);
  }
});

test('en is the fallback source of truth and covers every key in keys.js', () => {
  const english = new Set(Object.keys(en));
  const uncovered = KEYS.filter((key) => !english.has(key));
  assert.deepEqual(uncovered, [], 'en does not cover the full inventory');
  assert.equal(LOCALE_KEY, 'champions_draw_locale');
});

test('catalogues are well-formed: strings or { one, other }, never anything else', () => {
  for (const [label, catalog] of CATALOGS) checkWellFormed(catalog, label);
});

test('the well-formedness check rejects malformed entries', () => {
  assert.throws(() => checkWellFormed({ bad: 42 }, 'x'), /neither a string nor a plural map/);
  assert.throws(() => checkWellFormed({ bad: { one: 'x' } }, 'x'), /missing the "other" form/);
  assert.throws(() => checkWellFormed({ bad: '' }, 'x'), /is an empty string/);
});


/* Fallback and interpolation. */

test('a key missing from a locale renders the English string, never the key', () => {
  const key = 'home.welcomeBack';
  const english = en[key];
  delete es[key];
  try {
    const t = createTranslator('es');
    assert.equal(t(key, { name: 'Ada' }), 'Welcome back, Ada');
    assert.notEqual(t(key, { name: 'Ada' }), key);
  } finally {
    es[key] = english;
  }
});

test('a key absent from English too renders the key itself, never blank', () => {
  const t = createTranslator('pt');
  assert.equal(t('totally.absent.key'), 'totally.absent.key');
  assert.equal(t('totally.absent.key', { x: 1 }), 'totally.absent.key');
});

test('interpolation replaces every occurrence and keeps a missing placeholder visible', () => {
  const t = createTranslator('en');
  assert.equal(t('home.welcomeBack', { name: 'Ada' }), 'Welcome back, Ada');
  assert.equal(
    t('home.viewMatchDetails', { home: 'A', away: 'B' }),
    'View match details: A versus B',
  );
  assert.match(t('home.welcomeBack', {}), /\{\{name\}\}/);
  assert.match(t('home.welcomeBack'), /\{\{name\}\}/);
});


/* Plural selection goes through Intl.PluralRules, never a ternary. */

test('plurals select one/other per locale', () => {
  const one = createTranslator('en')('shell.drawRanFixtures', { player: 'Ada', seed: 's1', count: 1 });
  const other = createTranslator('en')('shell.drawRanFixtures', { player: 'Ada', seed: 's1', count: 2 });
  assert.match(one, / 1 fixture\.$/);
  assert.match(other, / 2 fixtures\.$/);
  assert.equal(createTranslator('en')('shell.drawRanFixtures'), en['shell.drawRanFixtures'].other);
});

/* The canonical tags follow CLDR: 0 is `one` for fr and pt, `other` for es.
   Asserted against real Intl rather than a hardcoded per-language table. */
test("the zero case follows each locale's real cardinal rule", () => {
  const params = { player: 'A', seed: 's', count: 0 };
  /* Fill the catalogue template so the expectation proves which plural form
     was chosen without hardcoding a translated word. */
  const fill = (template) =>
    template
      .replaceAll('{{player}}', params.player)
      .replaceAll('{{seed}}', params.seed)
      .replaceAll('{{count}}', String(params.count));
  const zero = (locale) => createTranslator(locale)('shell.drawRanFixtures', params);

  assert.equal(new Intl.PluralRules('fr').select(0), 'one');
  assert.equal(new Intl.PluralRules('pt').select(0), 'one');
  assert.equal(new Intl.PluralRules('es').select(0), 'other');
  assert.equal(zero('fr'), fill(fr['shell.drawRanFixtures'].one));
  assert.equal(zero('pt'), fill(pt['shell.drawRanFixtures'].one));
  assert.equal(zero('es'), fill(es['shell.drawRanFixtures'].other));
});

test('no catalogue value renders as a raw key pattern', () => {
  for (const [label, catalog] of CATALOGS) {
    for (const [key, value] of Object.entries(catalog)) {
      const strings = typeof value === 'string' ? [value] : [value.one, value.other];
      for (const text of strings) {
        assert.doesNotMatch(text, /^[a-z]+\.[a-zA-Z.]+$/, `${label}:${key} looks like a key`);
      }
    }
  }
});


/* Pre-paint bootstrap (index.html). The inline classic script cannot import
   the ESM module, so it deliberately duplicates the resolution rule. These
   tests read that file and hold the duplicate to detect.js — a literal check
   for the declared set and fallback, and a behavioural check that runs the
   real inline script against a stub DOM and compares it with resolveLocale. */

const INDEX_HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function inlineScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, 'index.html declares no inline <script> block');
  return match[1];
}

/* Runs the real inline script the way the browser does before first paint and
   returns the `lang` it set. Nothing here is re-implemented: the source is the
   shipped file. */
function bootstrapLang({ storedLocale = null, languages, language } = {}) {
  const entries = new Map();
  if (storedLocale !== null) entries.set('champions_draw_locale', storedLocale);
  const documentElement = {
    style: {},
    setAttribute(name, value) { this[name] = value; },
  };
  const stubWindow = {
    localStorage: { getItem: (key) => (entries.has(key) ? entries.get(key) : null) },
  };
  new Function('window', 'document', 'navigator', inlineScript(INDEX_HTML))(
    stubWindow,
    { documentElement },
    { languages, language },
  );
  return documentElement.lang;
}

test('the bootstrap declares exactly SUPPORTED_LOCALES and the detect.js fallback', () => {
  const source = inlineScript(INDEX_HTML);
  const literals = source.match(/var supported = (\[[^\]]*\]);/);
  assert.ok(literals, 'the bootstrap declares no supported-locale array');
  /* The array is single-quoted source, not JSON. */
  const declared = new Function(`return ${literals[1]};`)();
  assert.deepEqual(declared, SUPPORTED_LOCALES);

  const fallback = source.match(/var locale = '([^']+)';/);
  assert.ok(fallback, 'the bootstrap declares no fallback locale');
  assert.equal(fallback[1], resolveLocale(null, null), 'fallback differs from detect.js');
});

test('the bootstrap strips the region exactly like detect.js does', () => {
  assert.match(inlineScript(INDEX_HTML), /split\(\/\[-_\]\/\)/, 'region-strip rule not found');
  assert.equal(bootstrapLang({ storedLocale: 'pt-BR' }), 'pt');
  assert.equal(bootstrapLang({ storedLocale: 'es_NI' }), 'es');
});

test('the bootstrap resolves the locale exactly as resolveLocale does', () => {
  const cases = [
    ['fr', ['es-NI']],
    ['pt', ['es-NI', 'fr']],
    [null, ['es-NI']],
    [null, ['es_NI']],
    [null, ['pt-BR']],
    [null, ['fr-CA']],
    [null, ['en-US']],
    [null, ['de-DE']],
    [null, ['it-IT']],
    [null, ['de-DE', 'pt-BR', 'en']],
    [null, []],
    [null, null],
    ['', ['es']],
    ['de-DE', ['pt-BR']],
    ['ES', ['de-DE']],
    ['  fr  ', []],
    ['pt-br', []],
    ['de-DE', null],
  ];

  for (const [storedLocale, browser] of cases) {
    const expected = resolveLocale(storedLocale, browser);
    const actual = bootstrapLang({ storedLocale, languages: browser });
    assert.equal(
      actual,
      expected,
      `bootstrap diverged for stored=${JSON.stringify(storedLocale)} browser=${JSON.stringify(browser)}`,
    );
    assert.ok(SUPPORTED_LOCALES.includes(actual), `bootstrap emitted a non-canonical locale ${actual}`);
  }
});

test('the bootstrap reads navigator.languages only, exactly like the provider', () => {
  /* A browser exposing `language` but not `languages` must not pre-paint a
     locale the provider will resolve differently — that is a wrong-lang flash. */
  const actual = bootstrapLang({ language: 'es-ES' });
  assert.equal(actual, resolveLocale(null, undefined));
  assert.equal(actual, 'en');
  assert.equal(bootstrapLang({ language: 'es-ES', languages: ['fr-CA'] }), 'fr');
});
