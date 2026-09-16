/* Pure playoff tie utilities shared by PlayoffBracket and the league
   Playoffs view. No JSX, no imports — kept node --test friendly. */

function computeAgg(l1h, l1a, l2h, l2a) {
  if ([l1h, l1a, l2h, l2a].some(v => v == null)) return null;
  return { home: l1h + l2h, away: l1a + l2a };
}

function tieKey(matchup) {
  const home = matchup.home_team?.id ?? matchup.home_team?.name ?? '';
  const away = matchup.away_team?.id ?? matchup.away_team?.name ?? '';
  return [home, away].sort().join('|');
}

function compareKickoff(a, b) {
  const aMissing = a.kickoff == null;
  const bMissing = b.kickoff == null;
  if (aMissing !== bMissing) return aMissing ? 1 : -1; // missing kickoff sorts last
  return String(a.kickoff).localeCompare(String(b.kickoff));
}

/* Pair the directed legs of each playoff tie (matchday == null, loose
   equality so a missing field counts too) and order legs by kickoff. A tie
   with a single leg renders flat: aggregate null, no pairing. */
function pairPlayoffTies(matchups) {
  const byKey = new Map();
  for (const m of matchups || []) {
    if (m.matchday == null) {
      const key = tieKey(m);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(m);
    }
  }
  const ties = [];
  for (const legs of byKey.values()) {
    legs.sort(compareKickoff);
    ties.push({
      legs,
      aggregate: legs.length > 1
        ? computeAgg(legs[0].home_goals, legs[0].away_goals, legs[1].home_goals, legs[1].away_goals)
        : null,
    });
  }
  return ties;
}

export { computeAgg, pairPlayoffTies };