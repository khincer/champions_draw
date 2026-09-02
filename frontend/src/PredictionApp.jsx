import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import MatchdayScoreBoard from './MatchdayScoreBoard';
import LeagueTable from './LeagueTable';
import PlayoffBracket from './PlayoffBracket';
import KnockoutBracket from './KnockoutBracket';
import { loadLocal, saveLocal } from './predictionStorage';
import { computeStandings, defenseNorm, eliminationBoost, expectedGoals, teamStrength } from './standingsCalc';

const SUB_TABS = [
  ['scores', 'Score Matches'],
  ['standings', 'Standings'],
  ['playoffs', 'Playoffs'],
  ['bracket', 'Bracket'],
];

const STORAGE_STATE_KEY = 'champions_draw_prediction_state';

export default function PredictionApp({
  seasonId,
  playerName,
  seasonState,
  predictionApi,
  apiFetch,
}) {
  const latestDrawSeed = seasonState?.draws?.[0]?.draw_seed;

  const [subTab, setSubTab] = useState('scores');
  const [localData, setLocalData] = useState(() => loadLocal(seasonId, playerName, latestDrawSeed));
  const [remotePrediction, setRemotePrediction] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [savingMatchday, setSavingMatchday] = useState(false);
  const [savingPlayoffs, setSavingPlayoffs] = useState(false);
  const [savingKnockout, setSavingKnockout] = useState(false);
  const [error, setError] = useState('');
  const syncTimer = useRef(null);

  // Restore matchday from localStorage
  const [currentMatchday, setCurrentMatchday] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_STATE_KEY);
      if (raw) {
        const { matchday } = JSON.parse(raw);
        if (matchday >= 1 && matchday <= 8) return matchday;
      }
    } catch {}
    return 1;
  });

  const matchups = seasonState?.matchups || [];

  const validMatchupIds = useMemo(
    () => new Set(matchups.map((m) => String(m.id))),
    [matchups],
  );

  const matchPredictions = useMemo(
    () => localData.matchPredictions || {},
    [localData.matchPredictions],
  );

  // Only count predictions for currently existing matchups.
  // When a new draw is generated with reset=true, matchup IDs change
  // and old localStorage entries must be excluded from standings.
  const validPredictions = useMemo(() => {
    const filtered = {};
    for (const [id, pred] of Object.entries(matchPredictions)) {
      if (validMatchupIds.has(id)) {
        filtered[id] = pred;
      }
    }
    return filtered;
  }, [matchPredictions, validMatchupIds]);

  // Save current matchday to localStorage
  const persistMatchday = useCallback((md) => {
    try {
      localStorage.setItem(STORAGE_STATE_KEY, JSON.stringify({ matchday: md }));
    } catch {}
  }, []);

  const handleMatchdayChange = useCallback((md) => {
    setCurrentMatchday(md);
    persistMatchday(md);
  }, [persistMatchday]);

  // Create/get remote prediction on mount
  useEffect(() => {
    if (!seasonId || !playerName) return;
    (async () => {
      try {
        const pred = await apiFetch('/predictions/', {
          method: 'POST',
          body: JSON.stringify({ season: Number(seasonId), player_name: playerName }),
        });
        setRemotePrediction(pred);

        // Merge remote data into localData
        if (pred && pred.match_predictions) {
          setLocalData((prev) => {
            const remote = {};
            for (const mp of pred.match_predictions) {
              if (mp.home_goals != null || mp.away_goals != null) {
                remote[mp.matchup.id] = {
                  home_goals: mp.home_goals,
                  away_goals: mp.away_goals,
                  home_team_id: mp.matchup.home_team.id,
                  away_team_id: mp.matchup.away_team.id,
                };
              }
            }
            const merged = {
              ...prev,
              matchPredictions: { ...remote, ...prev.matchPredictions },
            };
            saveLocal(seasonId, playerName, merged, latestDrawSeed);
            return merged;
          });
        }
      } catch (e) {
        // silent
      }
    })();
  }, [seasonId, playerName]);

  // Periodic sync to backend
  useEffect(() => {
    if (!remotePrediction) return;
    syncTimer.current = setInterval(() => {
      syncToBackend();
    }, 30000);
    return () => clearInterval(syncTimer.current);
  }, [remotePrediction, localData]);

  const syncToBackend = useCallback(async () => {
    if (!remotePrediction || syncing) return;
    setSyncing(true);
    try {
      const predictions = Object.entries(validPredictions)
        .filter(([_, v]) => v.home_goals != null || v.away_goals != null)
        .map(([matchupId, v]) => ({
          matchup: Number(matchupId),
          home_goals: v.home_goals,
          away_goals: v.away_goals,
        }));

      if (predictions.length > 0) {
        await apiFetch(`/predictions/${remotePrediction.id}/sync/`, {
          method: 'POST',
          body: JSON.stringify({ predictions }),
        });
      }
    } catch {
      // silent
    } finally {
      setSyncing(false);
    }
  }, [remotePrediction, validPredictions, syncing]);

  const handleSaveMatchday = useCallback(async () => {
    if (!remotePrediction) return;
    setSavingMatchday(true);
    try {
      const predictions = Object.entries(validPredictions)
        .filter(([_, v]) => v.home_goals != null && v.away_goals != null)
        .map(([matchupId, v]) => ({
          matchup: Number(matchupId),
          home_goals: v.home_goals,
          away_goals: v.away_goals,
        }));

      await apiFetch(`/predictions/${remotePrediction.id}/sync/`, {
        method: 'POST',
        body: JSON.stringify({ predictions }),
      });

      // Move to next matchday if not on the last one
      if (currentMatchday < 8) {
        const next = currentMatchday + 1;
        setCurrentMatchday(next);
        persistMatchday(next);
      }
    } catch (e) {
      setError('Failed to save: ' + e.message);
    } finally {
      setSavingMatchday(false);
    }
  }, [remotePrediction, validPredictions, currentMatchday, persistMatchday]);

  const handleRandomizeMatchday = useCallback((matchday) => {
    const md = String(matchday);
    const byMatchday = {};
    for (const m of matchups) {
      if (!byMatchday[m.matchday]) byMatchday[m.matchday] = [];
      byMatchday[m.matchday].push(m);
    }
    const fixtures = byMatchday[md] || [];
    if (!fixtures.length) return;

    setLocalData((prev) => {
      const updated = { ...prev, matchPredictions: { ...prev.matchPredictions } };
      for (const f of fixtures) {
        const hg = randomGoals(f.home_team, f.away_team);
        const ag = randomGoals(f.away_team, f.home_team);
        updated.matchPredictions[f.id] = {
          ...(updated.matchPredictions[f.id] || {}),
          home_goals: hg,
          away_goals: ag,
          home_team_id: f.home_team.id,
          away_team_id: f.away_team.id,
        };
      }
      saveLocal(seasonId, playerName, updated, latestDrawSeed);
      return updated;
    });
  }, [matchups, seasonId, playerName, latestDrawSeed]);

  const handleScoreChange = useCallback((matchupId, field, value, fixture) => {
    setLocalData((prev) => {
      const existing = prev.matchPredictions[matchupId] || {};
      if (fixture) {
        existing.home_team_id = fixture.home_team.id;
        existing.away_team_id = fixture.away_team.id;
      }
      const updated = {
        ...prev,
        matchPredictions: {
          ...prev.matchPredictions,
          [matchupId]: { ...existing, [field]: value },
        },
      };
      saveLocal(seasonId, playerName, updated, latestDrawSeed);
      return updated;
    });
  }, [seasonId, playerName, latestDrawSeed]);

  const handlePlayoffScoreChange = useCallback((matchupIdx, field, value) => {
    setLocalData((prev) => {
      const existing = prev.playoffPredictions[matchupIdx] || {};
      const updated = {
        ...prev,
        playoffPredictions: {
          ...prev.playoffPredictions,
          [matchupIdx]: { ...existing, [field]: value },
        },
      };
      saveLocal(seasonId, playerName, updated, latestDrawSeed);
      return updated;
    });
  }, [seasonId, playerName, latestDrawSeed]);

  const handleKnockoutScoreChange = useCallback((round, bp, field, value) => {
    setLocalData((prev) => {
      const key = `${round}_${bp}`;
      const existing = prev.knockoutPredictions[key] || {};
      const updated = {
        ...prev,
        knockoutPredictions: {
          ...prev.knockoutPredictions,
          [key]: { ...existing, round, bracket_position: bp, [field]: value },
        },
      };
      saveLocal(seasonId, playerName, updated, latestDrawSeed);
      return updated;
    });
  }, [seasonId, playerName, latestDrawSeed]);

  const standings = useMemo(
    () => computeStandings(seasonState?.teams || [], validPredictions),
    [seasonState?.teams, validPredictions],
  );

  const playoffMatchups = useMemo(() => {
    const playoffTeams = standings.filter(s => s.position >= 9 && s.position <= 24);
    const pairings = [[9,24],[10,23],[11,22],[12,21],[13,20],[14,19],[15,18],[16,17]];
    const teamByPos = {};
    playoffTeams.forEach(t => { teamByPos[t.position] = t; });

    return pairings.map(([h, a], idx) => {
      const home = teamByPos[h];
      const away = teamByPos[a];
      if (!home || !away) return null;
      const stored = localData.playoffPredictions[idx + 1] || {};
      const l1h = stored.leg1_home_goals ?? null;
      const l1a = stored.leg1_away_goals ?? null;
      const l2h = stored.leg2_home_goals ?? null;
      const l2a = stored.leg2_away_goals ?? null;
      const winnerId = computePlayoffWinner(l1h, l1a, l2h, l2a, home.team_id, away.team_id);
      const winnerTeam = winnerId === home.team_id ? home.team : (winnerId === away.team_id ? away.team : null);
      return {
        matchup_index: idx + 1,
        home_team: home.team,
        away_team: away.team,
        leg1_home_goals: l1h,
        leg1_away_goals: l1a,
        leg2_home_goals: l2h,
        leg2_away_goals: l2a,
        winner: winnerTeam,
      };
    }).filter(Boolean);
  }, [standings, localData.playoffPredictions]);

  const knockoutBracket = useMemo(() => {
    const top8 = standings.filter(s => s.position <= 8);
    const pwMap = {};
    playoffMatchups.forEach(pm => {
      if (pm.winner) {
        pwMap[pm.matchup_index] = pm.winner;
      }
    });

    const r16Pairs = [
      [1, 8], [2, 7], [3, 6], [4, 5],
      [5, 4], [6, 3], [7, 2], [8, 1],
    ];

    const topByPos = {};
    top8.forEach(t => { topByPos[t.position] = t; });

    const r16 = r16Pairs.map(([pos, pwIdx], i) => {
      const top = topByPos[pos];
      const pw = pwMap[pwIdx];
      if (!top) return null;
      const stored = localData.knockoutPredictions[`R16_${i + 1}`] || {};
      return {
        round: 'R16',
        bracket_position: i + 1,
        home_team: top.team,
        away_team: pw || null,
        home_goals: stored.home_goals ?? null,
        away_goals: stored.away_goals ?? null,
        winner: stored.winner || null,
      };
    }).filter(Boolean);

    const advanceR16 = (bp) => {
      const match = r16.find(m => m.bracket_position === bp);
      if (!match) return null;
      if (match.winner) return match.winner;
      const { home_goals: hg, away_goals: ag, home_team: ht, away_team: at } = match;
      if (hg == null || ag == null || !ht || !at) return null;
      const wId = hg > ag ? ht.team_id : (ag > hg ? at.team_id : ht.team_id);
      return wId === ht.team_id ? ht : at;
    };

    const qfMap = [[1,2],[3,4],[5,6],[7,8]];
    const qf = qfMap.map(([p1, p2], i) => {
      const stored = localData.knockoutPredictions[`QF_${i + 1}`] || {};
      const ht = advanceR16(p1);
      const at = advanceR16(p2);
      if (!ht || !at) return null;
      return {
        round: 'QF',
        bracket_position: i + 1,
        home_team: ht,
        away_team: at,
        home_goals: stored.home_goals ?? null,
        away_goals: stored.away_goals ?? null,
        winner: stored.winner || null,
      };
    }).filter(Boolean);

    const advanceQF = (bp) => {
      const match = qf.find(m => m.bracket_position === bp);
      if (!match) return null;
      if (match.winner) return match.winner;
      const { home_goals: hg, away_goals: ag, home_team: ht, away_team: at } = match;
      if (hg == null || ag == null || !ht || !at) return null;
      const wId = hg > ag ? ht.team_id : (ag > hg ? at.team_id : ht.team_id);
      return wId === ht.team_id ? ht : at;
    };

    const sf = [[1,2],[3,4]].map(([p1, p2], i) => {
      const stored = localData.knockoutPredictions[`SF_${i + 1}`] || {};
      const ht = advanceQF(p1);
      const at = advanceQF(p2);
      if (!ht || !at) return null;
      return {
        round: 'SF',
        bracket_position: i + 1,
        home_team: ht,
        away_team: at,
        home_goals: stored.home_goals ?? null,
        away_goals: stored.away_goals ?? null,
        winner: stored.winner || null,
      };
    }).filter(Boolean);

    const advanceSF = (bp) => {
      const match = sf.find(m => m.bracket_position === bp);
      if (!match) return null;
      if (match.winner) return match.winner;
      const { home_goals: hg, away_goals: ag, home_team: ht, away_team: at } = match;
      if (hg == null || ag == null || !ht || !at) return null;
      const wId = hg > ag ? ht.team_id : (ag > hg ? at.team_id : ht.team_id);
      return wId === ht.team_id ? ht : at;
    };

    const finalStored = localData.knockoutPredictions['F_1'] || {};
    const sf1 = advanceSF(1);
    const sf2 = advanceSF(2);
    const final = (sf1 && sf2) ? [{
      round: 'F',
      bracket_position: 1,
      home_team: sf1,
      away_team: sf2,
      home_goals: finalStored.home_goals ?? null,
      away_goals: finalStored.away_goals ?? null,
      winner: finalStored.winner || null,
    }] : [];

    return { R16: r16, QF: qf, SF: sf, F: final };
  }, [standings, playoffMatchups, localData.knockoutPredictions]);

  const leagueComplete = useMemo(
    () => matchups.length > 0
      && matchups.every((m) => {
        const p = validPredictions[String(m.id)];
        return p && p.home_goals != null && p.away_goals != null;
      }),
    [matchups, validPredictions],
  );

  const playoffsComplete = useMemo(
    () => playoffMatchups.length > 0
      && playoffMatchups.every((pm) => {
        const p = localData.playoffPredictions[pm.matchup_index];
        return p
          && p.leg1_home_goals != null && p.leg1_away_goals != null
          && p.leg2_home_goals != null && p.leg2_away_goals != null;
      }),
    [playoffMatchups, localData.playoffPredictions],
  );

  const knockoutComplete = useMemo(() => {
    const rounds = Object.values(knockoutBracket);
    if (!rounds.some((r) => r.some((m) => m.home_team && m.away_team))) return false;
    return rounds.every((round) =>
      round.every((m) => {
        if (!m.home_team || !m.away_team) return true; // TBD slot, nothing to score yet
        const p = localData.knockoutPredictions[`${m.round}_${m.bracket_position}`];
        return p && p.home_goals != null && p.away_goals != null;
      }),
    );
  }, [knockoutBracket, localData.knockoutPredictions]);

  const handleRandomizePlayoffs = useCallback(() => {
    if (!playoffMatchups.length) return;
    const ctxByTeamId = new Map(
      standings.map((row) => [row.team_id, { position: row.position, goalDiff: row.goal_diff }]),
    );
    setLocalData((prev) => {
      const updated = { ...prev, playoffPredictions: { ...prev.playoffPredictions } };
      for (const pm of playoffMatchups) {
        updated.playoffPredictions[pm.matchup_index] = {
          // Field names are seed-relative: leg1_home_goals belongs to the
          // higher seed (home_team), who plays leg 1 AWAY (see PlayoffBracket).
          leg1_home_goals: randomGoals(pm.home_team, pm.away_team, ctxByTeamId.get(pm.home_team.team_id) ?? null),
          leg1_away_goals: randomGoals(pm.away_team, pm.home_team, ctxByTeamId.get(pm.away_team.team_id) ?? null),
          leg2_home_goals: randomGoals(pm.home_team, pm.away_team, ctxByTeamId.get(pm.home_team.team_id) ?? null),
          leg2_away_goals: randomGoals(pm.away_team, pm.home_team, ctxByTeamId.get(pm.away_team.team_id) ?? null),
        };
      }
      saveLocal(seasonId, playerName, updated, latestDrawSeed);
      return updated;
    });
  }, [playoffMatchups, standings, seasonId, playerName, latestDrawSeed]);

  const handleRandomizeKnockout = useCallback(() => {
    const ctxByTeamId = new Map(
      standings.map((row) => [row.team_id, { position: row.position, goalDiff: row.goal_diff }]),
    );
    setLocalData((prev) => {
      const updated = { ...prev, knockoutPredictions: { ...prev.knockoutPredictions } };
      for (const roundMatches of Object.values(knockoutBracket)) {
        for (const m of roundMatches) {
          if (!m.home_team || !m.away_team) continue; // TBD slot (R16 before playoffs resolve)
          const key = `${m.round}_${m.bracket_position}`;
          updated.knockoutPredictions[key] = {
            round: m.round,
            bracket_position: m.bracket_position,
            home_goals: randomGoals(m.home_team, m.away_team, ctxByTeamId.get(m.home_team.team_id) ?? null),
            away_goals: randomGoals(m.away_team, m.home_team, ctxByTeamId.get(m.away_team.team_id) ?? null),
          };
        }
      }
      saveLocal(seasonId, playerName, updated, latestDrawSeed);
      return updated;
    });
  }, [knockoutBracket, standings, seasonId, playerName, latestDrawSeed]);

  const handleSavePlayoffs = useCallback(async () => {
    if (!remotePrediction) return;
    setSavingPlayoffs(true);
    try {
      const predictions = playoffMatchups
        .filter((pm) => {
          const p = localData.playoffPredictions[pm.matchup_index];
          return p
            && p.leg1_home_goals != null && p.leg1_away_goals != null
            && p.leg2_home_goals != null && p.leg2_away_goals != null;
        })
        .map((pm) => {
          const p = localData.playoffPredictions[pm.matchup_index];
          return {
            matchup_index: pm.matchup_index,
            home_team: pm.home_team.team_id,
            away_team: pm.away_team.team_id,
            leg1_home_goals: p.leg1_home_goals,
            leg1_away_goals: p.leg1_away_goals,
            leg2_home_goals: p.leg2_home_goals,
            leg2_away_goals: p.leg2_away_goals,
          };
        });

      if (predictions.length > 0) {
        await apiFetch(`/predictions/${remotePrediction.id}/playoffs/sync/`, {
          method: 'POST',
          body: JSON.stringify({ predictions }),
        });
      }

      if (playoffsComplete) {
        await apiFetch(`/predictions/${remotePrediction.id}/`, {
          method: 'PATCH',
          body: JSON.stringify({ is_playoffs_complete: true }),
        });
      }
    } catch (e) {
      setError('Failed to save playoffs: ' + e.message);
    } finally {
      setSavingPlayoffs(false);
    }
  }, [remotePrediction, playoffMatchups, localData.playoffPredictions, playoffsComplete]);

  const handleSaveKnockout = useCallback(async () => {
    if (!remotePrediction || !knockoutComplete) return;
    setSavingKnockout(true);
    try {
      // Knockout scores are local-only by design; only the completion flag is synced.
      await apiFetch(`/predictions/${remotePrediction.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ is_knockout_complete: true }),
      });
    } catch (e) {
      setError('Failed to save knockout: ' + e.message);
    } finally {
      setSavingKnockout(false);
    }
  }, [remotePrediction, knockoutComplete]);

  return (
    <div className="prediction-app">
      <div className="view-tabs prediction-tabs">
        {SUB_TABS.map(([key, label]) => (
          <button
            key={key}
            className={subTab === key ? 'active' : ''}
            onClick={() => setSubTab(key)}
            disabled={key === 'playoffs' && matchups.length > 0 && Object.keys(validPredictions).length < matchups.length * 0.5}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <div className="message-bar error">{error}</div>}

      <section className="content-grid">
        <div className="primary-column">
          {subTab === 'scores' && (
            <>
              <div className="command-band">
                <div>
                  <h2>Enter your League Phase predictions</h2>
                  <p>Fill in scores for each fixture. The standings update live as you type.</p>
                </div>
                <span className="muted">
                  {Object.values(validPredictions).filter(v => v.home_goals != null).length}/{matchups.length} scored
                </span>
                {leagueComplete && (
                  <button className="button secondary" onClick={() => setSubTab('playoffs')}>
                    Continue to Playoffs →
                  </button>
                )}
              </div>
              <MatchdayScoreBoard
                matchups={matchups}
                matchPredictions={matchPredictions}
                onScoreChange={handleScoreChange}
                currentMatchday={currentMatchday}
                onMatchdayChange={handleMatchdayChange}
                onSave={handleSaveMatchday}
                isSaving={savingMatchday}
                onRandomize={handleRandomizeMatchday}
              />
            </>
          )}

          {subTab === 'standings' && (
            <LeagueTable teams={seasonState?.teams} matchPredictions={validPredictions} />
          )}

          {subTab === 'playoffs' && (
            <>
              <div className="command-band">
                <div>
                  <h2>Playoff predictions</h2>
                  <p>Score both legs of each two-legged tie. The lower seed hosts leg 1.</p>
                </div>
                <button
                  className="button primary"
                  onClick={handleSavePlayoffs}
                  disabled={savingPlayoffs || !playoffMatchups.length}
                >
                  {savingPlayoffs ? 'Saving...' : 'Save Playoffs'}
                </button>
                {playoffsComplete && (
                  <button className="button secondary" onClick={() => setSubTab('bracket')}>
                    Continue to Knockout →
                  </button>
                )}
                <button className="button secondary" onClick={handleRandomizePlayoffs} disabled={!playoffMatchups.length}>
                  Randomize
                </button>
              </div>
              <PlayoffBracket
                matchups={playoffMatchups}
                onScoreChange={handlePlayoffScoreChange}
              />
            </>
          )}

          {subTab === 'bracket' && (
            <>
              <div className="command-band">
                <div>
                  <h2>Knockout predictions</h2>
                  <p>Score each single-leg knockout match. Winners advance automatically.</p>
                </div>
                <button
                  className="button primary"
                  onClick={handleSaveKnockout}
                  disabled={savingKnockout || !knockoutComplete}
                >
                  {savingKnockout ? 'Saving...' : 'Save Knockout'}
                </button>
                <button
                  className="button secondary"
                  onClick={handleRandomizeKnockout}
                  disabled={!Object.values(knockoutBracket).some((round) => round.some((m) => m.home_team && m.away_team))}
                >
                  Randomize
                </button>
                {knockoutComplete && (
                  <span className="muted">Knockout complete — champion crowned</span>
                )}
              </div>
              <KnockoutBracket
                bracket={knockoutBracket}
                onScoreChange={handleKnockoutScoreChange}
              />
            </>
          )}
        </div>

        <aside className="inspector prediction-sidebar">
          <div className="sidebar-standings">
            <div className="sidebar-standings-header">
              <strong>Live Standings</strong>
              <span className="muted">
                {Object.values(validPredictions).filter(v => v.home_goals != null).length}/{matchups.length} played
              </span>
            </div>
            <div className="sidebar-standings-scroll">
              <table className="sidebar-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Team</th>
                    <th>Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.slice(0, 36).map((row) => {
                    let cls = '';
                    if (row.position <= 8) cls = 'r-qual';
                    else if (row.position <= 24) cls = 'r-play';
                    else cls = 'r-elim';
                    return (
                      <tr className={cls} key={row.team_id}>
                        <td className="sp">{row.position}</td>
                        <td className="st">
                          <span className="team-logo xs">
                            {row.team?.logo_url
                              ? <img src={row.team.logo_url} alt="" />
                              : row.team?.short_name?.slice(0, 3)}
                          </span>
                          {row.team?.short_name || row.short_name}
                        </td>
                        <td className="spts">{row.points}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="sidebar-legend">
              <span><span className="sq" /> 1-8</span>
              <span><span className="sp" /> 9-24</span>
              <span><span className="se" /> 25-36</span>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function randomGoals(team, opponent, ctx = null) {
  const strengthTeam = ctx ? teamStrength(team) + eliminationBoost(team, ctx) : teamStrength(team);
  const strengthOpp = ctx ? teamStrength(opponent) + eliminationBoost(opponent, ctx) : teamStrength(opponent);
  const lambda = expectedGoals(strengthTeam, strengthOpp);
  // defense-aware cap so elite defenses rarely ship 4-5
  const maxGoalsFor = 3 + Math.round(2 * (1 - defenseNorm(opponent)));
  return Math.min(samplePoisson(lambda), maxGoalsFor);
}

// Knuth's exact Poisson sampler; expectedGoals clamps lambda to [0.15, 5.5],
// and the 0..6 clamp is the same ceiling the old shifted-array had.
function samplePoisson(lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= Math.random();
  } while (p > L);
  return Math.min(k - 1, 6);
}

function computePlayoffWinner(l1h, l1a, l2h, l2a, homeId, awayId) {
  if ([l1h, l1a, l2h, l2a].some(v => v == null)) return null;
  const aggHome = l1h + l2h;
  const aggAway = l1a + l2a;
  if (aggHome > aggAway) return homeId;
  if (aggAway > aggHome) return awayId;
  if (l2a > l1h) return awayId;
  if (l1h > l2a) return homeId;
  return homeId;
}
