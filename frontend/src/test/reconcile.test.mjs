import assert from 'node:assert/strict';
import test from 'node:test';

import { compareStandings, comparePlayoffs, compareKnockout } from '../lib/reconcile.js';

/* Task 6.1 — RED first. These tests describe the semantic comparison contract:
   same data in a different order/form must be equal; a real value divergence or
   a row present on one side only must be reported with both values. */

const team = (id, name, short_name = name) => ({ id, name, short_name });

function clientStanding(o = {}) {
  return {
    team_id: 1,
    position: 1,
    played: 6,
    wins: 5,
    draws: 0,
    losses: 1,
    goals_for: 14,
    goals_against: 5,
    goal_diff: 9,
    points: 15,
    team: team(1, 'FC Bayern'),
    ...o,
  };
}

function serverStanding(o = {}) {
  return {
    team_id: 1,
    name: 'FC Bayern',
    short_name: 'Bayern',
    position: 1,
    played: 6,
    wins: 5,
    draws: 0,
    losses: 1,
    goals_for: 14,
    goals_against: 5,
    goal_diff: 9,
    points: 15,
    ...o,
  };
}

function clientTie(o = {}) {
  return {
    matchup_index: 1,
    home_team: team(9, 'Atalanta'),
    away_team: team(24, 'Celtic'),
    leg1_home_goals: 2,
    leg1_away_goals: 1,
    leg2_home_goals: 1,
    leg2_away_goals: 1,
    extra_time: false,
    penalties: false,
    et_home_goals: null,
    et_away_goals: null,
    pen_home_goals: null,
    pen_away_goals: null,
    winner: team(9, 'Atalanta'),
    ...o,
  };
}

function serverTie(o = {}) {
  return {
    matchup_index: 1,
    home_team: { team_id: 9, name: 'Atalanta' },
    away_team: { team_id: 24, name: 'Celtic' },
    leg1_home_goals: 2,
    leg1_away_goals: 1,
    leg2_home_goals: 1,
    leg2_away_goals: 1,
    extra_time: false,
    penalties: false,
    et_home_goals: null,
    et_away_goals: null,
    pen_home_goals: null,
    pen_away_goals: null,
    winner: { team_id: 9, name: 'Atalanta' },
    ...o,
  };
}

function koMatch(round, bp, o = {}) {
  return {
    round,
    bracket_position: bp,
    home_team: team(1, 'Arsenal'),
    away_team: team(16, 'Porto'),
    home_goals: 2,
    away_goals: 0,
    winner: team(1, 'Arsenal'),
    ...o,
  };
}

test('standings: reordered rows are not a mismatch', () => {
  const client = [
    clientStanding({ team_id: 1 }),
    clientStanding({ team_id: 2, position: 2, points: 12, goal_diff: 4, team: team(2, 'Real Madrid') }),
    clientStanding({ team_id: 3, position: 3, points: 9, goal_diff: 1, team: team(3, 'Paris SG') }),
  ];
  const server = [
    serverStanding({ team_id: 3, name: 'Paris SG', position: 3, points: 9, goal_diff: 1 }),
    serverStanding({ team_id: 1 }),
    serverStanding({ team_id: 2, name: 'Real Madrid', position: 2, points: 12, goal_diff: 4 }),
  ];
  const res = compareStandings(client, server);
  assert.equal(res.ok, true);
  assert.deepEqual(res.mismatches, []);
});

test('standings: a changed points total and a shifted position are mismatches', () => {
  const client = [
    clientStanding({ team_id: 1 }),
    clientStanding({ team_id: 2, position: 2, points: 12, team: team(2, 'Real Madrid') }),
  ];
  const server = [
    serverStanding({ team_id: 1, points: 13, position: 2 }),
    serverStanding({ team_id: 2, name: 'Real Madrid', position: 3, points: 12 }),
  ];
  const res = compareStandings(client, server);
  assert.equal(res.ok, false);
  const keys = res.mismatches.map((m) => m.key);
  assert.ok(keys.includes('1'), `expected a mismatch for team 1, got ${JSON.stringify(keys)}`);
  assert.ok(keys.includes('2'), `expected a mismatch for team 2, got ${JSON.stringify(keys)}`);
  const changed = res.mismatches.find((m) => m.key === '1');
  assert.equal(changed.clientValue.points, 15);
  assert.equal(changed.serverValue.points, 13);
});

test('standings: a row present on one side only is a mismatch', () => {
  const client = [
    clientStanding({ team_id: 1 }),
    clientStanding({ team_id: 4, position: 4, team: team(4, 'Inter') }),
  ];
  const server = [serverStanding({ team_id: 1 })];
  const res = compareStandings(client, server);
  assert.equal(res.ok, false);
  const onlyClient = res.mismatches.find((m) => m.key === '4');
  assert.ok(onlyClient, 'expected team 4 to be reported');
  assert.equal(onlyClient.serverValue, null);
  assert.notEqual(onlyClient.clientValue, null);
});

test('standings: a server-only row is a mismatch too', () => {
  const client = [clientStanding({ team_id: 1 })];
  const server = [
    serverStanding({ team_id: 1 }),
    serverStanding({ team_id: 8, name: 'Ajax', position: 8, points: 7 }),
  ];
  const res = compareStandings(client, server);
  assert.equal(res.ok, false);
  const onlyServer = res.mismatches.find((m) => m.key === '8');
  assert.ok(onlyServer, 'expected team 8 to be reported');
  assert.equal(onlyServer.clientValue, null);
  assert.notEqual(onlyServer.serverValue, null);
});

test('standings: numeric strings, whitespace and club-name drift normalize to equal', () => {
  const client = [
    clientStanding({
      team_id: 7,
      position: 7,
      played: 6,
      wins: 2,
      draws: 2,
      losses: 2,
      goals_for: 6,
      goals_against: 6,
      goal_diff: 0,
      points: 8,
      team: team(7, 'Bayern'),
    }),
  ];
  const server = [
    serverStanding({
      team_id: 7,
      name: ' FC Bayern ',
      short_name: 'Bayern',
      position: '7',
      played: '6',
      wins: '2',
      draws: '2',
      losses: '2',
      goals_for: '6',
      goals_against: '6',
      goal_diff: '0',
      points: '8',
    }),
  ];
  const res = compareStandings(client, server);
  assert.equal(res.ok, true, JSON.stringify(res.mismatches));
  assert.deepEqual(res.mismatches, []);
});

test('playoffs: reordered ties are not a mismatch', () => {
  const client = [
    clientTie({ matchup_index: 1 }),
    clientTie({
      matchup_index: 2,
      home_team: team(10, 'Leverkusen'),
      away_team: team(23, 'Benfica'),
      winner: team(10, 'Leverkusen'),
    }),
  ];
  const server = [
    serverTie({
      matchup_index: 2,
      home_team: { team_id: 10, name: 'Leverkusen' },
      away_team: { team_id: 23, name: 'Benfica' },
      winner: { team_id: 10, name: 'Leverkusen' },
    }),
    serverTie({ matchup_index: 1 }),
  ];
  const res = comparePlayoffs(client, server);
  assert.equal(res.ok, true, JSON.stringify(res.mismatches));
  assert.deepEqual(res.mismatches, []);
});

test('playoffs: a changed winner is a mismatch keyed by the tie pair', () => {
  const client = [clientTie()];
  const server = [serverTie({ winner: { team_id: 24, name: 'Celtic' } })];
  const res = comparePlayoffs(client, server);
  assert.equal(res.ok, false);
  assert.equal(res.mismatches[0].key, '9-24');
  assert.equal(res.mismatches[0].clientValue.winner, '9');
  assert.equal(res.mismatches[0].serverValue.winner, '24');
});

test('playoffs: a tie present on one side only is a mismatch', () => {
  const client = [clientTie()];
  const server = [];
  const res = comparePlayoffs(client, server);
  assert.equal(res.ok, false);
  assert.equal(res.mismatches[0].key, '9-24');
  assert.equal(res.mismatches[0].serverValue, null);
});

test('knockout: reordered rounds and slots are not a mismatch', () => {
  const client = {
    R16: [koMatch('R16', 1), koMatch('R16', 2, { home_team: team(2, 'Barcelona'), away_team: team(15, 'Sporting') })],
    QF: [koMatch('QF', 1)],
    SF: [koMatch('SF', 1)],
    F: [koMatch('F', 1)],
  };
  const server = {
    F: [koMatch('F', 1)],
    SF: [koMatch('SF', 1)],
    QF: [koMatch('QF', 1)],
    R16: [koMatch('R16', 2, { home_team: team(2, 'Barcelona'), away_team: team(15, 'Sporting') }), koMatch('R16', 1)],
  };
  const res = compareKnockout(client, server);
  assert.equal(res.ok, true, JSON.stringify(res.mismatches));
  assert.deepEqual(res.mismatches, []);
});

test('knockout: a changed score in one slot is a mismatch keyed by round + slot', () => {
  const client = { R16: [koMatch('R16', 1)], QF: [], SF: [], F: [] };
  const server = { R16: [koMatch('R16', 1, { home_goals: 1 })], QF: [], SF: [], F: [] };
  const res = compareKnockout(client, server);
  assert.equal(res.ok, false);
  assert.equal(res.mismatches[0].key, 'R16#1');
  assert.equal(res.mismatches[0].clientValue.home_goals, 2);
  assert.equal(res.mismatches[0].serverValue.home_goals, 1);
});

test('knockout: a missing slot is a mismatch', () => {
  const client = { R16: [koMatch('R16', 1)], QF: [], SF: [], F: [] };
  const server = { R16: [], QF: [], SF: [], F: [] };
  const res = compareKnockout(client, server);
  assert.equal(res.ok, false);
  assert.equal(res.mismatches[0].key, 'R16#1');
  assert.equal(res.mismatches[0].serverValue, null);
});
