const officialCompetitions = new Set(['UCL', 'LIB', 'SUD']);

export function simulatorSeasons(seasons) {
  return seasons.filter((season) => (
    season.competition === 'UCL'
    && season.pot_count === 4
    && season.teams_per_pot === 9
    && season.total_matches === 8
  ));
}

function selectSeasonId(seasons, currentId, preferred) {
  const selected = seasons.find(({ id }) => String(id) === currentId);
  const season = selected || preferred(seasons) || seasons[0];
  return season ? String(season.id) : '';
}

export function selectSimulatorSeasonId(seasons, currentId) {
  return selectSeasonId(simulatorSeasons(seasons), currentId, (eligible) => eligible.find(({ is_active }) => is_active));
}

export function selectOfficialSeasonId(seasons, currentId) {
  return selectSeasonId(
    seasons.filter(({ competition }) => officialCompetitions.has(competition)),
    currentId,
    (official) => official.find(({ competition, is_active }) => competition === 'UCL' && is_active)
      || official.find(({ competition }) => competition === 'UCL'),
  );
}
