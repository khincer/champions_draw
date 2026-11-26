export function matchdaySections(teams, fixtures) {
  const groups = new Map();
  for (const fixture of fixtures) {
    if (!groups.has(fixture.matchday)) groups.set(fixture.matchday, []);
    groups.get(fixture.matchday).push(fixture);
  }
  return [...groups].sort(([a], [b]) => a - b).map(([number, round]) => {
    const playing = new Set(round.flatMap(({ home_team_id, away_team_id }) => [home_team_id, away_team_id]));
    return { number, fixtures: round, bye: teams.find(({ id }) => !playing.has(id)) };
  });
}

export function isRecordedScore({ home_goals, away_goals }) {
  return home_goals != null && away_goals != null;
}

export function initialMatchday(sections) {
  return sections.find(({ fixtures }) => fixtures.some((fixture) => !isRecordedScore(fixture)))?.number
    ?? sections.at(-1)?.number
    ?? null;
}

export function adjacentMatchdays(sections, number) {
  const index = sections.findIndex((section) => section.number === number);
  return {
    previous: sections[index - 1]?.number ?? null,
    next: index < 0 ? null : sections[index + 1]?.number ?? null,
  };
}

export function parseScore(home, away) {
  if (![home, away].every((value) => /^\d{1,3}$/.test(value))) return null;
  return { home_goals: Number(home), away_goals: Number(away) };
}

export function parseTeamList(value) {
  const names = value.split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  if (names.length < 2 || names.length > 36) return { error: 'teamCount' };
  if (new Set(names.map((name) => name.toLowerCase())).size < names.length) return { error: 'duplicateTeams' };
  return { names };
}
