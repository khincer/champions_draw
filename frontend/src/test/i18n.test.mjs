import assert from 'node:assert/strict';
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
