import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Button from '../components/Button';
import SegmentControl from '../components/SegmentControl';
import StandingsTable from '../components/StandingsTable';
import MatchdayScoreBoard from '../components/MatchdayScoreBoard';
import PlayoffBracket from '../components/PlayoffBracket';
import KnockoutBracket from '../components/KnockoutBracket';
import { loadLocal, saveLocal } from '../lib/predictionStorage';
import { useReconciliation } from '../lib/useReconciliation';
import { computeStandings, defenseNorm, eliminationBoost, expectedGoals, teamStrength } from '../lib/standingsCalc';
import { predictMatch } from '../lib/matchOdds';
import { ErrorState, Skeleton } from '../components/States';

const SUB_TABS = [
  ['scores', 'Score Matches'],
  ['standings', 'Standings'],
  ['playoffs', 'Playoffs'],
  ['bracket', 'Bracket'],
];

/* The manual save and the 30s auto-sync post the same data to the same endpoint,
   so both failures read the same and name the same retry — Save Matchday
   (task 4.3's copy, kept verbatim; task 4.1 removed the auto-sync's silence). */
function saveFailureCopy(err) {
  return `Save failed: ${err.message}. Your scores are still here — use Save Matchday to retry.`;
}

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
  /* Bumped only after a successful bulk sync (`/sync/` or `/playoffs/sync/`).
     Reconciliation's post-sync trigger rides on it; edits never touch it. */
  const [syncRevision, setSyncRevision] = useState(0);
  /* `{ kind, message }` — the kind picks the retry, so a failed write can only
     ever re-issue the write that failed (US:no-silent-failure). */
  const [error, setError] = useState(null);
  const [createStatus, setCreateStatus] = useState('idle');
  const [createError, setCreateError] = useState('');
  const syncTimer = useRef(null);
  /* One writer at a time (task 4.3): the manual save and the 30s auto-sync post
     the same sync endpoint, so whichever is in flight blocks the other. A ref,
     not state, because the interval callback's closure is rebuilt on each render
     and must not read a stale in-flight flag. */
  const writeInFlight = useRef(false);

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

  // Create/get remote prediction on mount. Its own three states: the sheet
  // cannot save anything without this record, so pending and failed are shown
  // instead of an inert grid (US:four-state-contract).
  const createPrediction = useCallback(async () => {
    if (!seasonId || !playerName) return;
    setCreateStatus('loading');
    setCreateError('');
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
      setCreateStatus('success');
    } catch (e) {
      setCreateStatus('error');
      setCreateError(e.message);
    }
  }, [seasonId, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    createPrediction();
  }, [createPrediction]);

  // Periodic sync to backend
  useEffect(() => {
    if (!remotePrediction) return;
    syncTimer.current = setInterval(() => {
      syncToBackend();
    }, 30000);
    return () => clearInterval(syncTimer.current);
  }, [remotePrediction, localData]);

  const syncToBackend = useCallback(async () => {
    if (!remotePrediction || writeInFlight.current) return;
    writeInFlight.current = true;
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
        setSyncRevision((r) => r + 1);
      }
      setError(null);
    } catch (e) {
      /* Not silent (task 4.1): the auto-sync writes the same scores as the
         manual save, so it reports the same failure and the same retry. */
      setError({ kind: 'matchday', message: saveFailureCopy(e) });
    } finally {
      writeInFlight.current = false;
      setSyncing(false);
    }
  }, [remotePrediction, validPredictions]);

  const handleSaveMatchday = useCallback(async () => {
    if (!remotePrediction || writeInFlight.current) return;
    writeInFlight.current = true;
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
      setSyncRevision((r) => r + 1);

      setError(null);

      // Move to next matchday if not on the last one
      if (currentMatchday < 8) {
        const next = currentMatchday + 1;
        setCurrentMatchday(next);
        persistMatchday(next);
      }
    } catch (e) {
      /* Nothing was cleared: the scores are still in the inputs and the Save
         control is still there, so the copy says both — what failed, what is
         safe, and how to retry (Design.md §10–§11). */
      setError({ kind: 'matchday', message: saveFailureCopy(e) });
    } finally {
      writeInFlight.current = false;
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

  // Fill only unscored fixtures with the modal scoreline of the joint Poisson
  // model. Unlike Randomize, Predict never overwrites a manual pick.
  const handlePredictMatchday = useCallback((matchday) => {
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
        const existing = updated.matchPredictions[f.id] || {};
        if (existing.home_goals != null && existing.away_goals != null) continue;
        const [hg, ag] = predictMatch(f.home_team, f.away_team).modal_score;
        updated.matchPredictions[f.id] = {
          ...existing,
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
      const etH = stored.et_home_goals ?? null;
      const etA = stored.et_away_goals ?? null;
      const penH = stored.pen_home_goals ?? null;
      const penA = stored.pen_away_goals ?? null;
      const winnerId = computePlayoffWinner(l1h, l1a, l2h, l2a, home.team_id, away.team_id, etH, etA, penH, penA);
      const winnerTeam = winnerId === home.team_id ? home.team : (winnerId === away.team_id ? away.team : null);
      return {
        matchup_index: idx + 1,
        home_team: home.team,
        away_team: away.team,
        leg1_home_goals: l1h,
        leg1_away_goals: l1a,
        leg2_home_goals: l2h,
        leg2_away_goals: l2a,
        extra_time: stored.extra_time || false,
        penalties: stored.penalties || false,
        et_home_goals: etH,
        et_away_goals: etA,
        pen_home_goals: penH,
        pen_away_goals: penA,
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
        extra_time: stored.extra_time || false,
        penalties: stored.penalties || false,
        et_home_goals: stored.et_home_goals ?? null,
        et_away_goals: stored.et_away_goals ?? null,
        pen_home_goals: stored.pen_home_goals ?? null,
        pen_away_goals: stored.pen_away_goals ?? null,
        winner: stored.winner || null,
      };
    }).filter(Boolean);

    const advanceR16 = (bp) => {
      const match = r16.find(m => m.bracket_position === bp);
      if (!match) return null;
      if (match.winner) return match.winner;
      const { home_team: ht, away_team: at } = match;
      if (!ht || !at) return null;
      const wId = computeKnockoutWinner(
        match.home_goals, match.away_goals, ht.team_id, at.team_id,
        match.et_home_goals, match.et_away_goals,
        match.pen_home_goals, match.pen_away_goals,
      );
      return wId === ht.team_id ? ht : (wId === at.team_id ? at : null);
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
        extra_time: stored.extra_time || false,
        penalties: stored.penalties || false,
        et_home_goals: stored.et_home_goals ?? null,
        et_away_goals: stored.et_away_goals ?? null,
        pen_home_goals: stored.pen_home_goals ?? null,
        pen_away_goals: stored.pen_away_goals ?? null,
        winner: stored.winner || null,
      };
    }).filter(Boolean);

    const advanceQF = (bp) => {
      const match = qf.find(m => m.bracket_position === bp);
      if (!match) return null;
      if (match.winner) return match.winner;
      const { home_team: ht, away_team: at } = match;
      if (!ht || !at) return null;
      const wId = computeKnockoutWinner(
        match.home_goals, match.away_goals, ht.team_id, at.team_id,
        match.et_home_goals, match.et_away_goals,
        match.pen_home_goals, match.pen_away_goals,
      );
      return wId === ht.team_id ? ht : (wId === at.team_id ? at : null);
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
        extra_time: stored.extra_time || false,
        penalties: stored.penalties || false,
        et_home_goals: stored.et_home_goals ?? null,
        et_away_goals: stored.et_away_goals ?? null,
        pen_home_goals: stored.pen_home_goals ?? null,
        pen_away_goals: stored.pen_away_goals ?? null,
        winner: stored.winner || null,
      };
    }).filter(Boolean);

    const advanceSF = (bp) => {
      const match = sf.find(m => m.bracket_position === bp);
      if (!match) return null;
      if (match.winner) return match.winner;
      const { home_team: ht, away_team: at } = match;
      if (!ht || !at) return null;
      const wId = computeKnockoutWinner(
        match.home_goals, match.away_goals, ht.team_id, at.team_id,
        match.et_home_goals, match.et_away_goals,
        match.pen_home_goals, match.pen_away_goals,
      );
      return wId === ht.team_id ? ht : (wId === at.team_id ? at : null);
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
      extra_time: finalStored.extra_time || false,
      penalties: finalStored.penalties || false,
      et_home_goals: finalStored.et_home_goals ?? null,
      et_away_goals: finalStored.et_away_goals ?? null,
      pen_home_goals: finalStored.pen_home_goals ?? null,
      pen_away_goals: finalStored.pen_away_goals ?? null,
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

  /* Observe-only confirmation (tasks 6.3/6.4): GET-only, 30s per surface, silent
     to users. None of these returned values is rendered, so reconciliation can
     never gate or delay the surfaces. */
  const predictionId = remotePrediction?.id;
  useReconciliation('standings', { predictionId, clientValue: standings, revision: syncRevision });
  useReconciliation('playoffs', { predictionId, clientValue: playoffMatchups, revision: syncRevision });
  useReconciliation('knockout', { predictionId, clientValue: knockoutBracket, revision: syncRevision });

  const handleRandomizePlayoffs = useCallback(() => {
    if (!playoffMatchups.length) return;
    const ctxByTeamId = new Map(
      standings.map((row) => [row.team_id, { position: row.position, goalDiff: row.goal_diff }]),
    );
    setLocalData((prev) => {
      const updated = { ...prev, playoffPredictions: { ...prev.playoffPredictions } };
      for (const pm of playoffMatchups) {
        const l1h = randomGoals(pm.home_team, pm.away_team, ctxByTeamId.get(pm.home_team.team_id) ?? null);
        const l1a = randomGoals(pm.away_team, pm.home_team, ctxByTeamId.get(pm.away_team.team_id) ?? null);
        const l2h = randomGoals(pm.home_team, pm.away_team, ctxByTeamId.get(pm.home_team.team_id) ?? null);
        const l2a = randomGoals(pm.away_team, pm.home_team, ctxByTeamId.get(pm.away_team.team_id) ?? null);
        const pred = {
          leg1_home_goals: l1h,
          leg1_away_goals: l1a,
          leg2_home_goals: l2h,
          leg2_away_goals: l2a,
          extra_time: false,
          penalties: false,
          et_home_goals: null,
          et_away_goals: null,
          pen_home_goals: null,
          pen_away_goals: null,
        };
        // Check if aggregate tied — need extra time
        if (l1h + l2h === l1a + l2a) {
          pred.extra_time = true;
          pred.et_home_goals = randomGoals(pm.home_team, pm.away_team, ctxByTeamId.get(pm.home_team.team_id) ?? null);
          pred.et_away_goals = randomGoals(pm.away_team, pm.home_team, ctxByTeamId.get(pm.away_team.team_id) ?? null);
          // Still tied after ET — need penalties
          if (l1h + l2h + pred.et_home_goals === l1a + l2a + pred.et_away_goals) {
            pred.penalties = true;
            pred.pen_home_goals = 3 + Math.floor(Math.random() * 4);
            pred.pen_away_goals = 3 + Math.floor(Math.random() * 4);
            // Ensure pens aren't tied
            if (pred.pen_home_goals === pred.pen_away_goals) pred.pen_away_goals += 1;
          }
        }
        updated.playoffPredictions[pm.matchup_index] = pred;
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
          const hg = randomGoals(m.home_team, m.away_team, ctxByTeamId.get(m.home_team.team_id) ?? null);
          const ag = randomGoals(m.away_team, m.home_team, ctxByTeamId.get(m.away_team.team_id) ?? null);
          const pred = {
            round: m.round,
            bracket_position: m.bracket_position,
            home_goals: hg,
            away_goals: ag,
            extra_time: false,
            penalties: false,
            et_home_goals: null,
            et_away_goals: null,
            pen_home_goals: null,
            pen_away_goals: null,
          };
          // Tied at 90 — need extra time
          if (hg === ag) {
            pred.extra_time = true;
            pred.et_home_goals = randomGoals(m.home_team, m.away_team, ctxByTeamId.get(m.home_team.team_id) ?? null);
            pred.et_away_goals = randomGoals(m.away_team, m.home_team, ctxByTeamId.get(m.away_team.team_id) ?? null);
            // Still tied after ET — penalties
            if (hg + pred.et_home_goals === ag + pred.et_away_goals) {
              pred.penalties = true;
              pred.pen_home_goals = 3 + Math.floor(Math.random() * 4);
              pred.pen_away_goals = 3 + Math.floor(Math.random() * 4);
              if (pred.pen_home_goals === pred.pen_away_goals) pred.pen_away_goals += 1;
            }
          }
          updated.knockoutPredictions[key] = pred;
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
            extra_time: p.extra_time || false,
            penalties: p.penalties || false,
            et_home_goals: p.et_home_goals ?? null,
            et_away_goals: p.et_away_goals ?? null,
            pen_home_goals: p.pen_home_goals ?? null,
            pen_away_goals: p.pen_away_goals ?? null,
          };
        });

      if (predictions.length > 0) {
        await apiFetch(`/predictions/${remotePrediction.id}/playoffs/sync/`, {
          method: 'POST',
          body: JSON.stringify({ predictions }),
        });
        setSyncRevision((r) => r + 1);
      }

      if (playoffsComplete) {
        await apiFetch(`/predictions/${remotePrediction.id}/`, {
          method: 'PATCH',
          body: JSON.stringify({ is_playoffs_complete: true }),
        });
      }
      setError(null);
    } catch (e) {
      setError({
        kind: 'playoffs',
        message: `Failed to save playoffs: ${e.message}. Your picks are still here — use Save Playoffs to retry.`,
      });
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
      setError(null);
    } catch (e) {
      setError({
        kind: 'knockout',
        message: `Failed to save knockout: ${e.message}. Your picks are still here — use Save Knockout to retry.`,
      });
    } finally {
      setSavingKnockout(false);
    }
  }, [remotePrediction, knockoutComplete]);

  /* Pending and failed create own the whole tab; retry re-issues only the POST
     that failed. The skeleton keeps the sheet's settled dimensions. */
  if (createStatus === 'loading') {
    return (
      <div className="prediction-app">
        <Skeleton rows={6} label="Starting your prediction sheet" />
      </div>
    );
  }

  if (createStatus === 'error') {
    return (
      <div className="prediction-app">
        <ErrorState
          title="Your prediction sheet could not start"
          detail={createError}
          onRetry={createPrediction}
          retryLabel="Retry predictions"
        />
      </div>
    );
  }

  /* A failed write is retried by its own writer — never by re-issuing the others. */
  const writeError = error && {
    matchday: { title: 'Predictions could not be saved', retry: handleSaveMatchday, retryLabel: 'Save Matchday' },
    playoffs: { title: 'Playoff predictions could not be saved', retry: handleSavePlayoffs, retryLabel: 'Save Playoffs' },
    knockout: { title: 'Knockout predictions could not be saved', retry: handleSaveKnockout, retryLabel: 'Save Knockout' },
  }[error.kind];

  return (
    <div className="prediction-app">
      <SegmentControl
        className="view-tabs prediction-tabs"
        label="Prediction sections"
        value={subTab}
        onChange={setSubTab}
        items={SUB_TABS.map(([key, label]) => ({
          key,
          label,
          disabled:
            key === 'playoffs'
            && matchups.length > 0
            && Object.keys(validPredictions).length < matchups.length * 0.5,
        }))}
      />

      {writeError && (
        <ErrorState
          title={writeError.title}
          detail={error.message}
          onRetry={writeError.retry}
          retryLabel={writeError.retryLabel}
        />
      )}

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
                  <Button onClick={() => setSubTab('playoffs')}>
                    Continue to Playoffs →
                  </Button>
                )}
              </div>
              <MatchdayScoreBoard
                matchups={matchups}
                matchPredictions={matchPredictions}
                onScoreChange={handleScoreChange}
                currentMatchday={currentMatchday}
                onMatchdayChange={handleMatchdayChange}
                onSave={handleSaveMatchday}
                isSaving={savingMatchday || syncing}
                onRandomize={handleRandomizeMatchday}
                onPredict={handlePredictMatchday}
              />
            </>
          )}

          {subTab === 'standings' && (
            <div className="league-table-wrap">
              <h3 className="section-title">League Phase Standings</h3>
              <StandingsTable
                rows={standings}
                variant="league"
                nameMode="short"
                playedHeader="Pld"
                legend="league"
                scrollClassName="league-table-scroll"
              />
            </div>
          )}

          {subTab === 'playoffs' && (
            <>
              <div className="command-band">
                <div>
                  <h2>Playoff predictions</h2>
                  <p>Score both legs of each two-legged tie. The lower seed hosts leg 1.</p>
                </div>
                <Button
                  variant="primary"
                  onClick={handleSavePlayoffs}
                  disabled={savingPlayoffs || !playoffMatchups.length}
                >
                  {savingPlayoffs ? 'Saving...' : 'Save Playoffs'}
                </Button>
                {playoffsComplete && (
                  <Button onClick={() => setSubTab('bracket')}>
                    Continue to Knockout →
                  </Button>
                )}
                <Button onClick={handleRandomizePlayoffs} disabled={!playoffMatchups.length}>
                  Randomize
                </Button>
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
                <Button
                  variant="primary"
                  onClick={handleSaveKnockout}
                  disabled={savingKnockout || !knockoutComplete}
                >
                  {savingKnockout ? 'Saving...' : 'Save Knockout'}
                </Button>
                <Button
                  onClick={handleRandomizeKnockout}
                  disabled={!Object.values(knockoutBracket).some((round) => round.some((m) => m.home_team && m.away_team))}
                >
                  Randomize
                </Button>
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
            <StandingsTable
              rows={standings.slice(0, 36)}
              variant="sidebar"
              nameMode="short"
              legend="sidebar"
              scrollClassName="sidebar-standings-scroll"
            />
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

function computePlayoffWinner(l1h, l1a, l2h, l2a, homeId, awayId, etHome, etAway, penHome, penAway) {
  if ([l1h, l1a, l2h, l2a].some(v => v == null)) return null;
  let aggHome = l1h + l2h;
  let aggAway = l1a + l2a;
  if (aggHome > aggAway) return homeId;
  if (aggAway > aggHome) return awayId;

  // Aggregate tied — apply extra time (played in leg 2)
  if (etHome != null && etAway != null) {
    aggHome += etHome;
    aggAway += etAway;
    if (aggHome > aggAway) return homeId;
    if (aggAway > aggHome) return awayId;

    // Still tied — apply penalties
    if (penHome != null && penAway != null) {
      if (penHome > penAway) return homeId;
      if (penAway > penHome) return awayId;
    }
  }

  return null; // tied, no tiebreaker data yet
}

function computeKnockoutWinner(hg, ag, homeId, awayId, etH, etA, penH, penA) {
  if (hg == null || ag == null) return null;
  if (hg > ag) return homeId;
  if (ag > hg) return awayId;

  // Tied at 90 — apply extra time
  if (etH != null && etA != null) {
    const totalH = hg + etH;
    const totalA = ag + etA;
    if (totalH > totalA) return homeId;
    if (totalA > totalH) return awayId;

    // Still tied — apply penalties
    if (penH != null && penA != null) {
      if (penH > penA) return homeId;
      if (penA > penH) return awayId;
    }
  }

  return null; // tied, need tiebreaker data
}
