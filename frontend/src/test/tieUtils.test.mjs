import assert from 'node:assert/strict';
import test from 'node:test';

import { pairPlayoffTies, computeAgg, formatAggregate } from '../lib/tieUtils.js';

function matchup(overrides = {}) {
  return {
    id: 1,
    home_team: { id: 1, name: 'A' },
    away_team: { id: 2, name: 'B' },
    matchday: null,
    home_goals: null,
    away_goals: null,
    status: 'SCHEDULED',
    kickoff: null,
    ...overrides,
  };
}

test('computeAgg sums leg home/away goals into a {home, away} object', () => {
  assert.deepEqual(computeAgg(2, 1, 2, 2), { home: 4, away: 3 });
});

test('computeAgg returns null when any leg score is missing', () => {
  assert.equal(computeAgg(2, 1, 2, null), null);
  assert.equal(computeAgg(null, 1, 2, 2), null);
});

test('pairPlayoffTies pairs the two directed legs of a tie in kickoff order', () => {
  const leg1 = matchup({
    id: 1,
    kickoff: '2026-09-16T20:00:00Z',
    home_goals: 2, away_goals: 1,
  });
  const leg2 = matchup({
    id: 2,
    home_team: { id: 2, name: 'B' },
    away_team: { id: 1, name: 'A' },
    kickoff: '2026-09-23T20:00:00Z',
    home_goals: 2, away_goals: 2,
  });
  const ties = pairPlayoffTies([leg1, leg2]);
  assert.deepEqual(ties[0].legs.map((leg) => leg.id), [1, 2]);
  assert.deepEqual(ties[0].aggregate, { home: 4, away: 3 });
});

test('a leg with missing kickoff sorts after a leg that has one', () => {
  const withoutKickoff = matchup({ id: 1 });
  const withKickoff = matchup({
    id: 2,
    home_team: { id: 2, name: 'B' },
    away_team: { id: 1, name: 'A' },
    kickoff: '2026-09-16T20:00:00Z',
  });
  const ties = pairPlayoffTies([withoutKickoff, withKickoff]);
  assert.deepEqual(ties[0].legs.map((leg) => leg.id), [2, 1]);
});

test('an unplayed two-leg tie has no aggregate', () => {
  const leg1 = matchup({ id: 1, kickoff: '2026-09-16T20:00:00Z' });
  const leg2 = matchup({
    id: 2,
    home_team: { id: 2, name: 'B' },
    away_team: { id: 1, name: 'A' },
    kickoff: '2026-09-23T20:00:00Z',
  });
  const ties = pairPlayoffTies([leg1, leg2]);
  assert.equal(ties[0].aggregate, null);
});

test('an unpaired leg renders flat with no aggregate (LPV-3 fallback)', () => {
  const lone = matchup({ id: 1, home_goals: 2, away_goals: 1 });
  const ties = pairPlayoffTies([lone]);
  assert.equal(ties.length, 1);
  assert.deepEqual(ties[0].legs, [lone]);
  assert.equal(ties[0].aggregate, null);
});

test('group matchups with a numeric matchday are excluded; explicit null and missing matchday are both playoff ties', () => {
  const groupLeg = matchup({ id: 1, matchday: 4 });
  const explicitNull = matchup({ id: 2 });
  const missingField = matchup({
    id: 3,
    home_team: { id: 3, name: 'C' },
    away_team: { id: 4, name: 'D' },
  });
  delete missingField.matchday;
  const ties = pairPlayoffTies([groupLeg, explicitNull, missingField]);
  assert.deepEqual(ties.map((tie) => tie.legs[0].id).sort(), [2, 3]);
});

/* formatAggregate — LPV-4 "agg X–Y" line rendered from the {home, away}
   object, with the "agg –" placeholder when the tie is unplayed or
   single-legged (aggregate null). */
test('formatAggregate renders the aggregate line from a played tie', () => {
  assert.equal(formatAggregate({ home: 4, away: 3 }), 'agg 4–3');
});

test('formatAggregate renders the placeholder for unplayed or lone-leg ties', () => {
  assert.equal(formatAggregate(null), 'agg –');
});

test('formatAggregate keeps a zero-zero aggregate (placeholder only when null)', () => {
  assert.equal(formatAggregate({ home: 0, away: 0 }), 'agg 0–0');
});