export function computeStandings(teams, matchPredictions) {
  const stats = {};
  for (const t of teams) {
    stats[t.id] = {
      team_id: t.id,
      team: t,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_diff: 0,
      points: 0,
    };
  }

  for (const key of Object.keys(matchPredictions)) {
    const mp = matchPredictions[key];
    const hg = mp.home_goals;
    const ag = mp.away_goals;
    const homeId = mp.home_team_id || mp.home_team?.id;
    const awayId = mp.away_team_id || mp.away_team?.id;

    if (hg == null || ag == null) continue;
    if (!stats[homeId] || !stats[awayId]) continue;

    stats[homeId].played += 1;
    stats[awayId].played += 1;
    stats[homeId].goals_for += hg;
    stats[homeId].goals_against += ag;
    stats[awayId].goals_for += ag;
    stats[awayId].goals_against += hg;

    if (hg > ag) {
      stats[homeId].wins += 1;
      stats[homeId].points += 3;
      stats[awayId].losses += 1;
    } else if (hg < ag) {
      stats[awayId].wins += 1;
      stats[awayId].points += 3;
      stats[homeId].losses += 1;
    } else {
      stats[homeId].draws += 1;
      stats[homeId].points += 1;
      stats[awayId].draws += 1;
      stats[awayId].points += 1;
    }
  }

  const rows = Object.values(stats);
  for (const row of rows) {
    row.goal_diff = row.goals_for - row.goals_against;
  }

  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goal_diff !== a.goal_diff) return b.goal_diff - a.goal_diff;
    if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
    return b.wins - a.wins;
  });

  rows.forEach((row, i) => { row.position = i + 1; });
  return rows;
}

export function getPlayoffTeams(standings) {
  return standings.filter(s => s.position >= 9 && s.position <= 24);
}

export function getTop8(standings) {
  return standings.filter(s => s.position <= 8);
}
