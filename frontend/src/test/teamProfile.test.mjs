import assert from 'node:assert/strict';
import test from 'node:test';

import { groupSquad, buildLeaderboards, SQUAD_GROUP_ORDER } from '../lib/teamProfile.js';

/* The Spanish source string is escaped so this test file stays ASCII. */
const DIRECCION = 'Direcci\u00f3n';

test('groupSquad returns [] for empty or missing input', () => {
  assert.deepEqual(groupSquad([]), []);
  assert.deepEqual(groupSquad(undefined), []);
});

test('groupSquad orders known groups and keeps player order inside a group', () => {
  const squad = [
    { name: 'Forward 1', group: 'Delanteros' },
    { name: 'Keeper 1', group: 'Arqueros' },
    { name: 'Forward 2', group: 'Delanteros' },
    { name: 'Mid 1', group: 'Mediocampistas' },
  ];
  const grouped = groupSquad(squad);
  assert.deepEqual(grouped.map((g) => g.group), ['Arqueros', 'Mediocampistas', 'Delanteros']);
  assert.deepEqual(grouped[2].players.map((p) => p.name), ['Forward 1', 'Forward 2']);
});

test('groupSquad places unknown groups last, sorted alphabetically', () => {
  const squad = [
    { name: 'X', group: 'Zebras' },
    { name: 'Y', group: 'Analytics' },
    { name: 'Z', group: 'Defensores' },
  ];
  assert.deepEqual(groupSquad(squad).map((g) => g.group), ['Defensores', 'Analytics', 'Zebras']);
});

test('groupSquad uses the full known order including Direccion', () => {
  const squad = SQUAD_GROUP_ORDER.map((group, i) => ({ name: `P${i}`, group })).reverse();
  assert.deepEqual(groupSquad(squad).map((g) => g.group), SQUAD_GROUP_ORDER);
  assert.ok(SQUAD_GROUP_ORDER.includes(DIRECCION));
});

test('buildLeaderboards returns [] for empty input', () => {
  assert.deepEqual(buildLeaderboards([]), []);
});

test('buildLeaderboards groups by competition then metric and sorts rows by rank', () => {
  const rows = [
    { competition: 'Brasileirao', metric: 'Goles', rank: 2, player_name: 'B' },
    { competition: 'Brasileirao', metric: 'Goles', rank: 1, player_name: 'A' },
    { competition: 'Brasileirao', metric: 'Asistencias', rank: 1, player_name: 'C' },
    { competition: 'Libertadores', metric: 'Goles', rank: 1, player_name: 'D' },
  ];
  const boards = buildLeaderboards(rows);
  assert.deepEqual(boards.map((b) => b.competition), ['Brasileirao', 'Libertadores']);
  assert.deepEqual(boards[0].metrics.map((m) => m.metric), ['Goles', 'Asistencias']);
  assert.deepEqual(boards[0].metrics[0].rows.map((r) => r.player_name), ['A', 'B']);
  assert.deepEqual(boards[0].metrics[1].rows.map((r) => r.player_name), ['C']);
  assert.deepEqual(boards[1].metrics.map((m) => m.metric), ['Goles']);
});
