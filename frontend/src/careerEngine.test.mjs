import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCareerChoice,
  createCareer,
  isCareerState,
  summarizeCareer,
} from './careerEngine.mjs';

const countries = [
  ['GB', 'England'],
  ['ES', 'Spain'],
  ['DE', 'Germany'],
  ['IT', 'Italy'],
  ['FR', 'France'],
];

const catalog = Array.from({ length: 30 }, (_, index) => {
  const [countryCode, country] = countries[index % countries.length];
  const tier = index % 3 === 0 ? 2 : 1;
  return {
    id: `club-${index}`,
    name: `Club ${index}`,
    shortName: `C${index}`,
    country,
    countryCode,
    league: tier === 1 ? `${country} League` : `${country} League 2`,
    tier,
    strength: 45 + index,
  };
});

const identity = {
  name: 'Ada',
  number: 10,
  foot: 'right',
  nationality: 'ES',
  position: 'ST',
};

function completeCareer(seed) {
  let career = createCareer(identity, seed, catalog);
  while (career.status === 'active') {
    const transferIds = career.event.options
      .filter((option) => option.kind === 'transfer')
      .map((option) => option.clubId);
    assert.equal(new Set(transferIds).size, transferIds.length);
    career = applyCareerChoice(career, career.event.options[0].id, catalog);
  }
  return career;
}

test('career creation validates its trust boundaries', () => {
  assert.throws(
    () => createCareer({ ...identity, number: 100 }, 1, catalog),
    /Squad number/,
  );
  assert.throws(
    () => createCareer({ ...identity, position: 'COACH' }, 1, catalog),
    /position/,
  );
  assert.throws(() => createCareer(identity, 1, []), /catalog/);
});

test('the same seed and choices produce the same complete career', () => {
  const first = completeCareer(123456);
  const second = completeCareer(123456);

  assert.deepEqual(first, second);
  assert.equal(first.status, 'finished');
  assert.equal(first.age, 40);
  assert.equal(first.timeline.length, 12);
  assert.ok(first.ovr >= 40 && first.ovr <= 99);
  assert.ok(first.timeline.every((period) => period.appearances >= 0));
});

test('career state survives JSON persistence and produces an aggregate summary', () => {
  const career = completeCareer(98765);
  const restored = JSON.parse(JSON.stringify(career));
  const summary = summarizeCareer(restored, catalog);

  assert.equal(isCareerState(restored), true);
  assert.equal(summary.totals.appearances, career.totals.appearances);
  assert.equal(
    summary.clubs.reduce((total, club) => total + club.appearances, 0),
    career.totals.appearances,
  );
  assert.ok(summary.peakOvr >= 50);
  assert.ok(summary.peakValue >= 100_000);
});
