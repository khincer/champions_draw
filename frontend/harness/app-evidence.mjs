/* Runtime evidence driver for the champions-draw-update-plan verification gaps.
 *
 * Drives the real Django-served build (http://127.0.0.1:8001/) in headless
 * Chromium with deterministic /api/** stubs, plus a static serve of the
 * primitive harness (frontend/harness/harness.html) for component-level rows.
 *
 * Every scenario writes an explicit pass/fail + raw measurement into the JSON
 * report. Nothing here reads source to decide an outcome.
 *
 * Usage:  node frontend/harness/app-evidence.mjs [out.json]
 * Requires: Django on :8001 serving the current static/ui build.
 */
import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';

const REPO = 'C:/Users/Usuario/Documents/projects/champions_draw/';
const require = createRequire(REPO);
const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8001/';
const HARNESS_PORT = 4187;
const HARNESS_OUT = 'C:/Users/Usuario/AppData/Local/Temp/opencode/p2-harness';
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(HERE, 'app-evidence.out.json');
const FILTER = process.argv[3] || '';

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const now = new Date();
const at = (dayOffset, h) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, 0, 0).toISOString();
const todayIso = at(0, 18);
const yIso = at(-1, 18);

const team = (id, name, code, pot) => ({ id, name, short_name: name.slice(0, 3).toUpperCase(), logo_url: '', association: { code }, pot });
const T = [team(1, 'Real Madrid', 'ESP', 1), team(2, 'Bayern Munich', 'GER', 1), team(3, 'Liverpool', 'ENG', 2), team(4, 'Inter Milan', 'ITA', 2)];
const matchup = (id, md, home, away, extra = {}) => ({
  id, matchday: md, season_id: 1, competition: 'Champions League', kickoff: todayIso, closed: false, openable: true, home_team: home, away_team: away, ...extra,
});
const MATCHUPS = [matchup('m1', 1, T[0], T[1], { closed: true }), matchup('m2', 1, T[2], T[3], { closed: true }), matchup('m3', 2, T[1], T[2]), matchup('m4', 2, T[3], T[0])];
const SEASON_STATE = {
  teams: T,
  matchups: MATCHUPS,
  draws: [{ id: 7, draw_seed: 'prediction-1', status: 'COMPLETED', method: 'sat', player_name: 'Ada', matchups_created: 4, completed_at: todayIso }],
};
const HOMEMATCHES = {
  matchups: [
    { ...matchup('h1', 1, T[0], T[1], { closed: true }), result: { home_goals: 2, away_goals: 1 } },
    { ...matchup('h2', 1, T[2], T[3], { closed: true }), result: { home_goals: 0, away_goals: 0 } },
    { ...matchup('h3', 1, T[1], T[0], { closed: true, kickoff: yIso }), result: { home_goals: 3, away_goals: 2 } },
    { ...matchup('h4', 2, T[3], T[2], { closed: true, kickoff: yIso }), result: { home_goals: 1, away_goals: 4 } },
    { ...matchup('live1', 1, T[0], T[3], { closed: true, kickoff: yIso }) },
  ],
};
const REALFIXTURES = { season: { id: 1, name: '2025-26' }, matchups: [ { ...matchup('r1', 1, T[0], T[1], { closed: true }), result: { home_goals: 2, away_goals: 1 } }, { ...matchup('r2', 1, T[2], T[3]) }, { ...matchup('r3', 2, T[1], T[2]) } ] };
const MATCHDETAIL = { header: { status: 'FINISHED', home_team: T[0], away_team: T[1], score: { home_goals: 2, away_goals: 1 }, kickoff: todayIso, matchday: 1 }, detail: { venue: 'Stadium', referees: [{ name: 'Ref One', role: 'REFEREE' }], odds: { homeWin: '2.0', draw: '3.0', awayWin: '4.0' } } };
const INTERACTIVE = {
  teams: T,
  matchups: [],
  picks: [],
  current_pot: 1,
  auto_finalized: false,
};
const INTERACTIVE_AFTER_PICK = {
  teams: T,
  matchups: [matchup('pm1', 1, T[0], T[1]), matchup('pm2', 1, T[0], T[2])],
  picks: [{ season_team_id: T[0].id, pick_order: 1 }],
  current_pot: 2,
  auto_finalized: false,
};

/* Group standings surface (spec surface table, formerly main.jsx:672): a
   CONMEBOL season-kind league whose page branch fetches
   /api/seasons/{season_id}/group-standings/. Two groups of four give the
   success state a countable shape. */
const SEASON_LEAGUE = { id: 'season-1', code: 'LIB', name: 'Copa Libertadores', country: 'CONMEBOL', kind: 'season', season_id: 1 };
const GROUP_STANDINGS = {
  season_id: 1,
  groups: [
    { group: 'A', standings: [
      { id: 1, name: 'Flamengo', short_name: 'FLA', logo_url: '', association: 'BRA', position: 1, played: 3, wins: 2, draws: 1, losses: 0, goals_for: 5, goals_against: 2, goal_diff: 3, points: 7 },
      { id: 2, name: 'Palmeiras', short_name: 'PAL', logo_url: '', association: 'BRA', position: 2, played: 3, wins: 2, draws: 0, losses: 1, goals_for: 4, goals_against: 3, goal_diff: 1, points: 6 },
      { id: 3, name: 'Nacional', short_name: 'NAC', logo_url: '', association: 'URU', position: 3, played: 3, wins: 0, draws: 2, losses: 1, goals_for: 2, goals_against: 4, goal_diff: -2, points: 2 },
      { id: 4, name: 'Bolivar', short_name: 'BOL', logo_url: '', association: 'BOL', position: 4, played: 3, wins: 0, draws: 1, losses: 2, goals_for: 1, goals_against: 3, goal_diff: -2, points: 1 },
    ] },
    { group: 'B', standings: [
      { id: 5, name: 'River Plate', short_name: 'RIV', logo_url: '', association: 'ARG', position: 1, played: 3, wins: 3, draws: 0, losses: 0, goals_for: 6, goals_against: 1, goal_diff: 5, points: 9 },
      { id: 6, name: 'Penarol', short_name: 'PEN', logo_url: '', association: 'URU', position: 2, played: 3, wins: 1, draws: 1, losses: 1, goals_for: 3, goals_against: 3, goal_diff: 0, points: 4 },
      { id: 7, name: 'Cerro Porteno', short_name: 'CER', logo_url: '', association: 'PAR', position: 3, played: 3, wins: 1, draws: 0, losses: 2, goals_for: 2, goals_against: 4, goal_diff: -2, points: 3 },
      { id: 8, name: 'Alianza Lima', short_name: 'ALI', logo_url: '', association: 'PER', position: 4, played: 3, wins: 0, draws: 1, losses: 2, goals_for: 1, goals_against: 4, goal_diff: -3, points: 1 },
    ] },
  ],
};

function freshStub(over = {}) {
  return {
    seasonsStatus: 200, seasons: [{ id: 1, name: '2025-26' }],
    seasonStateStatus: 200, seasonState: SEASON_STATE,
    homeStatus: 200, homeMatches: HOMEMATCHES,
    leaguesStatus: 200, leagues: [],
    groupStandingsStatus: 200, groupStandings: GROUP_STANDINGS, groupStandingsDelayMs: 0,
    realFixturesStatus: 200, realFixtures: REALFIXTURES,
    realPredictionsStatus: 200, realPredictions: { predictions: [] },
    liveStatus: 200, liveScores: {},
    predictionStatus: 200, prediction: { id: 42, match_predictions: [] },
    syncStatus: 200,
    reconStatus: { standings: 200, playoffs: 200, knockout: 200 },
    reconDelayMs: 0, reconDivergent: false,
    detailStatus: 200, detail: MATCHDETAIL,
    pickStatus: 200, pickPayload: INTERACTIVE_AFTER_PICK,
    drawStatus: 200, drawPayload: { summary: { draw_seed: 'prediction-1', total_matchups: 4 } },
    drawInteractive: false,
    hang: null, offline: false, reconOffline: false,
    ...over,
  };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ routing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function makeRoute(stub, requests) {
  return async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname;
    if (!path.startsWith('/api/')) return route.continue();
    const p = path.slice(4);
    const method = req.method();
    requests.push({ t: Date.now(), method, p });
    const ok = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const fail = (status) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ detail: `stub ${status}` }) });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const hang = () => new Promise(() => {});

    if (stub.offline) return route.abort('internetdisconnected');

    if (p === '/seasons/' && method === 'GET') { if (stub.seasonsStatus !== 200) return fail(stub.seasonsStatus); if (stub.seasonsDelayMs) await sleep(stub.seasonsDelayMs); return ok(stub.seasons); }
    if (p === '/homepage/matches/') { if (stub.homeStatus !== 200) return fail(stub.homeStatus); if (stub.homeDelayMs) await sleep(stub.homeDelayMs); return ok(stub.homeMatches); }
    if (p === '/leagues/' && method === 'GET') { if (stub.leaguesStatus !== 200) return fail(stub.leaguesStatus); if (stub.leaguesDelayMs) await sleep(stub.leaguesDelayMs); return ok(stub.leagues); }
    if (/^\/seasons\/[^/]+\/group-standings\/$/.test(p)) { if (stub.groupStandingsStatus !== 200) return fail(stub.groupStandingsStatus); if (stub.groupStandingsDelayMs) await sleep(stub.groupStandingsDelayMs); return ok(stub.groupStandings); }
    if (/^\/ui\/seasons\/[^/]+\/state\/$/.test(p)) { if (stub.seasonStateStatus !== 200) return fail(stub.seasonStateStatus); if (stub.seasonStateDelayMs) await sleep(stub.seasonStateDelayMs); return ok(stub.seasonState); }
    if (/real-fixtures\/$/.test(p)) { if (stub.realFixturesStatus !== 200) return fail(stub.realFixturesStatus); if (stub.realFixturesDelayMs) await sleep(stub.realFixturesDelayMs); return ok(stub.realFixtures); }
    if (/real-predictions\//.test(p)) { if (method === 'PUT') return stub.syncStatus === 200 ? ok({}) : fail(stub.syncStatus); return stub.realPredictionsStatus === 200 ? ok(stub.realPredictions) : fail(stub.realPredictionsStatus); }
    if (/live-scores\/$/.test(p)) return stub.liveStatus === 200 ? ok({ live: stub.liveScores }) : fail(stub.liveStatus);
    if (/match-details\//.test(p)) { if (stub.detailStatus !== 200) return fail(stub.detailStatus); if (stub.detailDelayMs) await sleep(stub.detailDelayMs); return ok(stub.detail); }
    if (p === '/predictions/' && method === 'POST') { if (stub.predictionStatus !== 200) return fail(stub.predictionStatus); if (stub.predictionDelayMs) await sleep(stub.predictionDelayMs); return ok(stub.prediction); }
    if (/^\/predictions\/[^/]+\/(standings|playoffs|knockout)\/$/.test(p)) {
      const surface = p.split('/').pop();
      if (stub.reconOffline) return route.abort('internetdisconnected');
      if (stub.reconStatus[surface] !== 200) return fail(stub.reconStatus[surface]);
      if (stub.hang === surface) return hang();
      if (stub.reconDelayMs) await sleep(stub.reconDelayMs);
      if (surface === 'standings') {
        const base = [
          { team_id: 1, name: 'Real Madrid', position: 1, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_diff: 0, points: 0 },
          { team_id: 2, name: 'Bayern Munich', position: 2, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_diff: 0, points: 0 },
          { team_id: 3, name: 'Liverpool', position: 3, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_diff: 0, points: 0 },
          { team_id: 4, name: 'Inter Milan', position: 4, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_diff: 0, points: 0 },
        ];
        if (stub.reconDivergent) { base[1].position = 1; base[1].points = 9; base[0].position = 2; }
        return ok(base);
      }
      return ok([]);
    }
    if (/^\/predictions\/[^/]+\/sync\/$/.test(p) || /^\/predictions\/[^/]+\/playoffs\/sync\/$/.test(p)) return stub.syncStatus === 200 ? ok({}) : fail(stub.syncStatus);
    if (/^\/predictions\/[^/]+\/$/.test(p) && method === 'PATCH') return ok({});
    if (/interactive\/pick\//.test(p) && method === 'POST') { if (stub.pickStatus !== 200) return fail(stub.pickStatus); if (stub.pickDelayMs) await sleep(stub.pickDelayMs); return ok(stub.pickPayload); }
    if (/\/draw\/$/.test(p) && method === 'POST') { if (stub.drawStatus !== 200) return fail(stub.drawStatus); return ok(stub.drawInteractive ? INTERACTIVE : stub.drawPayload); }
    return ok({});
  };
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
async function ctxFor(browser, { viewport, reducedMotion, stub, init } = {}) {
  const requests = [];
  const state = stub || freshStub();
  const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 900 }, ...(reducedMotion ? { reducedMotion } : {}) });
  await ctx.route('**/api/**', makeRoute(state, requests));
  if (init) await ctx.addInitScript(init);
  return { ctx, requests, stub: state };
}

function watch(page) {
  const warns = [];
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e.message)));
  return { warns, errors, reconWarns: () => warns.filter((w) => w.includes('[reconciliation]')) };
}

async function loadApp(page, wait = 900) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-layout', { timeout: 15000 });
  await page.waitForTimeout(wait);
}
const clickRail = async (page, label) => { await page.evaluate((l) => { const b = [...document.querySelectorAll('.site-nav-link')].find((x) => (x.textContent || '').trim() === l); if (b) b.click(); }, label); await page.waitForTimeout(700); };
const clickMobile = async (page, label) => { await page.evaluate((l) => { const b = [...document.querySelectorAll('.mobile-nav-item')].find((x) => (x.textContent || '').trim() === l); if (b) b.click(); }, label); await page.waitForTimeout(700); };
const clickTab = async (page, label) => { await page.evaluate((l) => { const b = [...document.querySelectorAll('.view-tabs button, .segment-control button')].find((x) => (x.textContent || '').trim() === l); if (b) b.click(); }, label); await page.waitForTimeout(800); };
const openDrawer = async (page) => { await page.evaluate(() => { const b = [...document.querySelectorAll('.mobile-nav-item')].find((x) => (x.textContent || '').trim() === 'Menu'); if (b) b.click(); }); await page.waitForTimeout(350); };
const text = (page, sel) => page.evaluate((s) => document.querySelector(s)?.textContent.trim() || null, sel);

const report = { schema: 'champions-draw/app-evidence/v1', candidate: null, startedAt: new Date().toISOString(), scenarios: {} };
try { report.candidate = execSync('git rev-parse HEAD', { cwd: REPO }).toString().trim(); } catch { /* ignore */ }
/* The candidate commit alone does not describe a tree with uncommitted work, so
   record the git tree actually measured: stage every tracked+untracked file
   (gitignore respected), write the tree object, then restore the index. The
   evidence output file is written after this point, so it is not self-included. */
try {
  execSync('git add -A', { cwd: REPO });
  report.candidateWorktreeTree = execSync('git write-tree', { cwd: REPO }).toString().trim();
} catch { report.candidateWorktreeTree = null; } finally { try { execSync('git reset -q', { cwd: REPO }); } catch { /* ignore */ } }
async function scenario(name, fn) {
  if (FILTER && !name.includes(FILTER)) return;
  const t0 = Date.now();
  try {
    const detail = await fn();
    report.scenarios[name] = { status: 'pass', detail, ms: Date.now() - t0 };
  } catch (error) {
    report.scenarios[name] = { status: 'fail', error: String(error && error.message ? error.message : error), ms: Date.now() - t0 };
  }
  const s = report.scenarios[name];
  console.log(`${s.status === 'pass' ? 'PASS' : 'FAIL'}  ${name}  (${s.ms}ms)${s.error ? ' â€” ' + s.error : ''}`);
}

/* Build + serve the primitive harness for component-level rows. */
function buildHarness() {
  execSync('npx vite build --config harness.vite.config.mjs', { cwd: REPO, stdio: 'ignore' });
}
function startStatic(dir, port) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(dir, p);
    if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ scenarios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
const browser = await chromium.launch();
buildHarness();
const harnessServer = await startStatic(HARNESS_OUT, HARNESS_PORT);
const HARNESS_URL = `http://127.0.0.1:${HARNESS_PORT}/harness/harness.html`;

/* â”€â”€ AS | Crossing the threshold preserves state â”€â”€ */
await scenario('AS.crossing-threshold-preserves-state', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Pots');
  await page.evaluate(() => window.scrollTo(0, 120));
  const before = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent.trim(), activeTab: [...document.querySelectorAll('.view-tabs button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()) }));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({ h1: document.querySelector('h1')?.textContent.trim(), activeTab: [...document.querySelectorAll('.view-tabs button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()), mobileBar: document.querySelectorAll('.mobile-nav-bar .mobile-nav-item').length, menu: [...document.querySelectorAll('.mobile-nav-item')].some((b) => (b.textContent || '').trim() === 'Menu') }));
  await openDrawer(page);
  const drawerTabs = await page.evaluate(() => [...document.querySelectorAll('.mobile-nav-drawer .view-tabs button')].map((b) => b.textContent.trim()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(500);
  const restored = await page.evaluate(() => document.querySelector('h1')?.textContent.trim());
  await ctx.close();
  const ok = before.h1 === 'Draw workspace' && after.h1 === 'Draw workspace' && after.activeTab[0] === 'Pots' && after.mobileBar === 5 && after.menu && drawerTabs.length === 6 && restored === 'Draw workspace';
  if (!ok) throw new Error(`state mismatch ${JSON.stringify({ before, after, drawerTabs, restored })}`);
  return { before, after, drawerTabs, restored };
});

/* â”€â”€ AS | Poll cadence unchanged (real-time 127s sample) â”€â”€ */
await scenario('AS.poll-cadence-unchanged', async () => {
  const { ctx, requests } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    window.__timers = { active: [] };
    const si = window.setInterval.bind(window);
    const ci = window.clearInterval.bind(window);
    window.setInterval = (fn, d, ...a) => { const id = si(fn, d, ...a); window.__timers.active.push({ id, d }); return id; };
    window.clearInterval = (id) => { window.__timers.active = window.__timers.active.filter((r) => r.id !== id); return ci(id); };
  });
  const page = await ctx.newPage();
  await loadApp(page, 1200);
  const started = Date.now();
  const maxActive = { 30000: 0, 60000: 0 };
  const sample = async () => { const a = await page.evaluate(() => { const c = {}; for (const r of window.__timers.active) c[r.d] = (c[r.d] || 0) + 1; return c; }); maxActive[30000] = Math.max(maxActive[30000], a[30000] || 0); maxActive[60000] = Math.max(maxActive[60000], a[60000] || 0); };
  await sample();
  await page.waitForTimeout(35000);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(1200);
  await sample();
  await page.waitForTimeout(14000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(1200);
  await sample();
  await page.waitForTimeout(75000);
  await sample();
  const live = requests.filter((r) => /live-scores\/$/.test(r.p)).map((r) => r.t);
  const hub = requests.filter((r) => r.p === '/homepage/matches/').map((r) => r.t);
  const gaps = (arr) => arr.slice(1).map((t, i) => Math.round((t - arr[i]) / 1000));
  const views = await page.evaluate(() => document.querySelector('h1')?.textContent.trim());
  await ctx.close();
  const liveGaps = gaps(live);
  const hubGaps = gaps(hub);
  const steady = liveGaps.filter((g) => g >= 25 && g <= 40).length;
  // A sub-30s gap is only acceptable when it is the hub refresh re-evaluating its
  // poller (the extra immediate poll lands within a second of a homepage/matches
  // response) â€” never when it is caused by crossing the breakpoint.
  const bursts = [];
  for (let i = 1; i < live.length; i += 1) {
    const gap = Math.round((live[i] - live[i - 1]) / 1000);
    if (gap < 25) {
      const nearHub = hub.some((t) => Math.abs(t - live[i]) <= 1500);
      bursts.push({ gap, nearHub });
    }
  }
  const ok = maxActive[30000] <= 1 && maxActive[60000] <= 1 && steady >= 3 && bursts.every((b) => b.nearHub) && views === 'Live hub';
  const detail = { elapsedS: Math.round((Date.now() - started) / 1000), liveRequests: live.length, liveGaps, steadyGaps: steady, bursts, hubRequests: hub.length, hubGaps, maxActive, viewAfterResizes: views };
  if (!ok) throw new Error(`cadence off ${JSON.stringify(detail)}`);
  return detail;
});

/* â”€â”€ AS | Navigation is keyboard-operable and not color-only â”€â”€ */
await scenario('AS.keyboard-only-navigation', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await page.evaluate(() => document.querySelector('.site-nav-link')?.focus());
  await page.keyboard.press('Tab'); // move to the next rail item
  await page.keyboard.press('Enter'); // activate it
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => {
    const active = document.querySelector('.site-nav-link.active');
    const items = [...document.querySelectorAll('.site-nav-link')];
    const pseudo = active ? getComputedStyle(active, '::before') : null;
    return {
      focusText: document.activeElement ? document.activeElement.textContent.trim() : null,
      h1: document.querySelector('.app-main h1')?.textContent.trim(),
      activeText: active ? active.textContent.trim() : null,
      ariaCurrent: active ? active.getAttribute('aria-current') : null,
      nonColorCue: pseudo ? { content: pseudo.content, width: pseudo.width, height: pseudo.height } : null,
    };
  });
  await ctx.close();
  const ok = info.h1 === 'Official UCL real draw' && info.ariaCurrent === 'page' && info.nonColorCue && info.nonColorCue.content !== 'none' && parseFloat(info.nonColorCue.width) > 0;
  if (!ok) throw new Error(`nav not operable/marked ${JSON.stringify(info)}`);
  return info;
});

/* â”€â”€ AS | Navigation during an active reveal (invariant 2) â”€â”€ */
await scenario('AS.navigation-during-active-reveal', async () => {
  const { ctx, requests, stub } = await ctxFor(browser, { viewport: { width: 390, height: 900 } });
  stub.drawInteractive = true;
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  await loadApp(page);
  await clickMobile(page, 'Simulator');
  const diag = await page.evaluate(() => ({
    view: document.querySelector('.app-main h1')?.textContent.trim() || null,
    hasCommandBand: !!document.querySelector('.command-band'),
    selects: [...document.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.value)),
    runBtns: [...document.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => /Run simul|Running/.test(t)),
    skeleton: !!document.querySelector('.skeleton'),
  }));
  // choose draw method = interactive
  await page.evaluate(() => { const selects = [...document.querySelectorAll('.command-band select')]; const s = selects.find((x) => [...x.options].some((o) => o.value === 'interactive')); if (s) { s.value = 'interactive'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
  await page.waitForTimeout(200);
  const methodNow = await page.evaluate(() => { const s = [...document.querySelectorAll('.command-band select')].find((x) => [...x.options].some((o) => o.value === 'interactive')); return s ? s.value : null; });
  await page.evaluate(() => { const b = document.querySelector('.command-band .button.primary'); if (b) b.click(); });
  await page.waitForTimeout(2000); // interactive stage mounts after draw POST + state load
  const started = await page.evaluate(() => document.querySelectorAll('.team-row').length);
  // pick the first pot-1 team
  await page.evaluate(() => { const b = document.querySelector('.pot-panel .team-row'); if (b) b.click(); });
  await page.waitForTimeout(600);
  const beforeCount = await page.evaluate(() => document.querySelectorAll('.reveal-badges .team-logo').length);
  await openDrawer(page);
  const drawerOpen = await page.evaluate(() => document.querySelector('.mobile-nav-drawer')?.open === true);
  await page.evaluate(() => document.querySelector('.mobile-nav-close')?.click());
  await page.waitForTimeout(1500);
  const midCount = await page.evaluate(() => document.querySelectorAll('.reveal-badges .team-logo').length);
  await openDrawer(page);
  await page.evaluate(() => document.querySelector('.mobile-nav-close')?.click());
  await page.waitForTimeout(1100);
  const afterCount = await page.evaluate(() => document.querySelectorAll('.reveal-badges .team-logo').length);
  const drawPosts = requests.filter((r) => /\/draw\/$/.test(r.p)).length;
  const pickPosts = requests.filter((r) => /interactive\/pick\//.test(r.p)).length;
  await ctx.close();
  const ok = started >= 4 && drawerOpen && midCount > beforeCount && afterCount >= midCount && drawPosts === 1 && pickPosts === 1;
  const detail = { teamRows: started, beforeCount, midCount, afterCount, drawerOpen, drawPosts, pickPosts, diag, methodNow };
  if (!ok) throw new Error(`reveal disturbed ${JSON.stringify(detail)}`);
  return detail;
});

/* â”€â”€ US | Sync fails after typing â”€â”€ */
await scenario('US.sync-fails-after-typing', async () => {
  const stub = freshStub();
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForSelector('.score-input', { timeout: 10000 });
  const inputs = page.locator('.score-input');
  const n = await inputs.count();
  for (let i = 0; i < n; i += 1) await inputs.nth(i).fill('2');
  await page.waitForTimeout(300);
  stub.syncStatus = 500; // the next write fails
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Save Matchday')); if (b) b.click(); });
  await page.waitForTimeout(1000);
  const afterFail = await page.evaluate(() => ({
    values: [...document.querySelectorAll('.score-input')].map((i) => i.value),
    error: document.querySelector('.state-error')?.textContent.replace(/\s+/g, ' ').trim() || null,
    retry: [...document.querySelectorAll('.state-error button')].map((b) => b.textContent.trim()),
  }));
  stub.syncStatus = 200;
  await page.evaluate(() => { const b = [...document.querySelectorAll('.state-error button')].find((x) => (x.textContent || '').includes('Save Matchday')); if (b) b.click(); });
  await page.waitForTimeout(1000);
  const afterRetry = await page.evaluate(() => ({ error: document.querySelector('.state-error')?.textContent.trim() || null }));
  await ctx.close();
  const kept = afterFail.values.length > 0 && afterFail.values.every((v) => v === '2');
  const ok = kept && afterFail.error && /Save failed/i.test(afterFail.error) && afterFail.retry.some((t) => /Save Matchday/i.test(t)) && !afterRetry.error;
  if (!ok) throw new Error(`sync failure not surfaced/retryable ${JSON.stringify({ afterFail, afterRetry })}`);
  return { inputs: n, afterFail, afterRetry };
});

/* â”€â”€ US | Live poll during scroll â”€â”€ */
await scenario('US.live-poll-during-scroll', async () => {
  const stub = freshStub();
  const { ctx } = await ctxFor(browser, {
    viewport: { width: 1200, height: 400 },
    stub,
    init: () => { const si = window.setInterval.bind(window); window.setInterval = (fn, d, ...a) => si(fn, d === 30000 ? 1200 : d, ...a); },
  });
  const page = await ctx.newPage();
  await loadApp(page, 1200);
  await page.evaluate(() => window.scrollTo(0, 240));
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.hub-open-match')?.focus());
  const before = await page.evaluate(() => ({ scrollY: Math.round(window.scrollY), focus: document.activeElement?.className || '' }));
  stub.liveScores = { live1: { home_goals: 2, away_goals: 0 } }; // next accelerated poll carries a new score
  await page.waitForTimeout(2200);
  const after = await page.evaluate(() => ({ liveText: document.querySelector('.hub-score-live')?.textContent.replace(/\s+/g, '') || null, scrollY: Math.round(window.scrollY), focus: document.activeElement?.className || '' }));
  await ctx.close();
  const ok = after.liveText === '2:0' && after.scrollY === before.scrollY && after.focus === before.focus && before.focus.includes('hub-open-match');
  if (!ok) throw new Error(`poll disturbed reader ${JSON.stringify({ before, after })}`);
  return { before, after };
});

/* â”€â”€ US | Homepage skeleton â”€â”€ */
await scenario('US.homepage-skeleton', async () => {
  const stub = freshStub({ homeDelayMs: 1600 });
  const { ctx } = await ctxFor(browser, { viewport: { width: 1200, height: 900 }, stub });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-layout', { timeout: 15000 });
  await page.waitForTimeout(400);
  const pending = await page.evaluate(() => ({
    skeleton: !!document.querySelector('.homepage-matches .skeleton--card'),
    busy: document.querySelector('.homepage-matches .skeleton')?.getAttribute('aria-busy') || null,
    emptyCopy: /No matches today/.test(document.querySelector('.homepage-matches')?.textContent || ''),
    height: Math.round(document.querySelector('.homepage-matches .skeleton')?.getBoundingClientRect().height || 0),
  }));
  await page.waitForTimeout(1800);
  const settled = await page.evaluate(() => ({
    skeletonGone: !document.querySelector('.homepage-matches .skeleton'),
    cards: document.querySelectorAll('.home-game-card').length,
    cardHeight: Math.round(document.querySelector('.home-game-card')?.getBoundingClientRect().height || 0),
  }));
  await ctx.close();
  const ok = pending.skeleton && pending.busy === 'true' && !pending.emptyCopy && settled.skeletonGone && settled.cards > 0;
  if (!ok) throw new Error(`skeleton contract broken ${JSON.stringify({ pending, settled })}`);
  return { pending, settled, note: 'skeleton occupies ' + pending.height + 'px; settled card ' + settled.cardHeight + 'px' };
});

/* â”€â”€ US | Four-state matrix across surfaces â”€â”€ */
await scenario('US.state-matrix', async () => {
  const results = {};
  const adaName = () => localStorage.setItem('champions_draw_player_name', 'Ada');
  const probe = async (name, { stubOver, action, wait, init }) => {
    const stub = freshStub(stubOver);
    const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub, init });
    const page = await ctx.newPage();
    await loadApp(page, 700);
    if (action) { await action(page); }
    await page.waitForTimeout(wait || 500);
    const snap = await page.evaluate(() => ({
      loading: !!document.querySelector('.skeleton, .match-detail-skeleton'),
      busy: !!document.querySelector('[aria-busy="true"]'),
      error: document.querySelector('.state-error')?.textContent.trim() || null,
      empty: document.querySelector('.state-empty')?.textContent.trim() || null,
      h1: document.querySelector('.app-main h1')?.textContent.trim() || null,
      tabs: document.querySelectorAll('.view-tabs button').length,
      cards: document.querySelectorAll('.home-game-card').length,
      rows: document.querySelectorAll('.fixture-list .score-row, .matchday-card .score-row').length,
      /* Group standings is one region of a two-region page (standings column +
         fixtures aside), so each state is read scoped to the standings column
         and the group tables are counted explicitly. */
      gsSkeleton: !!document.querySelector('.standings-layout--league > div .skeleton'),
      gsSkeletonLabel: document.querySelector('.standings-layout--league > div .skeleton .sr-only')?.textContent.trim() || null,
      gsError: document.querySelector('.standings-layout--league > div .state-error strong')?.textContent.trim() || null,
      gsRetry: document.querySelector('.standings-layout--league > div .state-error .state-retry')?.textContent.trim() || null,
      gsEmpty: document.querySelector('.standings-layout--league > div .state-empty strong')?.textContent.trim() || null,
      gsBlocks: document.querySelectorAll('.group-standings .group-standing-block').length,
      gsRows: document.querySelectorAll('.group-standings .standings-table tbody tr').length,
    }));
    await ctx.close();
    results[name] = snap;
    return snap;
  };
  await probe('seasons.loading', { stubOver: { seasonsDelayMs: 3000 }, action: (p) => clickRail(p, 'Draw Simulator'), wait: 300 });
  await probe('seasons.error', { stubOver: { seasonsStatus: 500 }, action: (p) => clickRail(p, 'Draw Simulator') });
  await probe('seasons.empty', { stubOver: { seasons: [] }, action: (p) => clickRail(p, 'Draw Simulator') });
  await probe('seasons.success', { action: (p) => clickRail(p, 'Draw Simulator') });
  await probe('home.loading', { stubOver: { homeDelayMs: 3000 }, wait: 300 });
  await probe('home.error', { stubOver: { homeStatus: 500 }, wait: 800 });
  await probe('home.empty', { stubOver: { homeMatches: { matchups: [] } }, wait: 800 });
  await probe('home.success', { wait: 900 });
  await probe('leagues.loading', { stubOver: { leaguesDelayMs: 3000 }, action: (p) => clickRail(p, 'Leagues'), wait: 300 });
  await probe('leagues.error', { stubOver: { leaguesStatus: 500 }, action: (p) => clickRail(p, 'Leagues') });
  await probe('leagues.empty', { action: (p) => clickRail(p, 'Leagues') });
  await probe('leagues.success', { stubOver: { leagues: [{ id: 1, name: 'Premier League' }] }, action: (p) => clickRail(p, 'Leagues') });
  await probe('seasonState.loading', { stubOver: { seasonStateDelayMs: 3000 }, action: (p) => clickRail(p, 'Draw Simulator'), wait: 300 });
  await probe('seasonState.error', { stubOver: { seasonStateStatus: 500 }, action: (p) => clickRail(p, 'Draw Simulator') });
  await probe('seasonState.success', { action: (p) => clickRail(p, 'Draw Simulator') });
  await probe('realFixtures.loading', { stubOver: { realFixturesDelayMs: 3000 }, action: (p) => clickRail(p, 'Real Draw'), wait: 300 });
  await probe('realFixtures.error', { stubOver: { realFixturesStatus: 500 }, action: (p) => clickRail(p, 'Real Draw') });
  await probe('realFixtures.success', { action: (p) => clickRail(p, 'Real Draw') });
  await probe('prediction.loading', { stubOver: { predictionDelayMs: 3000 }, init: adaName, action: async (p) => { await clickRail(p, 'Draw Simulator'); await clickTab(p, 'Predict'); }, wait: 300 });
  await probe('prediction.error', { stubOver: { predictionStatus: 500 }, init: adaName, action: async (p) => { await clickRail(p, 'Draw Simulator'); await clickTab(p, 'Predict'); } });
  await probe('prediction.success', { init: adaName, action: async (p) => { await clickRail(p, 'Draw Simulator'); await clickTab(p, 'Predict'); } });
  await probe('matchDetail.loading', { stubOver: { detailDelayMs: 3000 }, action: async (p) => { await pageOpenMatch(p); }, wait: 300 });
  await probe('matchDetail.error', { stubOver: { detailStatus: 500 }, action: async (p) => { await pageOpenMatch(p); } });
  await probe('matchDetail.success', { action: async (p) => { await pageOpenMatch(p); } });
  await probe('interactivePick.error', { stubOver: { drawInteractive: true, pickStatus: 500 }, init: adaName, action: async (p) => { await pageRunInteractive(p); } });
  await probe('interactivePick.loading', { stubOver: { drawInteractive: true, pickDelayMs: 2500 }, init: adaName, action: async (p) => { await pageRunInteractive(p); }, wait: 100 });
  const seasonLeague = { stubOver: { leagues: [SEASON_LEAGUE] }, action: async (p) => { await pageOpenSeasonLeague(p); } };
  await probe('groupStandings.loading', { ...seasonLeague, stubOver: { leagues: [SEASON_LEAGUE], groupStandingsDelayMs: 3000 }, wait: 200 });
  await probe('groupStandings.error', { ...seasonLeague, stubOver: { leagues: [SEASON_LEAGUE], groupStandingsStatus: 500 } });
  await probe('groupStandings.empty', { ...seasonLeague, stubOver: { leagues: [SEASON_LEAGUE], groupStandings: { season_id: 1, groups: [] } } });
  await probe('groupStandings.success', { ...seasonLeague });

  async function pageOpenSeasonLeague(p) {
    await clickRail(p, 'Leagues');
    await p.evaluate(() => document.querySelector('.league-card')?.click());
    await p.waitForTimeout(400);
  }

  async function pageOpenMatch(p) { await p.evaluate(() => document.querySelector('.hub-open-match')?.click()); await p.waitForTimeout(600); }
  async function pageRunInteractive(p) {
    await clickRail(p, 'Draw Simulator');
    await p.evaluate(() => { const selects = [...document.querySelectorAll('.command-band select')]; const s = selects.find((x) => [...x.options].some((o) => o.value === 'interactive')); if (s) { s.value = 'interactive'; s.dispatchEvent(new Event('change', { bubbles: true })); } });
    await p.waitForTimeout(200);
    await p.evaluate(() => { const b = document.querySelector('.command-band .button.primary'); if (b) b.click(); });
    await p.waitForTimeout(1600);
    await p.evaluate(() => document.querySelector('.pot-panel .team-row')?.click());
    await p.waitForTimeout(800);
  }

  /* Per-endpoint retry isolation (US:no-silent-failure): on the group standings
     error the retry re-issues only /seasons/{id}/group-standings/ and leaves the
     independently-failing matchups feed alone. */
  {
    const stub = freshStub({ leagues: [SEASON_LEAGUE], groupStandingsStatus: 500 });
    const { ctx, requests } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
    const page = await ctx.newPage();
    await loadApp(page, 700);
    await pageOpenSeasonLeague(page);
    await page.waitForTimeout(400);
    const groupGets = () => requests.filter((r) => /group-standings\/$/.test(r.p)).length;
    const stateGets = () => requests.filter((r) => /^\/ui\/seasons\/[^/]+\/state\/$/.test(r.p)).length;
    const before = { group: groupGets(), state: stateGets() };
    const errorShown = await page.evaluate(() => ({
      title: document.querySelector('.standings-layout--league > div .state-error strong')?.textContent.trim() || null,
      retry: document.querySelector('.standings-layout--league > div .state-error .state-retry')?.textContent.trim() || null,
    }));
    stub.groupStandingsStatus = 200;
    await page.evaluate(() => document.querySelector('.standings-layout--league > div .state-error .state-retry')?.click());
    await page.waitForTimeout(900);
    const after = { group: groupGets(), state: stateGets() };
    const settled = await page.evaluate(() => ({
      error: !!document.querySelector('.standings-layout--league > div .state-error'),
      blocks: document.querySelectorAll('.group-standings .group-standing-block').length,
    }));
    await ctx.close();
    results['groupStandings.retryIsolation'] = { before, after, errorShown, settled };
  }

  const surfaces = ['seasons', 'home', 'leagues', 'seasonState', 'realFixtures', 'prediction', 'matchDetail', 'interactivePick', 'groupStandings'];
  const missing = [];
  for (const s of surfaces) {
    const has = ['loading', 'error'].every((k) => results[`${s}.${k}`] && (results[`${s}.${k}`].loading || results[`${s}.${k}`].error || results[`${s}.${k}`].busy));
    if (!has) missing.push(s);
  }
  /* The generic loop above only proves "a loading-ish and an error-ish node
     exist"; for group standings assert each state by its own copy and shape so
     an unrelated skeleton/error elsewhere on the page cannot satisfy it. */
  const gs = (k) => results[`groupStandings.${k}`] || {};
  const gsStatesOk =
    gs('loading').gsSkeleton && gs('loading').gsSkeletonLabel === 'Loading standings' &&
    gs('error').gsError === 'Group standings could not load' && gs('error').gsRetry === 'Retry' &&
    gs('empty').gsEmpty === 'No group table yet' &&
    gs('success').gsBlocks >= 2 && gs('success').gsRows >= 8;
  const iso = results['groupStandings.retryIsolation'];
  const isoOk = !!iso && iso.before.group === 1 && iso.after.group === 2 && iso.after.state === iso.before.state &&
    iso.errorShown.title === 'Group standings could not load' && iso.errorShown.retry === 'Retry' &&
    !iso.settled.error && iso.settled.blocks >= 2;
  const detail = { results, surfacesMissingAState: missing, groupStandingsFourStates: gsStatesOk, retryIsolation: isoOk };
  const summary = {};
  for (const s of surfaces) summary[s] = { loading: results[`${s}.loading`], error: results[`${s}.error`] };
  if (missing.length) throw new Error(`four-state contract incomplete for: ${missing.join(', ')} :: ${JSON.stringify(summary).slice(0, 5000)}`);
  if (!gsStatesOk) throw new Error(`group standings does not render all four states :: ${JSON.stringify({ loading: gs('loading'), error: gs('error'), empty: gs('empty'), success: gs('success') })}`);
  if (!isoOk) throw new Error(`group standings retry is not endpoint-isolated :: ${JSON.stringify(iso)}`);
  return detail;
});

/* â”€â”€ A11Y | Card behaves as a control â”€â”€ */
await scenario('A11Y.card-behaves-as-control', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  const info = await page.evaluate(() => {
    const b = document.querySelector('.hub-open-match');
    if (!b) return null;
    return { tag: b.tagName.toLowerCase(), role: b.getAttribute('role') || b.tagName.toLowerCase(), ariaLabel: b.getAttribute('aria-label'), tabIndex: b.tabIndex };
  });
  await page.evaluate(() => document.querySelector('.hub-open-match')?.focus());
  await page.keyboard.press('Enter');
  await page.waitForTimeout(900);
  const dialog = await page.evaluate(() => document.querySelector('dialog[open]')?.className || null);
  await ctx.close();
  const ok = info && info.ariaLabel && /versus/i.test(info.ariaLabel) && dialog === 'match-detail-view';
  if (!ok) throw new Error(`card control missing ${JSON.stringify({ info, dialog })}`);
  return { control: info, openedDialog: dialog };
});

/* â”€â”€ A11Y | Dialog semantics and focus return â”€â”€ */
await scenario('A11Y.dialog-focus-return', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await page.evaluate(() => document.querySelector('.hub-open-match')?.click());
  await page.waitForTimeout(900);
  const open = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    const bg = document.querySelector('.app-main > div[hidden]');
    return { className: d?.className || null, ariaLabel: d?.getAttribute('aria-label') || null, bgHidden: !!bg };
  });
  let leaked = false;
  const tabs = [];
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); const a = document.activeElement; return { cls: String(a.className || a.tagName).slice(0, 40), inside: !!d && d.contains(a) }; });
    tabs.push(info);
    if (!info.inside) leaked = true;
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  const returned = await page.evaluate(() => ({ cls: document.activeElement?.className || '', dialogGone: !document.querySelector('dialog[open]') }));
  await ctx.close();
  const ok = open.className === 'match-detail-view' && open.ariaLabel && open.bgHidden && !leaked && returned.dialogGone && returned.cls.includes('hub-open-match');
  if (!ok) throw new Error(`dialog semantics broken ${JSON.stringify({ open, tabs, leaked, returned })}`);
  return { open, tabs, leaked, returned };
});

/* â”€â”€ A11Y | Reduced motion â”€â”€ */
await scenario('A11Y.reduced-motion', async () => {
  const read = async (rm) => {
    const { ctx } = await ctxFor(browser, { viewport: { width: 390, height: 900 }, reducedMotion: rm });
    const page = await ctx.newPage();
    await loadApp(page);
    await openDrawer(page);
    const s = await page.evaluate(() => {
      const d = document.querySelector('.mobile-nav-drawer');
      const trigger = [...document.querySelectorAll('.mobile-nav-item')].find((x) => (x.textContent || '').trim() === 'Menu');
      const active = document.querySelector('.mobile-nav-item.active');
      const cs = getComputedStyle(d);
      return { animationName: cs.animationName, transitionDuration: cs.transitionDuration, open: d.open === true, ariaExpanded: trigger?.getAttribute('aria-expanded'), ariaCurrent: active?.getAttribute('aria-current') };
    });
    await ctx.close();
    return s;
  };
  const normal = await read('no-preference');
  const reduced = await read('reduce');
  const ok = normal.animationName === 'mobile-nav-in' && reduced.animationName === 'none' && reduced.transitionDuration === '0s' && reduced.open && reduced.ariaExpanded === 'true' && reduced.ariaCurrent === 'page';
  if (!ok) throw new Error(`reduced motion contract broken ${JSON.stringify({ normal, reduced })}`);
  return { normal, reduced };
});

/* â”€â”€ A11Y | Full keyboard pass (visible focus everywhere) â”€â”€ */
await scenario('A11Y.full-keyboard-pass', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  const sweep = async () => {
    await page.evaluate(() => document.querySelector('a.skip-link')?.focus());
    const noRing = [];
    let stops = 0;
    for (let i = 0; i < 160; i += 1) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        const cs = getComputedStyle(a);
        return { tag: a.tagName.toLowerCase(), cls: String(a.className || '').slice(0, 40), outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow !== 'none' };
      });
      if (info.tag === 'body') break;
      stops += 1;
      const ring = (info.outlineStyle !== 'none' && info.outlineWidth !== '0px') || info.boxShadow;
      if (!ring) noRing.push(info);
    }
    return { stops, noRing };
  };
  const home = await sweep();
  await clickRail(page, 'Real Draw');
  const real = await sweep();
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  const predict = await sweep();
  await ctx.close();
  const allNoRing = [...home.noRing, ...real.noRing, ...predict.noRing];
  const ok = home.stops > 0 && real.stops > 0 && allNoRing.length === 0;
  if (!ok) throw new Error(`focus ring missing ${JSON.stringify({ home: home.noRing, real: real.noRing, predict: predict.noRing })}`);
  return { home, real, predict };
});

/* â”€â”€ A11Y | Labelled form controls (score input name) â”€â”€ */
await scenario('A11Y.score-input-name', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForSelector('.score-input', { timeout: 10000 });
  const labels = await page.evaluate(() => [...document.querySelectorAll('.score-input')].map((i) => i.getAttribute('aria-label')));
  await ctx.close();
  const ok = labels.length >= 2 && labels.every((l) => l && /goals/i.test(l) && /versus/i.test(l));
  if (!ok) throw new Error(`score inputs unnamed ${JSON.stringify(labels)}`);
  return { labels };
});

/* â”€â”€ A11Y | Status is never color-only (status dot) â”€â”€ */
await scenario('A11Y.status-dot', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Saved runs');
  await page.waitForTimeout(500);
  const dot = await page.evaluate(() => {
    const d = document.querySelector('.status-dot');
    if (!d) return null;
    const row = d.closest('.history-row');
    return { ariaHidden: d.getAttribute('aria-hidden'), iconSvg: !!d.querySelector('svg'), srText: row?.querySelector('.sr-only')?.textContent.trim() || null, rowText: row?.textContent.replace(/\s+/g, ' ').trim().slice(0, 90) };
  });
  await ctx.close();
  const ok = dot && dot.iconSvg && dot.srText && /completed|failed|running|pending/i.test(dot.srText) && /COMPLETED/i.test(dot.rowText);
  if (!ok) throw new Error(`status dot has no non-color cue ${JSON.stringify(dot)}`);
  return dot;
});

/* â”€â”€ CS | Cross-view navigation preserves a half-filled identity build â”€â”€ */
await scenario('CS.cross-view-navigation', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Career Mode');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Create your player')); if (b) b.click(); });
  await page.waitForTimeout(500);
  await page.locator('.identity-builder input').first().fill('Morgan');
  await page.evaluate(() => document.querySelector('.position-grid button')?.click());
  const before = await page.evaluate(() => ({ name: document.querySelector('.identity-builder input')?.value, position: document.querySelector('.position-grid button.selected')?.textContent.trim() || null, career: localStorage.getItem('champions_draw_career_v1') }));
  await clickRail(page, 'Home');
  await clickRail(page, 'Career Mode');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ name: document.querySelector('.identity-builder input')?.value, position: document.querySelector('.position-grid button.selected')?.textContent.trim() || null, career: localStorage.getItem('champions_draw_career_v1') }));
  await ctx.close();
  const ok = before.name === 'Morgan' && after.name === 'Morgan' && after.position === before.position && after.career === null;
  if (!ok) throw new Error(`identity draft lost or career written ${JSON.stringify({ before, after })}`);
  return { before, after };
});

/* â”€â”€ CS | All four surfaces reachable inside the shell â”€â”€ */
await scenario('CS.all-four-surfaces', async () => {
  const engine = await import(new URL('../src/careerEngine.mjs', import.meta.url).href);
  const clubData = JSON.parse(readFileSync(join(HERE, '..', 'src', 'careerClubs.json'), 'utf8'));
  const catalog = clubData.map((c) => ({ ...c, logoUrl: c.logoUrl || '' }));
  let career = engine.createCareer({ name: 'Morgan', number: 10, foot: 'right', nationality: 'GB', position: engine.POSITIONS[0] }, 123456789, catalog);
  let guard = 0;
  while (career.status === 'active' && career.event && guard++ < 60) career = engine.applyCareerChoice(career, career.event.options[0].id, catalog);
  const finished = career.status === 'finished';

  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.__vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; }; });
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Career Mode');
  const intro = await page.evaluate(() => ({ intro: !!document.querySelector('.career-intro'), shellNav: [...document.querySelectorAll('nav[aria-label="Primary"]')].filter(window.__vis).length, ownChrome: !!document.querySelector('.career-app-shell') }));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Create your player')); if (b) b.click(); });
  await page.waitForTimeout(400);
  const builder = await page.evaluate(() => ({ builder: !!document.querySelector('.identity-builder'), shellNav: [...document.querySelectorAll('nav[aria-label="Primary"]')].filter(window.__vis).length, ownChrome: !!document.querySelector('.career-app-shell') }));
  // seed the finished career and reload to reach dashboard + summary
  await page.evaluate((c) => localStorage.setItem('champions_draw_career_v1', c), JSON.stringify(career));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-layout');
  await page.waitForTimeout(700);
  await clickRail(page, 'Career Mode');
  const dashboard = await page.evaluate(() => ({ dashboard: !!document.querySelector('.career-dashboard'), retirement: !!document.querySelector('.retirement-panel'), shellNav: [...document.querySelectorAll('nav[aria-label="Primary"]')].filter(window.__vis).length, ownChrome: !!document.querySelector('.career-app-shell') }));
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('View career summary')); if (b) b.click(); });
  await page.waitForTimeout(400);
  const summary = await page.evaluate(() => ({ summary: !!document.querySelector('.career-summary'), shellNav: [...document.querySelectorAll('nav[aria-label="Primary"]')].filter(window.__vis).length, ownChrome: !!document.querySelector('.career-app-shell') }));
  await ctx.close();
  const ok = finished && intro.intro && builder.builder && dashboard.dashboard && dashboard.retirement && summary.summary && [intro, builder, dashboard, summary].every((s) => s.shellNav === 1 && !s.ownChrome);
  if (!ok) throw new Error(`career surfaces not all reachable in shell ${JSON.stringify({ finished, intro, builder, dashboard, summary })}`);
  return { finished, intro, builder, dashboard, summary };
});

/* â”€â”€ CS | Legacy career loads â”€â”€ */
await scenario('CS.legacy-career-loads', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Career Mode');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Create your player')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.locator('.identity-builder input').first().fill('Morgan');
  await page.locator('.identity-builder input[type="search"]').fill('United Kingdom');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.country-grid button')].find((x) => /United Kingdom/.test(x.textContent)); if (b) b.click(); });
  await page.evaluate(() => document.querySelector('.position-grid button')?.click());
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Confirm player')); if (b) b.click(); });
  await page.waitForTimeout(500);
  const written = await page.evaluate(() => localStorage.getItem('champions_draw_career_v1'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.app-layout');
  await page.waitForTimeout(700);
  await clickRail(page, 'Career Mode');
  const restored = await page.evaluate(() => ({ dashboard: !!document.querySelector('.career-dashboard'), name: document.querySelector('.player-identity h1')?.textContent.trim() || null, notice: document.querySelector('.career-notice')?.textContent.trim() || null, storedSame: localStorage.getItem('champions_draw_career_v1') === window.__written }));
  // write the expected payload into the page for comparison
  await page.evaluate((w) => { window.__written = w; }, written);
  const check = await page.evaluate((w) => ({ same: localStorage.getItem('champions_draw_career_v1') === w }), written);
  await ctx.close();
  const ok = written && restored.dashboard && restored.name === 'Morgan' && !restored.notice && check.same;
  if (!ok) throw new Error(`legacy career not restored ${JSON.stringify({ restored, check })}`);
  return { writtenLength: written.length, restored, check };
});

/* â”€â”€ CS | No writes outside the career key â”€â”€ */
await scenario('CS.no-writes-outside-key', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Career Mode');
  const snapshot = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const before = await snapshot();
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Create your player')); if (b) b.click(); });
  await page.waitForTimeout(400);
  await page.locator('.identity-builder input').first().fill('Morgan');
  await page.locator('.identity-builder input[type="search"]').fill('United Kingdom');
  await page.waitForTimeout(300);
  await page.evaluate(() => { const b = [...document.querySelectorAll('.country-grid button')].find((x) => /United Kingdom/.test(x.textContent)); if (b) b.click(); });
  await page.evaluate(() => document.querySelector('.position-grid button')?.click());
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').includes('Confirm player')); if (b) b.click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { const b = document.querySelector('.career-option'); if (b) b.click(); });
  await page.waitForTimeout(600);
  const after = await snapshot();
  await ctx.close();
  const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k]);
  const ok = changed.length === 1 && changed[0] === 'champions_draw_career_v1';
  if (!ok) throw new Error(`career wrote outside its key: ${JSON.stringify(changed)}`);
  return { changed, careerKeyBytes: (after.champions_draw_career_v1 || '').length };
});

/* â”€â”€ PR | Mismatch does not change pixels â”€â”€ */
await scenario('PR.mismatch-does-not-change-pixels', async () => {
  const stub = freshStub({ reconDivergent: true, reconDelayMs: 1200 });
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  const w = watch(page);
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await clickTab(page, 'Standings');
  await page.waitForTimeout(400);
  const before = await text(page, '.league-table');
  const beforeIndicators = await page.evaluate(() => ({ alerts: document.querySelectorAll('[role="alert"]').length, live: document.querySelectorAll('.live-region').length, badges: document.querySelectorAll('.prediction-app .badge').length }));
  await page.waitForTimeout(1800);
  const after = await text(page, '.league-table');
  const afterIndicators = await page.evaluate(() => ({ alerts: document.querySelectorAll('[role="alert"]').length, live: document.querySelectorAll('.live-region').length, badges: document.querySelectorAll('.prediction-app .badge').length }));
  await ctx.close();
  const ok = before && before === after && JSON.stringify(beforeIndicators) === JSON.stringify(afterIndicators) && w.reconWarns().length >= 1;
  if (!ok) throw new Error(`mismatch changed the UI ${JSON.stringify({ changed: before !== after, beforeIndicators, afterIndicators, warns: w.reconWarns() })}`);
  return { tableUnchanged: before === after, indicators: afterIndicators, warnCount: w.reconWarns().length };
});

/* â”€â”€ PR | Slow confirmation never blocks â”€â”€ */
await scenario('PR.slow-confirmation-never-blocks', async () => {
  const stub = freshStub({ hang: 'standings' });
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForSelector('.score-input', { timeout: 10000 });
  const t0 = Date.now();
  await page.locator('.score-input').first().fill('3');
  await page.waitForFunction(() => document.querySelector('.score-input')?.value === '3', null, { timeout: 2000 });
  const fillMs = Date.now() - t0;
  await clickTab(page, 'Standings');
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => ({
    rows: document.querySelectorAll('.league-table tbody tr').length,
    disabledInputs: [...document.querySelectorAll('.score-input')].filter((i) => i.disabled).length,
    disabledControls: [...document.querySelectorAll('.prediction-app button')].filter((b) => b.disabled).length,
    skeleton: !!document.querySelector('.prediction-app .skeleton'),
  }));
  await ctx.close();
  const ok = fillMs < 2000 && info.rows > 0 && info.disabledInputs === 0 && !info.skeleton;
  if (!ok) throw new Error(`reconciliation blocked rendering ${JSON.stringify({ fillMs, info })}`);
  return { fillMs, info, note: 'standings GET held open; client table still rendered' };
});

/* â”€â”€ PR | Bounded trigger frequency â”€â”€ */
await scenario('PR.typing-does-not-trigger-checks', async () => {
  const { ctx, requests } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForSelector('.score-input', { timeout: 10000 });
  await page.waitForTimeout(800);
  const confirmGets = () => requests.filter((r) => /^\/predictions\/[^/]+\/(standings|playoffs|knockout)\/$/.test(r.p)).length;
  const baseline = confirmGets();
  const inputs = page.locator('.score-input');
  const n = await inputs.count();
  for (let i = 0; i < n; i += 1) { await inputs.nth(i).fill('1'); }
  for (let i = 0; i < 20; i += 1) { const target = inputs.nth(i % n); await target.fill(String((i % 5) + 1)); }
  await page.waitForTimeout(1500);
  const after = confirmGets();
  await ctx.close();
  const ok = baseline <= 3 && after === baseline;
  if (!ok) throw new Error(`edits triggered checks baseline=${baseline} after=${after}`);
  return { baseline, after, note: 'mount-time checks per surface only; 20 edits added none' };
});

/* â”€â”€ PR | Local-only prediction (no persisted id) â”€â”€ */
await scenario('PR.local-only-prediction', async () => {
  const stub = freshStub({ prediction: { id: null, match_predictions: [] } });
  const { ctx, requests } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForSelector('.score-input', { timeout: 10000 });
  const inputs = page.locator('.score-input');
  const n = await inputs.count();
  for (let i = 0; i < n; i += 1) await inputs.nth(i).fill('2');
  await page.waitForTimeout(1500);
  const confirmGets = requests.filter((r) => /^\/predictions\/[^/]+\/(standings|playoffs|knockout)\/$/.test(r.p)).length;
  await ctx.close();
  const ok = confirmGets === 0;
  if (!ok) throw new Error(`no-id prediction still issued ${confirmGets} confirmation GET(s)`);
  return { confirmGets };
});

/* â”€â”€ PR | Log content â”€â”€ */
await scenario('PR.log-content', async () => {
  const stub = freshStub({ reconDivergent: true });
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  const w = watch(page);
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForTimeout(1600);
  const storage = await page.evaluate(() => Object.keys(localStorage));
  await ctx.close();
  const logistics = w.reconWarns();
  const joined = logistics.join(' | ');
  const hasSurface = /standings/.test(joined);
  const hasClient = /clientValue/.test(joined);
  const hasServer = /serverValue/.test(joined);
  const ok = logistics.length >= 1 && hasSurface && hasClient && hasServer && !storage.some((k) => /reconcil/i.test(k));
  if (!ok) throw new Error(`warn content/storage wrong ${JSON.stringify({ logistics, storage })}`);
  return { warnCount: logistics.length, sample: logistics[0]?.slice(0, 220), storageKeys: storage };
});

/* â”€â”€ PR | 502 during confirmation â”€â”€ */
await scenario('PR.502-during-confirmation', async () => {
  const stub = freshStub({ reconStatus: { standings: 502, playoffs: 200, knockout: 200 } });
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  const w = watch(page);
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await clickTab(page, 'Standings');
  await page.waitForTimeout(1800);
  const info = await page.evaluate(() => ({ rows: document.querySelectorAll('.league-table tbody tr').length, userError: document.querySelector('.prediction-app .state-error')?.textContent.trim() || null, pageError: document.querySelector('.app-main > .state-error')?.textContent.trim() || null }));
  await ctx.close();
  const standingsWarns = w.reconWarns().filter((x) => x.includes('[reconciliation] standings'));
  const ok = info.rows > 0 && !info.userError && !info.pageError && standingsWarns.length === 1;
  if (!ok) throw new Error(`502 leaked to users ${JSON.stringify({ info, standingsWarns })}`);
  return { ...info, standingsWarnCount: standingsWarns.length, totalReconWarns: w.reconWarns().length };
});

/* â”€â”€ PR | Offline then reconnected â”€â”€ */
await scenario('PR.offline-then-reconnected', async () => {
  const stub = freshStub({ reconOffline: true });
  const { ctx, requests } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => localStorage.setItem('champions_draw_player_name', 'Ada'));
  const page = await ctx.newPage();
  const w = watch(page);
  await loadApp(page);
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForTimeout(1400);
  const offlineWarns = w.reconWarns().length;
  const offlineRendered = await page.evaluate(() => !!document.querySelector('.prediction-app .view-tabs'));
  stub.reconOffline = false;
  await page.waitForTimeout(31000); // pass the 30s per-surface rate limit
  // next natural trigger: remount the surface by leaving the workspace and returning
  await clickRail(page, 'Home');
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForTimeout(1800);
  const confirmGets = requests.filter((r) => /^\/predictions\/[^/]+\/(standings|playoffs|knockout)\/$/.test(r.p)).length;
  await ctx.close();
  const ok = offlineWarns === 3 && offlineRendered && confirmGets >= 6;
  if (!ok) throw new Error(`offline/reconnect wrong ${JSON.stringify({ offlineWarns, offlineRendered, confirmGets })}`);
  return { offlineWarns, offlineRendered, confirmGets };
});

/* â”€â”€ PR | Protected storage keys stay untouched â”€â”€ */
await scenario('PR.storage-untouched', async () => {
  const stub = freshStub();
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 }, stub });
  await ctx.addInitScript(() => {
    localStorage.setItem('champions_draw_player_name', 'Ada');
    localStorage.setItem('champions_draw_prediction_1_Ada', JSON.stringify({ matchPredictions: {}, drawSeed: 'prediction-1' }));
    localStorage.setItem('champions_draw_real_prediction_1_Ada', JSON.stringify({ r1: { home_goals: 1 } }));
    localStorage.setItem('champions_draw_career_v1', JSON.stringify({ schemaVersion: 1, marker: 'CAREER' }));
  });
  const page = await ctx.newPage();
  await loadApp(page);
  const keys = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const before = await keys();
  await clickRail(page, 'Draw Simulator');
  await clickTab(page, 'Predict');
  await page.waitForTimeout(1800);
  const after = await keys();
  await ctx.close();
  const protectedKeys = ['champions_draw_prediction_1_Ada', 'champions_draw_real_prediction_1_Ada', 'champions_draw_career_v1'];
  const unchanged = protectedKeys.every((k) => before[k] === after[k]);
  const newKeys = Object.keys(after).filter((k) => !(k in before));
  const ok = unchanged && newKeys.length === 0;
  if (!ok) throw new Error(`reconciliation touched storage ${JSON.stringify({ unchanged, newKeys })}`);
  return { protectedKeys, unchanged, newKeys };
});

/* â”€â”€ DT | Theme switch keyboard-operable â”€â”€ */
await scenario('DT.theme-switch-keyboard', async () => {
  const { ctx } = await ctxFor(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await loadApp(page);
  await page.evaluate(() => document.querySelector('.site-nav-footer button')?.focus());
  const before = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, pressed: document.querySelector('.site-nav-footer button')?.getAttribute('aria-pressed') }));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, pressed: document.querySelector('.site-nav-footer button')?.getAttribute('aria-pressed'), focused: document.activeElement === document.querySelector('.site-nav-footer button'), key: localStorage.getItem('champions_draw_theme') }));
  await ctx.close();
  const ok = before.theme === 'light' && after.theme === 'dark' && after.pressed === 'true' && after.focused && after.key === 'dark';
  if (!ok) throw new Error(`theme switch not keyboard-operable ${JSON.stringify({ before, after })}`);
  return { before, after };
});

/* â”€â”€ DT | Primitives consume declared scale steps â”€â”€ */
await scenario('DT.complete-scales', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#buttons .button');
  const data = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const px = (v) => { const m = /^(-?[\d.]+)px$/.exec((v || '').trim()); return m ? Math.round(parseFloat(m[1])) : null; };
    /* Padding is checked against the declared SPACE scale only and radius
       against the RADIUS scale only. Unioning them was the unsound part: a 6px
       padding passed because 6 is --radius-sm. */
    const space = new Set();
    const radius = new Set();
    for (const name of root) {
      const n = px(root.getPropertyValue(name));
      if (n === null) continue;
      if (name.indexOf('--space-') === 0) space.add(n);
      else if (name.indexOf('--radius-') === 0) radius.add(n);
    }

    /* The requirement is over declared rules, not the harness DOM: a card that
       only renders on another route must still be inspected. Rules are matched
       by selector keyword per category, and each matched rule's padding/radius
       is resolved through a live probe so var() chains and shorthand follow the
       browser's own parsing. Fluid clamp()/viewport/% values are not scale
       members and are skipped by design. */
    const CATEGORIES = [
      { name: 'table cell', test: (s) => /(^|[\s,>+~])(th|td)\b/.test(s) },
      { name: 'button', test: (s) => /(^|[\s,>+~])button\b/.test(s) || /(^|[\s,>+~])\.button\b/.test(s) || /-toggle\b/.test(s) },
      { name: 'card', test: (s) => /(^|[\s,>+~])[.#][\w-]*card\b/.test(s) || /\.playoff-(match|tie-card)\b/.test(s) },
      { name: 'badge', test: (s) => /(^|[\s,>+~])[.#][\w-]*(badge|chip|pill)\b/.test(s) || /\.(playoff-agg|tie-agg|hub-status|playoff-tie-desc|ko-tie-desc)\b/.test(s) },
    ];
    /* Named representatives the requirement lists. Each must appear among the
       scanned rules: a selector filter that reaches nothing must not pass. */
    const REQUIRED = [
      '.league-table th', '.league-table td', '.sidebar-table th', '.sidebar-table td',
      '.real-league-table th', '.real-league-table td', '.standings-table th', '.standings-table td',
      '.segment-control button', '.view-tabs button', '.next-matches-toggle',
      '.ucl-card', '.league-card', '.panel-card', '.playoff-match', '.playoff-tie-card',
      '.playoff-won-badge', '.playoff-agg', '.tie-agg', '.hub-status', '.league-badge',
      '.playoff-tie-desc', '.ko-tie-desc',
    ];

    const rules = [];
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
        if (r.selectorText) rules.push({ sel: r.selectorText, style: r.style });
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (e) { /* cross-origin sheet */ } }

    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const PAD = ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'padding-block', 'padding-inline'];
    const measure = (style) => {
      const out = { pads: null, radius: null };
      probe.style.cssText = '';
      const raw = [];
      for (const prop of PAD) { const v = style.getPropertyValue(prop); if (v) { probe.style.setProperty(prop, v); raw.push(v); } }
      if (raw.length && !/clamp\(|vw|vh|%/.test(raw.join(' '))) {
        const cs = getComputedStyle(probe);
        out.pads = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px);
      }
      const radiusRaw = style.getPropertyValue('border-radius');
      if (radiusRaw) {
        probe.style.cssText = '';
        probe.style.setProperty('border-radius', radiusRaw);
        const cs = getComputedStyle(probe);
        out.radius = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius].map(px);
      }
      probe.style.cssText = '';
      return out;
    };

    const categoryHits = { 'table cell': 0, button: 0, card: 0, badge: 0 };
    const offenders = [];
    let targetRules = 0;
    for (const rule of rules) {
      const cats = CATEGORIES.filter((c) => c.test(rule.sel)).map((c) => c.name);
      if (!cats.length) continue;
      targetRules += 1;
      for (const c of cats) categoryHits[c] += 1;
      const m = measure(rule.style);
      if (m.pads) for (const n of m.pads) if (n !== null && n !== 0 && !space.has(n)) offenders.push(`${rule.sel} padding ${n}px`);
      if (m.radius) for (const n of m.radius) if (n !== null && n !== 0 && !radius.has(n)) offenders.push(`${rule.sel} radius ${n}px`);
    }
    const requiredMissing = REQUIRED.filter((need) => !rules.some((r) => r.sel.indexOf(need) !== -1));
    probe.remove();
    return {
      space: [...space].sort((a, b) => a - b),
      radius: [...radius].sort((a, b) => a - b),
      scannedRules: rules.length,
      targetRules,
      categoryHits,
      requiredMissing,
      offenderCount: offenders.length,
      offenders: offenders.slice(0, 80),
    };
  });
  await ctx.close();
  if (data.requiredMissing.length) throw new Error(`selector filter reached nothing for: ${data.requiredMissing.join(', ')}`);
  if (Object.values(data.categoryHits).some((n) => n === 0)) throw new Error(`category filter matched no rules: ${JSON.stringify(data.categoryHits)}`);
  if (data.offenderCount) throw new Error(`${data.offenderCount} off-space value(s) on cards/buttons/cells/badges: ${data.offenders.join(' | ')}`);
  return data;
});

/* â”€â”€ UC / primitive harness scenarios â”€â”€ */
await scenario('UC.qualification-bands', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#league-new .league-table');
  const rows = await page.evaluate(() => {
    const out = [];
    for (const tr of document.querySelectorAll('#league-new .league-table tbody tr')) {
      const posCell = tr.querySelector('td');
      const mark = posCell?.querySelector('.band-mark')?.textContent.trim() || null;
      const sr = posCell?.querySelector('.sr-only')?.textContent.trim() || null;
      out.push({ cls: tr.className, pos: posCell?.textContent.replace(/[^0-9]/g, '').slice(0, 3), mark, sr });
    }
    return out;
  });
  await ctx.close();
  const at = (n) => rows.find((r) => r.pos === String(n));
  const q = at(1); const p = at(9); const e = at(30);
  const ok = q && /row-qualified/.test(q.cls) && q.mark && q.sr === 'Qualified' && p && /row-playoffs/.test(p.cls) && p.mark && p.sr === 'Playoffs' && e && /row-eliminated/.test(e.cls) && e.mark && e.sr === 'Eliminated';
  if (!ok) throw new Error(`bands/markers wrong ${JSON.stringify({ q, p, e })}`);
  return { row1: q, row9: p, row30: e };
});

await scenario('UC.button-state-coverage', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#buttons .button');
  const read = async (sel) => page.evaluate((s) => { const cs = getComputedStyle(document.querySelector(s)); return { bg: cs.backgroundColor, shadow: cs.boxShadow, border: cs.borderTopColor, transform: cs.transform, outline: cs.outlineStyle, cursor: cs.cursor }; }, sel);
  const variants = {};
  for (const v of ['primary', 'secondary', 'ghost', 'danger']) {
    const sel = `#buttons .button.${v}`;
    const base = await read(sel);
    await page.hover(sel);
    await page.waitForTimeout(150);
    const hover = await read(sel);
    await page.mouse.down();
    const active = await read(sel);
    await page.mouse.up();
    const responds = base.bg !== hover.bg || base.shadow !== hover.shadow || base.border !== hover.border || base.transform !== active.transform;
    variants[v] = { base, hover, active, responds };
  }
  const disabled = await read('#buttons .button[disabled]');
  const disabledProps = await page.evaluate(() => { const b = document.querySelector('#buttons .button[disabled]'); return { disabled: b.disabled, outline: getComputedStyle(b).outlineStyle, cursor: getComputedStyle(b).cursor }; });
  await ctx.close();
  const ok = variants.primary.responds && variants.secondary.responds && variants.ghost.responds && variants.danger.responds && disabledProps.disabled && disabledProps.outline === 'dashed' && disabledProps.cursor === 'not-allowed';
  if (!ok) throw new Error(`button states incomplete ${JSON.stringify({ variants, disabledProps })}`);
  return { variants, disabledProps };
});

await scenario('UC.primitive-stays-presentational', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const apiCalls = [];
  const page = await ctx.newPage();
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const rendered = await page.evaluate(() => ({ tables: document.querySelectorAll('.league-table, .standings-table, .sidebar-table').length, crests: document.querySelectorAll('.team-logo').length, buttons: document.querySelectorAll('.button').length }));
  await ctx.close();
  const ok = apiCalls.length === 0 && rendered.tables > 0 && rendered.crests > 0;
  if (!ok) throw new Error(`primitive made a network call or did not render ${JSON.stringify({ apiCalls, rendered })}`);
  return { apiCalls, rendered };
});

await scenario('UC.skeleton-layout-note', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(HARNESS_URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#states-layout-fixture-box');
  const before = await page.evaluate(() => Math.round(document.querySelector('#states-layout-fixture-box').getBoundingClientRect().height));
  await page.evaluate(() => document.querySelector('#states-layout-fixture-toggle')?.click());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => Math.round(document.querySelector('#states-layout-fixture-box').getBoundingClientRect().height));
  await ctx.close();
  // Informational: the fixture skeleton reserves height so nothing jumps from
  // zero. Exact pixel parity with the settled rows is a design decision tracked
  // as a residual warning, not a pass/fail gate here.
  return { skeletonHeight: before, settledHeight: after, delta: Math.abs(before - after) };
});

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ teardown â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
await new Promise((r) => harnessServer.close(r));
await browser.close();
report.finishedAt = new Date().toISOString();
report.summary = { total: Object.keys(report.scenarios).length, pass: Object.values(report.scenarios).filter((s) => s.status === 'pass').length, fail: Object.values(report.scenarios).filter((s) => s.status === 'fail').length };
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\n${report.summary.pass}/${report.summary.total} scenarios pass. Wrote ${OUT}`);
process.exit(report.summary.fail ? 1 : 0);
