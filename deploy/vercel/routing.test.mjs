import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const testOrigin = 'https://champions-draw-staging.example.test';
const share = '/league-manager/share/080bd6de-9956-4c3a-a134-e15c0a0fd2da';

function loadConfig(origin) {
  const env = { ...process.env };
  delete env.APPWRITE_API_ORIGIN;
  if (origin !== undefined) env.APPWRITE_API_ORIGIN = origin;
  return spawnSync(process.execPath, [
    '--input-type=module', '-e',
    "import { config } from './vercel.mjs'; console.log(JSON.stringify(config));",
  ], { cwd: repo, env, encoding: 'utf8' });
}

function configWithBackend() {
  const result = loadConfig(testOrigin + '/');
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function resolveRoute(routes, pathname, method = 'GET') {
  const route = routes.find(({ src, methods }) =>
    (!methods || methods.includes(method)) && new RegExp(src).test(pathname));
  if (!route) return null;
  return {
    ...route,
    dest: route.dest && pathname.replace(new RegExp(route.src), route.dest),
    location: route.headers?.Location && pathname.replace(new RegExp(route.src), route.headers.Location),
  };
}

test('requires a bare HTTPS function origin and fails without it', () => {
  for (const origin of [
    undefined,
    '',
    'http://backend.example.test',
    'https://token@backend.example.test/',
    'https://backend.example.test/api',
    'https://backend.example.test/?token=example',
    'https://backend.example.test/#fragment',
    'https://backend.example.test:8443/',
  ]) {
    const result = loadConfig(origin);
    assert.notEqual(result.status, 0, 'invalid origin should fail');
    assert.match(result.stderr, /APPWRITE_API_ORIGIN/);
    assert.doesNotMatch(result.stderr, /token=example|token@backend/);
  }
});

test('proxies the complete API pathname and never rewrites an API failure to HTML', () => {
  const { routes } = configWithBackend();
  for (const pathname of ['/api', '/api/', '/api/league-manager/account/', '/api/nonexistent']) {
    const route = resolveRoute(routes, pathname, 'PUT');
    assert.equal(route?.dest, testOrigin + pathname);
    assert.equal(route.continue, undefined);
  }
  assert.equal(resolveRoute(routes, '/api-docs'), null);
});

test('serves the known application deep links but leaves assets and unknown paths alone', () => {
  const { routes, buildCommand, outputDirectory } = configWithBackend();
  assert.equal(buildCommand, 'npm exec -- vite build --config vite.vercel.config.mjs');
  assert.equal(outputDirectory, 'dist');
  assert.equal(resolveRoute(routes, '/')?.dest, '/index.html');
  assert.equal(resolveRoute(routes, '/league-manager/')?.dest, '/index.html');
  assert.equal(resolveRoute(routes, '/league-manager')?.location, '/league-manager/');
  assert.equal(resolveRoute(routes, '/console/')?.location, '/');
  assert.equal(resolveRoute(routes, '/assets/index.js'), null);
  assert.equal(resolveRoute(routes, '/unknown'), null);
  assert.equal(resolveRoute(routes, '/league-manager/', 'POST'), null);
});

test('marks both share paths as unindexable, uncached, and no-referrer', () => {
  const { routes } = configWithBackend();
  const direct = resolveRoute(routes, share + '/');
  const redirected = resolveRoute(routes, share);
  assert.equal(direct?.dest, '/index.html');
  assert.equal(redirected?.location, share + '/');
  for (const route of [direct, redirected]) {
    assert.equal(route.headers['Cache-Control'], 'no-store');
    assert.equal(route.headers['X-Robots-Tag'], 'noindex');
    assert.equal(route.headers['Referrer-Policy'], 'no-referrer');
  }
  assert.equal(resolveRoute(routes, '/league-manager/share/not-a-uuid/'), null);
});
