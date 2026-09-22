import assert from 'node:assert/strict';
import test from 'node:test';

/* apiFetch reads document.cookie for the CSRF token and calls fetch; neither
   exists under a bare node:test run, so both are stubbed here. Each test file
   runs in its own process, so the globals never leak. */
globalThis.document = { cookie: '' };

const { apiFetch } = await import('../lib/api.js');

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

/* The shell renders copy from err.code (t('errors.' + code)) instead of DRF's
   English detail, so every failure must leave apiFetch with a stable code. */
async function codeFrom(impl) {
  globalThis.fetch = impl;
  try {
    await apiFetch('/probe/');
    return 'no-throw';
  } catch (err) {
    return err.code;
  }
}

test('an HTTP failure carries a machine code derived from the status', async () => {
  assert.equal(await codeFrom(async () => jsonResponse(401, { detail: 'denied' })), 'forbidden');
  assert.equal(await codeFrom(async () => jsonResponse(403, { detail: 'denied' })), 'forbidden');
  assert.equal(await codeFrom(async () => jsonResponse(404, { detail: 'missing' })), 'notFound');
  assert.equal(await codeFrom(async () => jsonResponse(500, { detail: 'boom' })), 'server');
  assert.equal(await codeFrom(async () => jsonResponse(503, undefined)), 'server');
  assert.equal(await codeFrom(async () => jsonResponse(418, { detail: 'teapot' })), 'unknown');
});

test('a code supplied by the backend wins over the status map', async () => {
  const response = async () => jsonResponse(409, { detail: 'conflict', code: 'PLAYOFF_SAVE_FAILED' });
  assert.equal(await codeFrom(response), 'PLAYOFF_SAVE_FAILED');
});

test('a network TypeError is `network`, and a non-JSON body is still named by its status', async () => {
  assert.equal(await codeFrom(async () => { throw new TypeError('fetch failed'); }), 'network');
  assert.equal(
    await codeFrom(async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' })),
    'server',
  );
  assert.equal(
    await codeFrom(async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' })),
    'unknown',
  );
});

test('a successful response still returns the parsed payload', async () => {
  globalThis.fetch = async () => jsonResponse(200, { teams: [] });
  assert.deepEqual(await apiFetch('/probe/'), { teams: [] });
});
