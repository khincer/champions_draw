export function computeStandings(teams, matchPredictions) {
  const stats = {};
  for (const t of teams) {
    stats[t.id] = {
      team_id: t.id,
      team: t,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_diff: 0,
      points: 0,
    };
  }

  for (const key of Object.keys(matchPredictions)) {
    const mp = matchPredictions[key];
    const hg = mp.home_goals;
    const ag = mp.away_goals;
    const homeId = mp.home_team_id || mp.home_team?.id;
    const awayId = mp.away_team_id || mp.away_team?.id;

    if (hg == null || ag == null) continue;
    if (!stats[homeId] || !stats[awayId]) continue;

    stats[homeId].played += 1;
    stats[awayId].played += 1;
    stats[homeId].goals_for += hg;
    stats[homeId].goals_against += ag;
    stats[awayId].goals_for += ag;
    stats[awayId].goals_against += hg;

    if (hg > ag) {
      stats[homeId].wins += 1;
      stats[homeId].points += 3;
      stats[awayId].losses += 1;
    } else if (hg < ag) {
      stats[awayId].wins += 1;
      stats[awayId].points += 3;
      stats[homeId].losses += 1;
    } else {
      stats[homeId].draws += 1;
      stats[homeId].points += 1;
      stats[awayId].draws += 1;
      stats[awayId].points += 1;
    }
  }

  const rows = Object.values(stats);
  for (const row of rows) {
    row.goal_diff = row.goals_for - row.goals_against;
  }

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    return b.wins - a.wins;
  });

  rows.forEach((row, i) => { row.position = i + 1; });
  return rows;
}

export function getPlayoffTeams(standings) {
  return standings.filter(s => s.position >= 9 && s.position <= 24);
}

export function getTop8(standings) {
  return standings.filter(s => s.position <= 8);
}

// Real UEFA association coefficient ranking (2024-25 final, the values that
// decided 2026-27 spot allocation), normalized to England = 1.0. This keeps
// the top/bottom spread (~5x) instead of the old flat hand-coded tiers (~2.2x),
// so a mid-table Como (Serie A) clearly outranks Shakhtar (Ukraine) and AEK
// stops trading blows with Bayern. Unlisted associations are minnows -> 0.15.
export const LEAGUE_TIER = {
  ENG: 1.000, ITA: 0.879, ESP: 0.840, GER: 0.772, FRA: 0.699,
  POR: 0.624, NED: 0.598, BEL: 0.507, CZE: 0.466, TUR: 0.429,
  GRE: 0.376, AUT: 0.371, SUI: 0.365, SCO: 0.353, CRO: 0.326,
  POL: 0.322, DEN: 0.319, NOR: 0.302, CYP: 0.264, UKR: 0.240,
  ISR: 0.220, SLO: 0.215, SWE: 0.208, AZE: 0.206, SVK: 0.192,
};

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Per-match domestic rates from the synced LeagueStanding block. The defaults
// keep legacy teams (no domestic data) on a neutral attack/defense curve.
export function attackRate(team) {
  return team.domestic?.played > 0 ? team.domestic.goals_for / team.domestic.played : 1.4;
}

export function concedeRate(team) {
  return team.domestic?.played > 0 ? team.domestic.goals_against / team.domestic.played : 1.5;
}

export function attackNorm(team) {
  return clamp(attackRate(team) / 2.1, 0, 1); // 2.1 per match ≈ elite attack
}

export function defenseNorm(team) {
  return clamp((1.9 - concedeRate(team)) / 1.2, 0, 1); // 1.9 conceded/match = terrible -> 0; 0.7 or less ≈ elite -> ~1
}

// ponytail: 50/50 blend of normalized coefficient and real UEFA association
// ranking. Unknown associations fall back to 0.15 (below every ranked league).
// Position refiner reads either the seed's domestic_position or the synced
// domestic block's position.
export function leaguePower(team) {
  const coeff = Number(team.uefa_club_coefficient) || 0;
  const coeffNorm = Math.max(0, Math.min(1, coeff / 130));
  let domestic = LEAGUE_TIER[team.association?.code] ?? 0.15;
  const position = team.domestic_position ?? team.domestic?.position ?? null;
  if (position != null && position > 0) {
    if (position > 8) domestic *= 0.8;
    else if (position > 4) domestic *= 0.9;
  }
  return 0.5 * coeffNorm + 0.5 * domestic;
}

// Teams with a real domestic block blend coefficient/tier (40%) with attack
// and defense form (30% each). Everyone else stays on the legacy curve, so a
// missing synced league (Shakhtar/Qarabag) never distorts the 0..1 band.
export function teamStrength(team) {
  const power = leaguePower(team);
  if (!team.domestic?.played) return power;
  return 0.4 * power + 0.3 * attackNorm(team) + 0.3 * defenseNorm(team);
}

// Small edge for better league-phase finishers, used only for knockout
// randomization. Position 9 -> +0.13, 24 -> +0.008; goal difference nudges ±0.1.
export function eliminationBoost(team, ctx) {
  const { position, goalDiff } = ctx || {};
  return (25 - (position ?? 25)) / 120 + clamp((goalDiff ?? 0) / 80, -0.1, 0.1);
}

// Continuous expected goals for a side, replacing the old discrete
// shift = round(log2(ratio)) buckets that treated any ratio in [0.5, 2) as
// parity. Asymmetric on purpose: the underdog's expectation collapses fast
// (exponent 2) while the favorite's rises mildly (0.35) so mid-gap upsets like
// Dortmund 1-0 Real Madrid or Como 3-1 Barcelona stop firing every randomize.
export function expectedGoals(teamStr, oppStr) {
  const ratio = Math.max(0.25, Math.min(4.0, teamStr / Math.max(oppStr, 0.1)));
  const exponent = ratio < 1 ? 2.0 : 0.35;
  return clamp(1.4 * Math.pow(ratio, exponent), 0.15, 5.5);
}
