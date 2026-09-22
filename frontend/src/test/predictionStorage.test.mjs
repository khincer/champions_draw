import assert from 'node:assert/strict';
import test, { after } from 'node:test';

import {
  clearLocal, getPlayerName, loadLocal, loadRealLocal, saveLocal, saveRealLocal, setPlayerName,
} from '../lib/predictionStorage.js';

/* The module reads localStorage from the global scope on call, never at import
   and never via `window`, so a bare node:test run stubs `globalThis`. */

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStorage(storage) {
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
}

after(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
  else delete globalThis.localStorage;
});

/* Simulates private mode, disabled storage or an embedded webview. Homepage.jsx
   reaches getPlayerName() on mount, so a throw here takes the page down. */
function blockedStorage() {
  const die = () => { throw new Error('SecurityError: storage is blocked'); };
  return { getItem: die, setItem: die, removeItem: die };
}

function memoryStorage() {
  const entries = new Map();
  return {
    getItem: (key) => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
  };
}

/* One test per unguarded site D7 names, so a single unguarded accessor fails on
   its own line instead of hiding behind a sibling's early throw. */

test('blocked storage: getPlayerName() returns the empty-string default instead of throwing', () => {
  installStorage(blockedStorage());
  assert.doesNotThrow(() => getPlayerName());
  assert.equal(getPlayerName(), '');
});

test('blocked storage: setPlayerName() does not throw and does not break the caller', () => {
  installStorage(blockedStorage());
  assert.equal(setPlayerName('Ada'), undefined);
  assert.equal(getPlayerName(), '');
});

test('blocked storage: clearLocal() does not throw', () => {
  installStorage(blockedStorage());
  assert.equal(clearLocal('2025-26', 'Ada'), undefined);
});

test('blocked storage: the paths already guarded keep their defaults', () => {
  installStorage(blockedStorage());
  assert.equal(loadLocal('2025-26', 'Ada', null).lastUpdated, 0);
  assert.deepEqual(loadRealLocal('2025-26', 'Ada'), {});
  assert.equal(saveLocal('2025-26', 'Ada', {}, 'seed-1'), undefined);
  assert.equal(saveRealLocal('2025-26', 'Ada', {}), undefined);
});

test('working storage: reads and writes behave exactly as before the guard', () => {
  installStorage(memoryStorage());
  assert.equal(getPlayerName(), '');
  setPlayerName('Ada');
  assert.equal(getPlayerName(), 'Ada');
  saveLocal('2025-26', 'Ada', { matchPredictions: { m1: [2, 1] } }, 'seed-1');
  assert.deepEqual(loadLocal('2025-26', 'Ada', 'seed-1').matchPredictions, { m1: [2, 1] });
  clearLocal('2025-26', 'Ada');
  assert.deepEqual(loadLocal('2025-26', 'Ada', null).matchPredictions, {});
  saveRealLocal('2025-26', 'Ada', { 'r-1': [3, 0] });
  assert.deepEqual(loadRealLocal('2025-26', 'Ada'), { 'r-1': [3, 0] });
});
