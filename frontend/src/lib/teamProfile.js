/* Pure shaping helpers for the team profile payload. No Preact, no DOM. */

/* Group names served by the API are Spanish source strings; "Direccion" is
   escaped so this file stays ASCII while still matching the data. */
export const SQUAD_GROUP_ORDER = [
  'Arqueros',
  'Defensores',
  'Mediocampistas',
  'Delanteros',
  'Direcci\u00f3n',
];

export function groupSquad(squad) {
  const byGroup = new Map();
  for (const player of squad || []) {
    const group = player.group || '';
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push(player);
  }
  const known = SQUAD_GROUP_ORDER.filter((group) => byGroup.has(group));
  const unknown = [...byGroup.keys()]
    .filter((group) => !SQUAD_GROUP_ORDER.includes(group))
    .sort();
  return [...known, ...unknown].map((group) => ({ group, players: byGroup.get(group) }));
}

export function buildLeaderboards(statLeaders) {
  const competitions = [];
  const byCompetition = new Map();
  for (const row of statLeaders || []) {
    let competition = byCompetition.get(row.competition);
    if (!competition) {
      competition = { competition: row.competition, metrics: [], byMetric: new Map() };
      byCompetition.set(row.competition, competition);
      competitions.push(competition);
    }
    let metric = competition.byMetric.get(row.metric);
    if (!metric) {
      metric = { metric: row.metric, rows: [] };
      competition.byMetric.set(row.metric, metric);
      competition.metrics.push(metric);
    }
    metric.rows.push(row);
  }
  for (const competition of competitions) {
    for (const metric of competition.metrics) {
      metric.rows.sort((a, b) => a.rank - b.rank);
    }
  }
  return competitions.map(({ competition, metrics }) => ({ competition, metrics }));
}
