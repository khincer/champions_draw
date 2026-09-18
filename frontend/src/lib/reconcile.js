/* Pure, network-free semantic comparison of client-computed predictions against
   the read-only confirmation endpoints (task 6.2, spec PR:read-only-semantic-compare,
   PR:client-source-of-truth).

   No fetch, no storage, no timers, no app-state imports: every function takes and
   returns plain data. Order and formatting are normalized before comparison so
   reordered-but-equal is never reported. */

import { normTeamName } from './teams.js';

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/* Identity of a team reference, whatever shape the caller passes: a raw team
   object (`id`), a standings row (`team_id`), or a bare id. Falls back to the
   normalized club name when no id is available. */
function teamRef(team) {
  if (team === null || team === undefined) return null;
  if (typeof team === 'number' || typeof team === 'string') return String(team);
  const id = team.id ?? team.team_id;
  if (id !== null && id !== undefined) return String(id);
  return normTeamName(team.name || team.short_name || '') || null;
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* Generic order-insensitive comparison: map both sides by key, report a key
   that is missing on one side or whose normalized value differs. */
function compareByKey(clientRows, serverRows, keyOf, valueOf) {
  const clientMap = new Map();
  for (const row of clientRows || []) {
    const key = keyOf(row);
    if (key != null) clientMap.set(key, valueOf(row));
  }
  const serverMap = new Map();
  for (const row of serverRows || []) {
    const key = keyOf(row);
    if (key != null) serverMap.set(key, valueOf(row));
  }

  const mismatches = [];
  for (const [key, clientValue] of clientMap) {
    if (!serverMap.has(key)) {
      mismatches.push({ key, clientValue, serverValue: null });
      continue;
    }
    const serverValue = serverMap.get(key);
    if (!sameValue(clientValue, serverValue)) {
      mismatches.push({ key, clientValue, serverValue });
    }
  }
  for (const [key, serverValue] of serverMap) {
    if (!clientMap.has(key)) mismatches.push({ key, clientValue: null, serverValue });
  }

  return { ok: mismatches.length === 0, mismatches };
}

/* Standings — key: team id. */
function standingsKey(row) {
  const id = row?.team_id ?? row?.team?.id ?? row?.id;
  if (id !== null && id !== undefined) return String(id);
  const name = normTeamName(row?.name || row?.team?.name || '');
  return name ? `name:${name}` : null;
}

function standingsValue(row) {
  return {
    name: normTeamName(row?.name || row?.team?.name || ''),
    position: num(row?.position),
    played: num(row?.played),
    wins: num(row?.wins),
    draws: num(row?.draws),
    losses: num(row?.losses),
    goals_for: num(row?.goals_for),
    goals_against: num(row?.goals_against),
    goal_diff: num(row?.goal_diff),
    points: num(row?.points),
  };
}

export function compareStandings(client, server) {
  return compareByKey(client, server, standingsKey, standingsValue);
}

/* Playoffs — key: the tie pair (the two team ids, order-insensitive). */
function tieKey(row) {
  const home = teamRef(row?.home_team);
  const away = teamRef(row?.away_team);
  if (home && away) {
    const [a, b] = [home, away].sort((x, y) => (Number(x) - Number(y)) || x.localeCompare(y));
    return `${a}-${b}`;
  }
  return row?.matchup_index != null ? `tie#${row.matchup_index}` : null;
}

function playoffValue(row) {
  return {
    home: teamRef(row?.home_team),
    away: teamRef(row?.away_team),
    winner: teamRef(row?.winner),
    leg1_home_goals: num(row?.leg1_home_goals),
    leg1_away_goals: num(row?.leg1_away_goals),
    leg2_home_goals: num(row?.leg2_home_goals),
    leg2_away_goals: num(row?.leg2_away_goals),
    et_home_goals: num(row?.et_home_goals),
    et_away_goals: num(row?.et_away_goals),
    pen_home_goals: num(row?.pen_home_goals),
    pen_away_goals: num(row?.pen_away_goals),
  };
}

export function comparePlayoffs(client, server) {
  return compareByKey(client, server, tieKey, playoffValue);
}

/* Knockout — key: round + bracket slot. Both sides return an object of
   round -> matches, so flatten in a fixed round order. */
const KNOCKOUT_ROUNDS = ['R16', 'QF', 'SF', 'F'];

function knockoutRows(rounds) {
  const rows = [];
  for (const round of KNOCKOUT_ROUNDS) {
    for (const match of rounds?.[round] || []) {
      rows.push({ ...match, round: match.round || round });
    }
  }
  return rows;
}

function knockoutKey(match) {
  const round = match?.round;
  const slot = match?.bracket_position;
  return round != null && slot != null ? `${round}#${slot}` : null;
}

function knockoutValue(match) {
  return {
    home: teamRef(match?.home_team),
    away: teamRef(match?.away_team),
    home_goals: num(match?.home_goals),
    away_goals: num(match?.away_goals),
    winner: teamRef(match?.winner),
  };
}

export function compareKnockout(client, server) {
  return compareByKey(knockoutRows(client), knockoutRows(server), knockoutKey, knockoutValue);
}
