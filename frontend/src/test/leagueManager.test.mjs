import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchdaySections, parseScore, parseTeamList } from '../lib/leagueManager.js';

test('a five-team matchday exposes the absent team as its bye', () => {
  const teams = [1, 2, 3, 4, 5].map((id) => ({ id, name: `Team ${id}` }));
  const fixtures = [
    { id: 2, matchday: 2, home_team_id: 1, away_team_id: 3 },
    { id: 3, matchday: 2, home_team_id: 2, away_team_id: 5 },
    { id: 1, matchday: 1, home_team_id: 1, away_team_id: 2 },
    { id: 4, matchday: 1, home_team_id: 3, away_team_id: 4 },
  ];
  assert.deepEqual(matchdaySections(teams, fixtures), [
    { number: 1, fixtures: fixtures.slice(2), bye: teams[4] },
    { number: 2, fixtures: fixtures.slice(0, 2), bye: teams[3] },
  ]);
  assert.equal(matchdaySections(teams.slice(0, 4), fixtures.slice(2))[0].bye, undefined);
});

test('a score distinguishes zero from a missing goal', () => {
  assert.deepEqual(parseScore('0', '0'), { home_goals: 0, away_goals: 0 });
  assert.deepEqual(parseScore('999', '1'), { home_goals: 999, away_goals: 1 });
  for (const invalid of ['', '1000', '-1', '1.5', '1e2']) assert.equal(parseScore(invalid, '0'), null);
});

test('team entry trims one team per line and flags duplicate and invalid counts', () => {
  assert.deepEqual(parseTeamList(' Club A\r\n Club B \r\n '), { names: ['Club A', 'Club B'] });
  assert.equal(parseTeamList('Club A\n club a').error, 'duplicateTeams');
  assert.equal(parseTeamList('Club A').error, 'teamCount');
  assert.equal(parseTeamList(Array.from({ length: 37 }, (_, index) => `Team ${index}`).join('\n')).error, 'teamCount');
});
