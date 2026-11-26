function normalizedGoals(value) {
  return { home_goals: value.home_goals ?? null, away_goals: value.away_goals ?? null };
}

export function buildMatchSyncRows(predictions, { completeOnly = false } = {}) {
  return Object.entries(predictions).flatMap(([id, value]) => {
    const goals = normalizedGoals(value);
    const hasHome = goals.home_goals !== null;
    const hasAway = goals.away_goals !== null;
    if (completeOnly && hasHome !== hasAway) return [];
    return [{ matchup: Number(id), ...goals }];
  });
}

export async function syncLeaguePicks(send, predictions, onUnavailable) {
  let entries = Object.entries(predictions);
  while (entries.length) {
    try {
      await send(entries.map(([id, value]) => ({ match_id: Number(id), ...normalizedGoals(value) })));
      return entries.map(([id]) => id);
    } catch (error) {
      if (error.status !== 400) throw error;
      const rejected = new Set(
        [error.payload?.closed, error.payload?.unscheduled]
          .filter(Array.isArray)
          .flat()
          .map(String),
      );
      const unavailable = entries.filter(([id]) => rejected.has(id)).map(([id]) => id);
      if (!unavailable.length) throw error;
      onUnavailable(unavailable);
      entries = entries.filter(([id]) => !rejected.has(id));
    }
  }
  return [];
}
