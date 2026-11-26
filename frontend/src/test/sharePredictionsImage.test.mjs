import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTranslator, SUPPORTED_LOCALES } from '../i18n/index.js';
import { buildPredictionsImage } from '../lib/sharePredictionsImage.js';

test('matchday images paint translated headings in every locale', async (t) => {
  const text = [];
  const context = {
    scale() {},
    fillRect() {},
    fillText(value) { text.push(value); },
  };
  const canvas = { getContext: () => context };

  globalThis.document = { createElement: () => canvas, documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#000' });
  t.after(() => {
    delete globalThis.document;
    delete globalThis.getComputedStyle;
  });

  for (const locale of SUPPORTED_LOCALES) {
    text.length = 0;
    const image = await buildPredictionsImage({
      playerName: 'Ada',
      matchday: 3,
      seasonName: '2026-27',
      t: createTranslator(locale),
      locale,
    });
    assert.equal(image, canvas);
    assert.ok(canvas.width > 0 && canvas.height > 0);
    assert.equal(text.length, 3);
    assert.match(text[0], /2026-27$/);
    assert.match(text[1], /3.*Ada/);
    assert.ok(text.every((line) => line.length && !line.includes('draw.share')), locale);
  }
});
