import assert from 'node:assert/strict';
import test from 'node:test';
import { selectOfficialSeasonId, selectSimulatorSeasonId, simulatorSeasons } from '../lib/seasonSelection.js';

const eligible = { competition: 'UCL', pot_count: 4, teams_per_pot: 9, total_matches: 8 };
const seasons = [
  { ...eligible, id: 6, competition: 'FRN' },
  { id: 5, competition: 'SUD', pot_count: 4, teams_per_pot: 8, total_matches: 6 },
  { ...eligible, id: 4, total_matches: 6 },
  { ...eligible, id: 3 },
  { ...eligible, id: 2, is_active: true },
];

test('the simulator offers only compatible Champions League seasons', () => {
  assert.deepEqual(simulatorSeasons(seasons).map(({ id }) => id), [3, 2]);
  assert.equal(selectSimulatorSeasonId(seasons, '5'), '2');
  assert.equal(selectSimulatorSeasonId(seasons, '3'), '3');
  assert.equal(selectSimulatorSeasonId(seasons.slice(0, 3), '5'), '');
});

test('the official view keeps its independently selected competition', () => {
  assert.equal(selectOfficialSeasonId(seasons, ''), '2');
  assert.equal(selectOfficialSeasonId(seasons, '5'), '5');
  assert.equal(selectOfficialSeasonId(seasons.slice(0, 2), '6'), '5');
});
