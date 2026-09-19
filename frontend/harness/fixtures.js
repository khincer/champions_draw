/* Deterministic fixtures for the Phase 2 primitive harness.
   Two shapes are covered because the five replaced tables consumed two:
   - `flatRows`   → Python `compute_standings` (`played/wins/draws/losses`), used
                    by `GroupStandingsTables` and `TeamPage`.
   - `leagueRows` → league standings API / JS `computeStandings` (`team` object,
                    `won/draw/lost`), used by the prediction and real tables.
   Positions 1, 9 and 30 are the band boundaries under test. Teams 7, 18 and 27
   have no crest URL so the initials fallback is exercised. */

const NAMES = [
  'Real Madrid', 'Bayern Munich', 'Liverpool', 'Inter Milan', 'Barcelona',
  'Arsenal', 'Chelsea', 'Dortmund', 'Atletico Madrid', 'PSG',
  'Juventus', 'Benfica', 'Porto', 'Ajax', 'Napoli',
  'Leverkusen', 'Atalanta', 'Milan', 'Sporting CP', 'Salzburg',
  'Olympiacos', 'Celtic', 'Brugge', 'Feyenoord', 'Galatasaray',
  'Rangers', 'Slavia Prague', 'Young Boys', 'Dinamo Zagreb', 'Red Star',
  'Copenhagen', 'Sparta Prague', 'Sturm Graz', 'Shakhtar', 'Bologna', 'Girona',
];

// Positions whose points/goal-diff are crafted so the order is not accidental.
const points = (position) => Math.max(0, 25 - position * 0.5);
const goalDiff = (position) => 30 - position;

export const flatRows = NAMES.map((name, index) => {
  const position = index + 1;
  const won = 20 - Math.floor(position / 2);
  const drawn = position % 5;
  const lost = Math.max(0, 17 - won - drawn);
  const goalsFor = 60 - position;
  const goalsAgainst = 20 + position;
  return {
    position,
    team_id: 1000 + position,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    logo_url: position % 9 === 7 ? '' : `https://example.invalid/${position}.png`,
    association: { code: 'ESP' },
    played: won + drawn + lost,
    wins: won,
    draws: drawn,
    losses: lost,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    goal_diff: goalsFor - goalsAgainst,
    points: points(position),
  };
});

export const leagueRows = NAMES.map((name, index) => {
  const position = index + 1;
  const won = 20 - Math.floor(position / 2);
  const drawn = position % 5;
  const lost = Math.max(0, 17 - won - drawn);
  const goalsFor = 60 - position;
  const goalsAgainst = 20 + position;
  return {
    position,
    team_id: 1000 + position,
    team: {
      id: 1000 + position,
      name,
      short_name: name.slice(0, 3).toUpperCase(),
      logo_url: position % 9 === 7 ? '' : `https://example.invalid/${position}.png`,
      association: { code: 'ESP' },
    },
    played: won + drawn + lost,
    wins: won,
    draws: drawn,
    losses: lost,
    goals_for: goalsFor,
    goals_against: goalsAgainst,
    goal_diff: goalsFor - goalsAgainst,
    points: points(position),
  };
});

const team = (name, pot) => ({
  id: name.length * 100 + pot,
  name,
  short_name: name.slice(0, 3).toUpperCase(),
  logo_url: `https://example.invalid/${name}.png`,
  association: { code: 'ENG' },
  pot,
  seeding_position: pot,
});

export const fixtureTeams = {
  home: team('Arsenal', 1),
  away: team('Porto', 2),
  crestless: { ...team('Celtic', 3), logo_url: '' },
  shortOnly: { name: 'Benfica', short_name: 'BEN', association: { code: 'POR' } },
};

export const standingsOnly = { position: 30, team_id: 1030, name: NAMES[29], short_name: 'RED', logo_url: '', association: { code: 'SRB' }, played: 8, wins: 0, draws: 1, losses: 7, goals_for: 3, goals_against: 21, goal_diff: -18, points: 4 };
