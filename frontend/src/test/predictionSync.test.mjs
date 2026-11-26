import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatchSyncRows, syncLeaguePicks } from '../lib/predictionSync.js';

test('manual and automatic sync send an explicit clear without treating zero as empty', () => {
  const predictions = {
    1: { home_goals: null, away_goals: null },
    2: { home_goals: 0, away_goals: 0 },
    3: { home_goals: 1 },
  };
  const expected = [
    { matchup: 1, home_goals: null, away_goals: null },
    { matchup: 2, home_goals: 0, away_goals: 0 },
  ];
  assert.deepEqual(buildMatchSyncRows(predictions, { completeOnly: true }), expected);
  assert.deepEqual(buildMatchSyncRows(predictions), [
    ...expected,
    { matchup: 3, home_goals: 1, away_goals: null },
  ]);
});

test('a rejected batch only retries ids that are still eligible', async () => {
  const sent = [];
  const unavailable = [];
  const error = Object.assign(new Error('closed'), { status: 400, payload: { closed: [1] } });
  const results = await syncLeaguePicks(async (rows) => {
    sent.push(rows.map(({ match_id }) => match_id));
    if (sent.length === 1) throw error;
  }, { 1: { home_goals: 1, away_goals: 0 }, 2: { home_goals: 2, away_goals: 1 } }, (ids) => unavailable.push(...ids));
  assert.deepEqual(sent, [[1, 2], [2]]);
  assert.deepEqual(unavailable, ['1']);
  assert.deepEqual(results, ['2']);
});

test('an unrecognized 400 is surfaced without retrying the batch', async () => {
  const error = Object.assign(new Error('invalid goals'), { status: 400, payload: {} });
  let sends = 0;
  await assert.rejects(syncLeaguePicks(async () => {
    sends++;
    throw error;
  }, { 1: { home_goals: 1 } }, () => assert.fail('must not mark the fixture unavailable')), error);
  assert.equal(sends, 1);
});

test('successive rejections must identify a new fixture to permit another retry', async () => {
  const error = Object.assign(new Error('not scheduled'), { status: 400, payload: { unscheduled: [1] } });
  let sends = 0;
  await assert.rejects(syncLeaguePicks(async () => {
    sends++;
    throw error;
  }, { 1: { home_goals: 1 }, 2: { home_goals: 0 } }, () => {}), error);
  assert.equal(sends, 2);
});
