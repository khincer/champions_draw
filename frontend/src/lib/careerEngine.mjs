export const CAREER_SCHEMA_VERSION = 1;

export const POSITIONS = [
  'LW',
  'ST',
  'RW',
  'LM',
  'CAM',
  'RM',
  'LB',
  'CM',
  'RB',
  'CDM',
  'CB',
  'GK',
];

const POSITION_RATES = {
  GK: [0.005, 0.01],
  CB: [0.04, 0.08],
  LB: [0.04, 0.08],
  RB: [0.04, 0.08],
  CDM: [0.08, 0.12],
  CM: [0.15, 0.22],
  CAM: [0.2, 0.24],
  LM: [0.18, 0.2],
  RM: [0.18, 0.2],
  LW: [0.25, 0.18],
  RW: [0.25, 0.18],
  ST: [0.38, 0.1],
};

const ROLE_APPEARANCES = {
  starter: [70, 105],
  rotation: [35, 69],
  reserve: [0, 34],
};

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hash(seed, step, salt) {
  let value = (Number(seed) >>> 0) ^ Math.imul(step + 1, 0x9e3779b1);
  for (let index = 0; index < salt.length; index += 1) {
    value ^= salt.charCodeAt(index);
    value = Math.imul(value, 0x45d9f3b);
    value ^= value >>> 16;
  }
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function random(seed, step, salt) {
  return hash(seed, step, salt) / 4294967296;
}

function randomInt(seed, step, salt, minimum, maximum) {
  return minimum + Math.floor(random(seed, step, salt) * (maximum - minimum + 1));
}

function pickClubs(clubs, count, seed, step, salt) {
  return clubs
    .map((club) => ({ club, score: random(seed, step, `${salt}:${club.id}`) }))
    .sort((left, right) => left.score - right.score || left.club.id.localeCompare(right.club.id))
    .slice(0, count)
    .map(({ club }) => club);
}

function getClub(catalog, clubId) {
  return catalog.find((club) => club.id === clubId) || null;
}

function clubOption(prefix, club, label, role = 'rotation') {
  return {
    id: `${prefix}:${club.id}`,
    kind: 'transfer',
    label: `${label} ${club.name}`,
    detail: `${club.league} · ${club.tier === 1 ? 'First division' : 'Second division'}`,
    clubId: club.id,
    role,
  };
}

function offerCandidates(state, catalog, count, salt, options = {}) {
  const currentClub = getClub(catalog, state.currentClubId);
  const agePenalty = state.age >= 34 ? 8 : 0;
  const target = clamp(state.ovr - agePenalty, 48, 94);
  const excluded = new Set([state.currentClubId, ...(options.exclude || [])].filter(Boolean));
  let candidates = catalog.filter((club) => {
    if (excluded.has(club.id)) return false;
    const distance = Math.abs(club.strength - target);
    return distance <= (options.distance || 12);
  });

  if (candidates.length < count) {
    candidates = catalog.filter((club) => !excluded.has(club.id));
  }

  return pickClubs(candidates, count, state.seed, state.step, salt);
}

function marketEvent(state, catalog, title = 'Transfer market') {
  const currentClub = getClub(catalog, state.currentClubId);
  const offers = offerCandidates(state, catalog, 2, `market:${state.age}`);
  return {
    type: 'market',
    title,
    description: 'Offers arrived after your latest run. Accept one or continue at your current club.',
    options: [
      ...offers.map((club) => clubOption('sign', club, 'Sign for')),
      {
        id: `stay:${currentClub.id}`,
        kind: 'stay',
        label: `Stay at ${currentClub.name}`,
        detail: `${currentClub.league} · Continue your current project`,
        clubId: currentClub.id,
        role: 'rotation',
      },
    ],
  };
}

function createEvent(state, catalog) {
  const currentClub = getClub(catalog, state.currentClubId);

  if (state.age === 16) {
    const candidates = catalog.filter((club) => club.tier === 2 || club.strength <= 58);
    const clubs = pickClubs(candidates, 3, state.seed, state.step, 'academy');
    return {
      type: 'academy',
      title: 'Academy offers',
      description: 'Three clubs want you in their youth setup. Choose where your career begins.',
      options: clubs.map((club) => clubOption('academy', club, 'Join', 'rotation')),
    };
  }

  if (state.age === 18) {
    let candidates = catalog.filter(
      (club) =>
        club.id !== state.currentClubId &&
        club.strength <= Math.min(68, (currentClub?.strength || 60) + 5),
    );
    if (candidates.length < 3) {
      candidates = catalog.filter((club) => club.id !== state.currentClubId && club.tier === 2);
    }
    const clubs = pickClubs(candidates, 3, state.seed, state.step, 'loan');
    return {
      type: 'loan',
      title: 'Loan move',
      description: 'Your club wants you to earn senior minutes elsewhere.',
      options: clubs.map((club) => clubOption('loan', club, 'Loan to', 'starter')),
    };
  }

  if (state.age === 20) {
    const parentClub = getClub(catalog, state.parentClubId || state.firstClubId);
    const offers = offerCandidates(state, catalog, 2, 'return-offers', {
      exclude: [parentClub?.id],
      distance: 10,
    });
    return {
      type: 'return',
      title: 'Return from loan',
      description: 'Your parent club has a place for you, but two permanent offers are also available.',
      options: [
        ...offers.map((club) => clubOption('sign', club, 'Sign for')),
        {
          id: `return:${parentClub.id}`,
          kind: 'return',
          label: `Return to ${parentClub.name}`,
          detail: `${parentClub.league} · Fight for your place`,
          clubId: parentClub.id,
          role: 'rotation',
        },
      ],
    };
  }

  if (state.age === 22) {
    return {
      type: 'training',
      title: 'Extra training camp',
      description: 'The extra work can accelerate your development, but fatigue carries a real risk.',
      options: [
        {
          id: 'training:risk',
          kind: 'decision',
          label: 'Take the risk',
          detail: '65%: +4 OVR · 35%: -3 OVR',
          chance: 0.65,
          successOvr: 4,
          failureOvr: -3,
          role: 'rotation',
        },
        {
          id: 'training:normal',
          kind: 'decision',
          label: 'Keep the normal routine',
          detail: 'No additional OVR change',
          role: 'rotation',
        },
      ],
    };
  }

  if (state.age === 26) {
    return {
      type: 'position',
      title: 'Cover another position',
      description: 'The coach needs your help in a different role for the next period.',
      options: [
        {
          id: 'position:accept',
          kind: 'decision',
          label: 'Accept the role',
          detail: 'Guaranteed starter · -2 temporary OVR',
          role: 'starter',
          temporaryOvr: -2,
        },
        {
          id: 'position:reject',
          kind: 'decision',
          label: 'Reject the change',
          detail: 'Keep your OVR · Fewer minutes',
          role: 'reserve',
        },
      ],
    };
  }

  if (state.age === 30) {
    const homeCandidates = catalog.filter(
      (club) => club.countryCode === state.identity.nationality && club.id !== state.currentClubId,
    );
    let returnClub = pickClubs(homeCandidates, 1, state.seed, state.step, 'homecoming')[0];
    if (!returnClub) returnClub = getClub(catalog, state.firstClubId);
    if (!returnClub || returnClub.id === state.currentClubId) {
      [returnClub] = offerCandidates(state, catalog, 1, 'homecoming-fallback');
    }
    return {
      type: 'homecoming',
      title: 'A call from home',
      description: 'Your family wants you closer. Choose between stability and a return to familiar ground.',
      options: [
        {
          id: `homecoming:stay:${currentClub.id}`,
          kind: 'stay',
          label: `Stay at ${currentClub.name}`,
          detail: '-5 temporary OVR after a difficult off-field period',
          clubId: currentClub.id,
          role: 'rotation',
          temporaryOvr: -5,
        },
        clubOption('homecoming', returnClub, 'Move to'),
      ],
    };
  }

  if (state.age === 34) {
    const [offer] = offerCandidates(state, catalog, 1, 'competition-offer');
    return {
      type: 'competition',
      title: 'Competition for your place',
      description: 'The club signed another player for your position. Back yourself or move on.',
      options: [
        {
          id: 'competition:stay',
          kind: 'decision',
          label: 'Compete',
          detail: '50% starter · 50% reserve',
          randomRole: true,
        },
        clubOption('sign', offer, 'Sign for'),
      ],
    };
  }

  return marketEvent(state, catalog);
}

function developmentDelta(state) {
  if (state.age <= 20) return randomInt(state.seed, state.step, 'development', 4, 8);
  if (state.age <= 28) return randomInt(state.seed, state.step, 'development', 1, 4);
  if (state.age <= 32) return -randomInt(state.seed, state.step, 'development', 1, 3);
  if (state.age <= 36) return -randomInt(state.seed, state.step, 'development', 2, 4);
  return -randomInt(state.seed, state.step, 'development', 3, 6);
}

function periodStats(state, role, ovr) {
  const [minimum, maximum] = ROLE_APPEARANCES[role] || ROLE_APPEARANCES.rotation;
  const ageFactor = state.age >= 38 ? 0.68 : state.age >= 34 ? 0.84 : 1;
  const appearances = Math.round(
    randomInt(state.seed, state.step, 'appearances', minimum, maximum) * ageFactor,
  );
  const [goalRate, assistRate] = POSITION_RATES[state.identity.position];
  const qualityFactor = clamp(ovr / 75, 0.65, 1.3);
  const goalVariance = 0.85 + random(state.seed, state.step, 'goal-variance') * 0.3;
  const assistVariance = 0.85 + random(state.seed, state.step, 'assist-variance') * 0.3;
  return {
    appearances,
    goals: Math.max(0, Math.round(appearances * goalRate * qualityFactor * goalVariance)),
    assists: Math.max(0, Math.round(appearances * assistRate * qualityFactor * assistVariance)),
  };
}

function valueFor(ovr, age, seed, step) {
  const bands = [
    [54, 100_000, 400_000],
    [64, 400_000, 1_500_000],
    [74, 1_500_000, 6_000_000],
    [79, 6_000_000, 15_000_000],
    [84, 15_000_000, 35_000_000],
    [89, 35_000_000, 75_000_000],
    [99, 75_000_000, 150_000_000],
  ];
  const [ceiling, minimum, maximum] = bands.find(([limit]) => ovr <= limit) || bands.at(-1);
  const previousCeiling = bands[bands.indexOf(bands.find(([limit]) => limit === ceiling)) - 1]?.[0] || 40;
  const progress = clamp((ovr - previousCeiling) / Math.max(1, ceiling - previousCeiling), 0, 1);
  const ageMultiplier =
    age <= 22 ? 1 : age <= 29 ? 1.15 : age <= 32 ? 0.8 : age <= 35 ? 0.5 : age <= 38 ? 0.2 : 0.08;
  const jitter = 0.9 + random(seed, step, 'valuation') * 0.2;
  return Math.max(100_000, Math.round(((minimum + (maximum - minimum) * progress) * ageMultiplier * jitter) / 10_000) * 10_000);
}

function periodAchievements(state, club, ovr) {
  const achievements = [];
  const domesticChance = clamp((club.strength + ovr - 120) / 100, 0.02, 0.45);
  const europeanChance =
    club.tier === 1 && club.strength >= 78
      ? clamp((club.strength + ovr - 155) / 150, 0.01, 0.18)
      : 0;
  const relegationChance =
    club.tier === 1 && club.strength < 64 ? clamp((64 - club.strength) / 45, 0.05, 0.28) : 0;
  const promoted =
    club.tier === 2 &&
    random(state.seed, state.step, 'promotion') <
      clamp((club.strength + ovr - 118) / 100, 0.04, 0.35);
  const relegated = random(state.seed, state.step, 'relegation') < relegationChance;

  if (promoted) {
    achievements.push({ type: 'status', name: 'Promotion', age: state.age, clubId: club.id });
  } else if (relegated) {
    achievements.push({ type: 'status', name: 'Relegation', age: state.age, clubId: club.id });
  } else {
    if (random(state.seed, state.step, 'domestic-title') < domesticChance) {
      achievements.push({
        type: 'trophy',
        name: `${club.country} League`,
        age: state.age,
        clubId: club.id,
      });
    }
    if (random(state.seed, state.step, 'european-title') < europeanChance) {
      achievements.push({
        type: 'trophy',
        name: 'European Champions Cup',
        age: state.age,
        clubId: club.id,
      });
    }
  }

  return achievements;
}

function periodAwards(state, ovr, stats) {
  const awards = [];
  if (
    state.age <= 22 &&
    ovr >= 75 &&
    !state.awards.some((award) => award.name === 'Young Player of the Year')
  ) {
    awards.push({ name: 'Young Player of the Year', age: state.age });
  }
  if (stats.goals >= 25 && random(state.seed, state.step, 'top-scorer') < 0.35) {
    awards.push({ name: 'Top Scorer', age: state.age });
  }
  if (ovr >= 90 && stats.goals + stats.assists >= 35 && random(state.seed, state.step, 'player-year') < 0.3) {
    awards.push({ name: 'World Player of the Year', age: state.age });
  }
  return awards;
}

function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length < 3) {
    throw new TypeError('A catalog with at least three clubs is required.');
  }
  for (const club of catalog) {
    if (!club?.id || !club?.name || !Number.isFinite(club.strength) || ![1, 2].includes(club.tier)) {
      throw new TypeError('Every club needs an id, name, strength, and tier.');
    }
  }
}

function validateIdentity(identity) {
  const name = String(identity?.name || '').trim();
  const number = Number(identity?.number);
  const foot = identity?.foot;
  const nationality = String(identity?.nationality || '').toUpperCase();
  const position = identity?.position;

  if (!name || name.length > 80) throw new RangeError('Name must be between 1 and 80 characters.');
  if (!Number.isInteger(number) || number < 1 || number > 99) {
    throw new RangeError('Squad number must be between 1 and 99.');
  }
  if (!['left', 'right'].includes(foot)) throw new RangeError('Preferred foot is required.');
  if (!/^[A-Z]{2}$/.test(nationality)) throw new RangeError('Nationality must be an ISO country code.');
  if (!POSITIONS.includes(position)) throw new RangeError('A valid position is required.');

  return { name, number, foot, nationality, position };
}

export function createCareer(identity, seed, catalog) {
  validateCatalog(catalog);
  const normalizedIdentity = validateIdentity(identity);
  const normalizedSeed = Number(seed) >>> 0;
  const state = {
    schemaVersion: CAREER_SCHEMA_VERSION,
    seed: normalizedSeed,
    step: 0,
    status: 'active',
    identity: normalizedIdentity,
    age: 16,
    ovr: 50,
    value: 100_000,
    peakOvr: 50,
    peakValue: 100_000,
    currentClubId: null,
    firstClubId: null,
    parentClubId: null,
    totals: { appearances: 0, goals: 0, assists: 0 },
    timeline: [],
    trophies: [],
    awards: [],
    internationalTrophies: [],
    calledUp: false,
    lastOutcome: '',
    event: null,
  };
  state.event = createEvent(state, catalog);
  return state;
}

export function applyCareerChoice(state, choiceId, catalog) {
  validateCatalog(catalog);
  if (!isCareerState(state) || state.status !== 'active' || !state.event) {
    throw new TypeError('An active career with a pending event is required.');
  }
  const choice = state.event.options.find((option) => option.id === choiceId);
  if (!choice) throw new RangeError('Choice does not belong to the current event.');

  let role = choice.role || 'rotation';
  let permanentOvr = 0;
  let temporaryOvr = choice.temporaryOvr || 0;
  let outcome = choice.label;

  if (choice.randomRole) {
    role = random(state.seed, state.step, 'competition-result') < 0.5 ? 'starter' : 'reserve';
    outcome = role === 'starter' ? 'You won the starting role.' : 'You dropped into a reserve role.';
  }

  if (Number.isFinite(choice.chance)) {
    const succeeded = random(state.seed, state.step, 'decision-result') < choice.chance;
    permanentOvr = succeeded ? choice.successOvr : choice.failureOvr;
    outcome = succeeded
      ? `Extra training paid off: +${choice.successOvr} OVR.`
      : `Fatigue hit your development: ${choice.failureOvr} OVR.`;
  }

  let currentClubId = choice.clubId || state.currentClubId;
  let firstClubId = state.firstClubId;
  let parentClubId = state.parentClubId;
  if (state.age === 16) {
    firstClubId = currentClubId;
    parentClubId = currentClubId;
  } else if (state.age >= 20) {
    parentClubId = null;
  }

  const club = getClub(catalog, currentClubId);
  if (!club) throw new RangeError('Selected club is not in the catalog.');

  const persistentOvr = clamp(state.ovr + permanentOvr, 40, 99);
  const periodOvr = clamp(persistentOvr + temporaryOvr, 40, 99);
  const stats = periodStats(state, role, periodOvr);
  const achievements = periodAchievements(state, club, periodOvr);
  const awards = periodAwards(state, periodOvr, stats);
  const calledUp = state.calledUp || periodOvr >= 75;
  const newInternationalTrophies = [...state.internationalTrophies];
  if (
    calledUp &&
    periodOvr >= 82 &&
    random(state.seed, state.step, 'international-title') < 0.1
  ) {
    newInternationalTrophies.push({ name: 'International Championship', age: state.age });
  }

  const nextAge = state.age + 2;
  const nextOvr = clamp(persistentOvr + developmentDelta(state), 40, 99);
  const nextValue = valueFor(nextOvr, nextAge, state.seed, state.step);
  const timelineEntry = {
    age: state.age,
    clubId: currentClubId,
    ovr: periodOvr,
    role,
    appearances: stats.appearances,
    goals: stats.goals,
    assists: stats.assists,
    outcome,
    achievements,
  };
  const additions = [
    ...achievements.map((achievement) => achievement.name),
    ...awards.map((award) => award.name),
  ];
  if (!state.calledUp && calledUp) additions.push('National team call-up');

  const nextState = {
    ...state,
    step: state.step + 1,
    age: nextAge,
    ovr: nextOvr,
    value: nextValue,
    peakOvr: Math.max(state.peakOvr, periodOvr, nextOvr),
    peakValue: Math.max(state.peakValue, nextValue),
    currentClubId,
    firstClubId,
    parentClubId,
    totals: {
      appearances: state.totals.appearances + stats.appearances,
      goals: state.totals.goals + stats.goals,
      assists: state.totals.assists + stats.assists,
    },
    timeline: [...state.timeline, timelineEntry],
    trophies: [
      ...state.trophies,
      ...achievements.filter((achievement) => achievement.type === 'trophy'),
    ],
    awards: [...state.awards, ...awards],
    internationalTrophies: newInternationalTrophies,
    calledUp,
    lastOutcome: [outcome, ...additions].filter(Boolean).join(' · '),
    event: null,
  };

  if (nextAge >= 40) {
    nextState.status = 'finished';
    return nextState;
  }

  nextState.event = createEvent(nextState, catalog);
  return nextState;
}

export function summarizeCareer(state, catalog) {
  validateCatalog(catalog);
  if (!isCareerState(state)) throw new TypeError('A valid career is required.');
  const clubMap = new Map(catalog.map((club) => [club.id, club]));
  const aggregate = new Map();

  for (const period of state.timeline) {
    const current = aggregate.get(period.clubId) || {
      club: clubMap.get(period.clubId),
      appearances: 0,
      goals: 0,
      assists: 0,
      trophies: [],
      statuses: [],
    };
    current.appearances += period.appearances;
    current.goals += period.goals;
    current.assists += period.assists;
    current.trophies.push(
      ...period.achievements.filter((item) => item.type === 'trophy').map((item) => item.name),
    );
    current.statuses.push(
      ...period.achievements.filter((item) => item.type === 'status').map((item) => item.name),
    );
    aggregate.set(period.clubId, current);
  }

  return {
    identity: state.identity,
    peakOvr: state.peakOvr,
    peakValue: state.peakValue,
    totals: state.totals,
    calledUp: state.calledUp,
    trophies: state.trophies,
    awards: state.awards,
    internationalTrophies: state.internationalTrophies,
    clubs: [...aggregate.values()],
  };
}

export function isCareerState(value) {
  return Boolean(
    value &&
      value.schemaVersion === CAREER_SCHEMA_VERSION &&
      Number.isInteger(value.seed) &&
      ['active', 'finished'].includes(value.status) &&
      value.identity &&
      Number.isInteger(value.age) &&
      Array.isArray(value.timeline) &&
      value.totals,
  );
}
