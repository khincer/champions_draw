export function normTeamName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|sv|club)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toMiniRow(m) {
  const hasResult = m.home_goals != null && m.away_goals != null;
  return {
    id: m.id,
    home_name: m.home_team?.name || '',
    home_crest: m.home_team?.logo_url || null,
    away_name: m.away_team?.name || '',
    away_crest: m.away_team?.logo_url || null,
    kickoff: m.kickoff,
    status: m.status,
    matchday: m.matchday,
    result: hasResult ? { home_goals: m.home_goals, away_goals: m.away_goals } : null,
  };
}
