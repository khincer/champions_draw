// Renders one matchday's real-fixture predictions as a PNG via a plain <canvas>
// (no external dependencies). Badges only: each team is drawn as a 24x24 logo
// (initials placeholder if the logo fails to load — no CORS headers, dead URL —
// so the canvas stays untainted and toBlob keeps working). The winning team's
// badge gets a blue ring (draw = no ring). Rendered at 2x for retina screens.
//
// `fixtures` is the array of fixtures for ONE matchday; each fixture may carry a
// `prediction` ({home_goals, away_goals}) that is shown when the fixture has no
// real `result` yet.

const SCALE = 2;
const WIDTH = 720;
const PAD = 32;
const ROW_H = 36;
const LOGO = 24;

// The canvas needs resolved colours at draw time (a CSS variable is not a valid
// fillStyle), so read them from the live theme tokens after the theme is applied.
function readPalette() {
  const styles = getComputedStyle(document.documentElement);
  const value = (name) => styles.getPropertyValue(name).trim();
  return {
    ink: value('--ink'),
    muted: value('--muted'),
    line: value('--line'),
    blue: value('--blue'),
    softBlue: value('--soft-blue'),
    surface: value('--surface'),
  };
}

const logoCache = new Map();

function loadLogo(url) {
  if (logoCache.has(url)) return Promise.resolve(logoCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      logoCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => {
      logoCache.set(url, null);
      resolve(null);
    };
    img.src = url;
  });
}

function fixtGoals(src) {
  if (!src) return [null, null];
  const h = Number(src.home_goals);
  const a = Number(src.away_goals);
  return [Number.isFinite(h) ? h : null, Number.isFinite(a) ? a : null];
}

function fixtureScore(fixture) {
  const [rh, ra] = fixtGoals(fixture.result);
  if (rh != null && ra != null) return [rh, ra];
  const [ph, pa] = fixtGoals(fixture.prediction);
  if (ph != null && pa != null) return [ph, pa];
  return [null, null];
}

function kickoffTime(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

// Draw a 24x24 badge (logo image or initials placeholder) at (x, y) center.
// A winning team's badge gets a blue ring.
function drawBadge(ctx, team, x, y, isWinner, palette) {
  const img = team?.logo_url ? logoCache.get(team.logo_url) : null;
  const cx = x - LOGO / 2;
  const cy = y - LOGO / 2;
  if (img) {
    ctx.drawImage(img, cx, cy, LOGO, LOGO);
  } else {
    // Filled circle placeholder behind initials.
    ctx.fillStyle = palette.softBlue;
    ctx.beginPath();
    ctx.arc(x, y, LOGO / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.blue;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '800 9px Inter, ui-sans-serif, system-ui, sans-serif';
    ctx.fillText((team?.short_name || team?.name || '?').slice(0, 3), x, y + 0.5);
  }
  if (isWinner) {
    ctx.strokeStyle = palette.blue;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, LOGO / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
}

const KICKOFF_W = 56;
const SCORE_W = 72;

function drawFixtureRow(ctx, fixture, y, palette) {
  const home = fixture.home_team;
  const away = fixture.away_team;
  const [hg, ag] = fixtureScore(fixture);
  const midY = y + ROW_H / 2;
  const baseX = PAD;

  // Kickoff, muted, left.
  ctx.font = '600 12px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = palette.muted;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(kickoffTime(fixture.kickoff), baseX, midY);

  // Winner determination for this fixture.
  let winner = null; // null | 'home' | 'away'
  if (hg != null && ag != null) {
    if (hg > ag) winner = 'home';
    else if (ag > hg) winner = 'away';
  }

  // Badges only: home on the left of the score, away on the right.
  drawBadge(ctx, home, baseX + KICKOFF_W + LOGO / 2, midY, winner === 'home', palette);
  drawBadge(ctx, away, baseX + KICKOFF_W + LOGO + SCORE_W + LOGO / 2, midY, winner === 'away', palette);

  // Score, centered between the badges, bold.
  ctx.font = '800 15px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.ink;
  const scoreTxt = hg != null && ag != null ? `${hg}–${ag}` : '–';
  ctx.fillText(scoreTxt, baseX + KICKOFF_W + LOGO + SCORE_W / 2, midY);
}

function measureHeight(fixtures) {
  let h = PAD + 30 + 8 + 22 + 28; // top padding + title + subtitle + gap
  h += fixtures.length * ROW_H; // fixture rows
  h += 30 + 16; // footer
  return h;
}

export async function buildPredictionsImage({ playerName, matchday = 1, fixtures = [], seasonName = '' }) {
  // Pre-load unique logo urls first; never call toBlob until these resolve.
  const urls = Array.from(new Set(
    fixtures.flatMap((f) => [f.home_team?.logo_url, f.away_team?.logo_url]).filter(Boolean),
  ));
  await Promise.all(urls.map(loadLogo));

  const height = measureHeight(fixtures);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(SCALE, SCALE);

  const palette = readPalette();

  ctx.fillStyle = palette.surface;
  ctx.fillRect(0, 0, WIDTH, height);

  // Divider line under the title block.
  ctx.fillStyle = palette.line;
  ctx.fillRect(PAD, PAD + 62, WIDTH - PAD * 2, 1);

  let y = PAD + 26;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '800 22px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = palette.ink;
  const title = seasonName ? `UCL League Phase ${seasonName}` : 'UCL League Phase';
  ctx.fillText(title, PAD, y);

  y += 8 + 19;
  ctx.font = '600 13px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = palette.muted;
  ctx.fillText(`Matchday ${matchday} — Predictions · ${playerName || 'Guest'}`, PAD, y);

  y = PAD + 62 + 26;
  for (const fixture of fixtures) {
    drawFixtureRow(ctx, fixture, y, palette);
    y += ROW_H;
  }

  y += 22;
  ctx.textAlign = 'left';
  ctx.font = '600 11px Inter, ui-sans-serif, system-ui, sans-serif';
  ctx.fillStyle = palette.muted;
  ctx.fillText('Made with the Champions Draw prediction game.', PAD, y);

  return canvas;
}
