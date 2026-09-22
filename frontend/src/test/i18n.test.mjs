import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocale, SUPPORTED_LOCALES } from '../i18n/detect.js';
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
