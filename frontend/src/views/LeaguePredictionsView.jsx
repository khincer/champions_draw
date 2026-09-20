import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import FixtureRow from '../components/FixtureRow';
import SegmentControl from '../components/SegmentControl';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import ScoreInput from '../ScoreInput';
import { setPlayerName as persistPlayerName } from '../predictionStorage';

const SYNC_DELAY_MS = 1200;
const VERDICT_LABEL = { exact: 'Exact', outcome: 'Outcome', miss: 'Miss' };

// Per-league, per-player pick store, following the predictionStorage key
// convention. The shape is { [match_id]: {home_goals, away_goals} }.
const LEAGUE_STORAGE_PREFIX = 'champions_draw_league_prediction_';

function loadLeaguePredLocal(leagueId, playerName) {
  try {
    const raw = localStorage.getItem(`${LEAGUE_STORAGE_PREFIX}${leagueId}_${playerName || 'Guest'}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveLeaguePredLocal(leagueId, playerName, predictions) {
  try {
    localStorage.setItem(
      `${LEAGUE_STORAGE_PREFIX}${leagueId}_${playerName || 'Guest'}`,
      JSON.stringify(predictions || {}),
    );
  } catch {
    // localStorage might be full or unavailable
  }
}

function formatKickoff(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/* The API flattens teams into home_name / away_name fields; FixtureRow expects
   the shared team shape. */
function sideTeam(match, side) {
  return {
    name: match[`${side}_name`],
    short_name: match[`${side}_short`] || match[`${side}_name`],
    logo_url: match[`${side}_crest`] || '',
  };
}

function verdictFor(pred, result) {
  if (!result || !pred || pred.home_goals == null || pred.away_goals == null) return null;
  const ph = Number(pred.home_goals);
  const pa = Number(pred.away_goals);
  const rh = Number(result.home_goals);
  const ra = Number(result.away_goals);
  if (![ph, pa, rh, ra].every(Number.isFinite)) return null;
  if (ph === rh && pa === ra) return 'exact';
  return Math.sign(ph - pa) === Math.sign(rh - ra) ? 'outcome' : 'miss';
}

function pickSummary(pred) {
  if (!pred || pred.home_goals == null || pred.away_goals == null) return null;
  return `${pred.home_goals}\u2013${pred.away_goals}`;
}

export default function LeaguePredictionsView({
  leagues,
  leaguesStatus,
  leaguesError,
  onRetryLeagues,
  playerName,
  setPlayerName,
  apiFetch,
}) {
  // Only real League rows are pickable; CONMEBOL "season-…" entries have no
  // LeagueMatch rows.
  const leagueOptions = useMemo(
    () => (leagues || []).filter((league) => typeof league.id === 'number'),
    [leagues],
  );

  const [leagueId, setLeagueId] = useState('');
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [preds, setPreds] = useState({});
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncError, setSyncError] = useState('');
  const predsRef = useRef(preds);
  const dataRef = useRef(null);
  const syncTimer = useRef(null);

  useEffect(() => {
    if (!leagueId && leagueOptions.length) setLeagueId(String(leagueOptions[0].id));
  }, [leagueOptions, leagueId]);

  const loadFixtures = useCallback(async () => {
    if (!leagueId) return;
    setStatus('loading');
    setError('');
    try {
      setData(await apiFetch(`/leagues/${leagueId}/predictions/`));
      setStatus('success');
    } catch (err) {
      setError(err.message);
      setStatus('error');
    }
  }, [leagueId, apiFetch]);

  useEffect(() => {
    if (!leagueId) return;
    setData(null);
    loadFixtures();
  }, [leagueId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPreds(loadLeaguePredLocal(leagueId, playerName) || {});
  }, [leagueId, playerName]);

  useEffect(() => {
    predsRef.current = preds;
  }, [preds]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Pull saved picks once per player/league; local (possibly unsaved) values
  // win for ids already present.
  useEffect(() => {
    const name = (playerName || '').trim();
    if (!leagueId || !name) return undefined;
    let cancelled = false;
    apiFetch(`/leagues/${leagueId}/predictions/?player_name=${encodeURIComponent(name)}`)
      .then((remote) => {
        if (cancelled || !remote) return;
        const remoteById = {};
        for (const match of [...(remote.upcoming || []), ...(remote.finished || [])]) {
          if (match.prediction) remoteById[match.id] = match.prediction;
        }
        setPreds((prev) => {
          const merged = { ...prev };
          for (const id of Object.keys(remoteById)) {
            if (merged[id] == null) {
              merged[id] = {
                home_goals: remoteById[id].home_goals ?? undefined,
                away_goals: remoteById[id].away_goals ?? undefined,
              };
            }
          }
          return merged;
        });
      })
      .catch(() => {
        // Backend unavailable: localStorage stays the source of truth.
      });
    return () => { cancelled = true; };
  }, [leagueId, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Only open fixtures go in a PUT: a batch that includes any closed fixture is
     rejected whole, and the merged remote picks include finished matches. */
  function openEntries(predictions) {
    const fixtures = dataRef.current;
    const open = new Set(
      [...(fixtures?.upcoming || []), ...(fixtures?.finished || [])]
        .filter((match) => !match.closed)
        .map((match) => match.id),
    );
    return Object.entries(predictions).filter(([id]) => open.has(Number(id)));
  }

  async function syncNow(predictions) {
    const name = (playerName || '').trim();
    if (!leagueId || !name) return;
    setSyncStatus('saving');
    setSyncError('');
    try {
      await apiFetch(`/leagues/${leagueId}/predictions/`, {
        method: 'PUT',
        body: JSON.stringify({
          player_name: name,
          predictions: openEntries(predictions).map(([id, value]) => ({
            match_id: Number(id),
            home_goals: value.home_goals ?? null,
            away_goals: value.away_goals ?? null,
          })),
        }),
      });
      setSyncStatus('success');
    } catch (err) {
      if (err.status === 400) {
        setSyncStatus('success'); // closed batch: expected, nothing to retry
        return;
      }
      setSyncError(err.message);
      setSyncStatus('error');
    }
  }

  function scheduleSync(predictions) {
    if (!leagueId || !(playerName || '').trim()) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncNow(predictions); }, SYNC_DELAY_MS);
  }

  function handleChange(matchId, field, value) {
    const updated = {
      ...predsRef.current,
      [matchId]: { ...(predsRef.current[matchId] || {}), [field]: value },
    };
    saveLeaguePredLocal(leagueId, playerName, updated);
    setPreds(updated);
    scheduleSync(updated);
  }

  const leagueItems = useMemo(
    () => leagueOptions.map((league) => ({
      key: String(league.id),
      label: (
        <span className="homepage-filter-label">
          {league.emblem_url ? <img className="homepage-filter-emblem" src={league.emblem_url} alt="" /> : null}
          {league.name}
        </span>
      ),
    })),
    [leagueOptions],
  );

  const upcoming = data?.upcoming || [];
  const finished = data?.finished || [];
  const selectedLeague = leagueOptions.find((league) => String(league.id) === leagueId);

  function renderInputRow(match) {
    const pred = preds[match.id] || {};
    return (
      <FixtureRow
        key={match.id}
        className="score-row"
        status={formatKickoff(match.kickoff)}
        statusTitle={formatKickoff(match.kickoff)}
        home={sideTeam(match, 'home')}
        away={sideTeam(match, 'away')}
        nameMode="full"
        center={
          <div className="score-group">
            <ScoreInput
              value={pred.home_goals}
              onChange={(value) => handleChange(match.id, 'home_goals', value)}
              label={`Home goals, ${match.home_name} versus ${match.away_name}`}
            />
            <span className="score-sep">&ndash;</span>
            <ScoreInput
              value={pred.away_goals}
              onChange={(value) => handleChange(match.id, 'away_goals', value)}
              label={`Away goals, ${match.home_name} versus ${match.away_name}`}
            />
          </div>
        }
      />
    );
  }

  function renderResultRow(match) {
    const pred = preds[match.id];
    const verdict = verdictFor(pred, match.result);
    const pick = pickSummary(pred);
    const score = match.result ? `${match.result.home_goals}\u2013${match.result.away_goals}` : 'Awaiting result';
    return (
      <FixtureRow
        key={match.id}
        className="score-row"
        status={match.result ? 'Final' : 'Locked'}
        statusTone={match.result ? undefined : 'waiting'}
        statusTitle={formatKickoff(match.kickoff)}
        home={sideTeam(match, 'home')}
        away={sideTeam(match, 'away')}
        nameMode="full"
        center={
          <div className="score-group real-result">
            <span className="real-score">{score}</span>
            {pick ? (
              <span className={`fx-verdict ${verdict || 'live'}`}>
                {verdict ? `${VERDICT_LABEL[verdict]} \u00b7 your pick ${pick}` : `Your pick ${pick}`}
              </span>
            ) : null}
          </div>
        }
      />
    );
  }

  return (
    <section className="workspace">
      <div className="command-band">
        <div>
          <h1>Match picks</h1>
          <p>
            Predict the exact score of each fixture, one pick per match. Finished
            matches lock and show the real result next to your pick.
          </p>
        </div>
        <div className="draw-controls">
          <label className="seed-input">
            <span>Player name</span>
            <input
              value={playerName}
              maxLength={80}
              placeholder="Your name"
              onInput={(event) => {
                const value = event.currentTarget.value;
                setPlayerName(value);
                persistPlayerName(value);
              }}
            />
          </label>
        </div>
      </div>

      {leaguesStatus === 'error' ? (
        <ErrorState
          title="Leagues could not load"
          detail={leaguesError}
          onRetry={onRetryLeagues}
          retryLabel="Retry leagues"
        />
      ) : leaguesStatus === 'loading' || leaguesStatus === 'idle' ? (
        <Skeleton rows={4} label="Loading leagues" />
      ) : !leagueOptions.length ? (
        <EmptyState
          title="No leagues available"
          text="Real leagues appear here once fixtures have been synced."
        />
      ) : (
        <>
          <SegmentControl
            items={leagueItems}
            value={leagueId}
            onChange={setLeagueId}
            className="segment-control homepage-filter"
            label="Filter by league"
          />

          {status === 'error' ? (
            <ErrorState
              title="Fixtures could not load"
              detail={error}
              onRetry={loadFixtures}
              retryLabel="Retry fixtures"
            />
          ) : !data ? (
            <Skeleton rows={6} variant="fixture" label="Loading fixtures" />
          ) : (
            <>
              {syncError ? (
                <ErrorState
                  title="Your picks could not be saved"
                  detail={`${syncError}. Your picks are still on this device — retry to sync them.`}
                  onRetry={() => syncNow(predsRef.current)}
                  retryLabel="Retry saving picks"
                />
              ) : null}

              <div className="picks-layout">
                <section className="matchday-card-wrap" aria-labelledby="picks-upcoming-heading">
                  <article className="matchday">
                    <div className="matchday-head">
                      <strong id="picks-upcoming-heading">
                        {selectedLeague ? `${selectedLeague.name}: upcoming` : 'Upcoming'}
                      </strong>
                      {/* One stable node: the sync's states swap text, never remount. */}
                      <span role="status">
                        {(playerName || '').trim()
                          ? syncStatus === 'saving'
                            ? 'Saving your picks…'
                            : syncStatus === 'error'
                              ? 'Your picks could not be saved'
                              : 'Your picks save automatically'
                          : 'Add your name to save picks'}
                      </span>
                    </div>
                    <div className="fixture-list">
                      {upcoming.length ? (
                        upcoming.map(renderInputRow)
                      ) : (
                        <EmptyState
                          title="No upcoming fixtures"
                          text="Nothing has been scheduled for this league yet."
                        />
                      )}
                    </div>
                  </article>
                </section>

                <section className="matchday-card-wrap" aria-labelledby="picks-finished-heading">
                  <article className="matchday">
                    <div className="matchday-head">
                      <strong id="picks-finished-heading">Recent results</strong>
                      <span>Read-only</span>
                    </div>
                    <div className="fixture-list">
                      {finished.length ? (
                        finished.map(renderResultRow)
                      ) : (
                        <EmptyState
                          title="No results yet"
                          text="Played fixtures appear here with the real score and your pick."
                        />
                      )}
                    </div>
                  </article>
                </section>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
