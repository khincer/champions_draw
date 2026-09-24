import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Button from '../components/Button';
import FixtureRow from '../components/FixtureRow';
import StandingsTable from '../components/StandingsTable';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import ScoreInput from '../components/ScoreInput';
import { groupBy } from '../lib/groupBy';
import {
  getPlayerName as readStoredPlayerName,
  loadRealLocal,
  saveRealLocal,
  setPlayerName as persistPlayerName,
} from '../lib/predictionStorage';
import { computeStandings } from '../lib/standingsCalc';
import { buildPredictionsImage } from '../lib/sharePredictionsImage';

const SYNC_DELAY_MS = 1200;
const LIVE_POLL_MS = 30000;

function formatKickoff(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMatchdayHeader(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function verdictFor(pred, result) {
  if (!result || !pred || !Number.isFinite(Number(pred.home_goals)) || !Number.isFinite(Number(pred.away_goals))) return null;
  const ph = Number(pred.home_goals);
  const pa = Number(pred.away_goals);
  const rh = Number(result.home_goals);
  const ra = Number(result.away_goals);
  if (ph === rh && pa === ra) return 'exact';
  return Math.sign(ph - pa) === Math.sign(rh - ra) ? 'outcome' : 'miss';
}

const VERDICT_LABEL = { exact: 'Exact', outcome: 'Outcome', miss: 'Miss' };

export default function RealDrawView({
  seasonId,
  setSeasonId,
  seasons,
  playerName,
  setPlayerName,
  apiFetch,
  onOpenMatch,
}) {
  const [data, setData] = useState(null);
  const [fixturesStatus, setFixturesStatus] = useState('idle');
  const [error, setError] = useState('');
  const [currentMd, setCurrentMd] = useState(1);
  const [preds, setPreds] = useState(() => loadRealLocal(seasonId, playerName));
  const [live, setLive] = useState({});
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncError, setSyncError] = useState('');
  const predsRef = useRef(preds);
  const syncTimer = useRef(null);
  const nameDialogRef = useRef(null);
  const [nameDraft, setNameDraft] = useState('');

  /* Ask for a display name once, on first visit, and never again. The answer is
     stored under the same localStorage key the rest of the app already reads, so
     every other surface picks it up. Mount-only deps on purpose: a dismissed
     dialog must stay dismissed, and the "Playing as" control is the way back in. */
  useEffect(() => {
    if ((playerName || readStoredPlayerName() || '').trim()) return;
    const node = nameDialogRef.current;
    if (node && !node.open) node.showModal();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFixtures = useCallback(async () => {
    if (!seasonId) return;
    setFixturesStatus('loading');
    setError('');
    try {
      setData(await apiFetch(`/ui/seasons/${seasonId}/real-fixtures/`));
      setFixturesStatus('success');
    } catch (err) {
      setError(err.message);
      setFixturesStatus('error');
    }
  }, [seasonId]);

  useEffect(() => {
    if (!seasonId) return;
    setData(null);
    setCurrentMd(1);
    loadFixtures();
  }, [seasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPreds(loadRealLocal(seasonId, playerName) || {});
  }, [seasonId, playerName]);

  useEffect(() => {
    predsRef.current = preds;
  }, [preds]);

  useEffect(() => {
    const name = (playerName || '').trim();
    if (!seasonId || !name) return;
    apiFetch(`/ui/seasons/${seasonId}/real-predictions/?player_name=${encodeURIComponent(name)}`)
      .then((remote) => {
        if (!remote || !Array.isArray(remote.predictions)) return;
        const remoteById = {};
        for (const p of remote.predictions) remoteById[p.id] = p;
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
      });
  }, [seasonId, playerName]);

  async function syncNow(predictions) {
    const name = (playerName || '').trim();
    if (!seasonId || !name) return;
    setSyncStatus('saving');
    setSyncError('');
    try {
      await apiFetch(`/ui/seasons/${seasonId}/real-predictions/`, {
        method: 'PUT',
        body: JSON.stringify({
          player_name: name,
          predictions: Object.entries(predictions).map(([id, v]) => ({
            id,
            home_goals: v.home_goals ?? null,
            away_goals: v.away_goals ?? null,
          })),
        }),
      });
      setSyncStatus('success');
    } catch (err) {
      if (err.status === 400) {
        setSyncStatus('success'); 
        return;
      }
      setSyncError(err.message);
      setSyncStatus('error');
    }
  }

  function scheduleSync(predictions) {
    const name = (playerName || '').trim();
    if (!seasonId || !name) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { syncNow(predictions); }, SYNC_DELAY_MS);
  }

  function handleChange(matchupId, field, value) {
    const updated = {
      ...predsRef.current,
      [matchupId]: { ...(predsRef.current[matchupId] || {}), [field]: value },
    };
    saveRealLocal(seasonId, playerName, updated);
    setPreds(updated);
    scheduleSync(updated);
  }

  const matchdays = useMemo(() => groupBy(data?.matchups || [], 'matchday'), [data]);

  const anyAwaiting = useMemo(
    () => Boolean(data && data.matchups && data.matchups.some((f) => f.closed && !f.result)),
    [data],
  );

  useEffect(() => {
    if (!seasonId || !anyAwaiting) {
      setLive({});
      return undefined;
    }
    const poll = () => {
      apiFetch(`/ui/seasons/${seasonId}/real-fixtures/`)
        .then(setData)
        .catch(() => {});
      apiFetch(`/ui/seasons/${seasonId}/live-scores/`)
        .then((payload) => setLive(payload.live || {}))
        .catch(() => {}); 
    };
    poll();
    const timer = setInterval(poll, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [seasonId, anyAwaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  const standings = useMemo(() => {
    const matchups = data?.matchups || [];
    const teamsMap = new Map();
    const results = {};
    for (const fixture of matchups) {
      if (fixture.home_team) teamsMap.set(fixture.home_team.id, fixture.home_team);
      if (fixture.away_team) teamsMap.set(fixture.away_team.id, fixture.away_team);
      const src = fixture.result && Number.isFinite(Number(fixture.result.home_goals)) && Number.isFinite(Number(fixture.result.away_goals))
        ? fixture.result
        : (() => { const p = preds[fixture.id]; return p && Number.isFinite(Number(p.home_goals)) && Number.isFinite(Number(p.away_goals)) ? p : null; })();
      if (src) {
        results[fixture.id] = {
          home_team_id: fixture.home_team.id,
          away_team_id: fixture.away_team.id,
          home_goals: Number(src.home_goals),
          away_goals: Number(src.away_goals),
        };
      }
    }
    return computeStandings([...teamsMap.values()], results);
  }, [data, preds]);

  async function handleShareMatchday(md) {
    const name = (playerName || '').trim();
    if (!name) return;
    const fixtures = (matchdays[String(md)] || []).map((f) => ({ ...f, prediction: preds[f.id] }));
    const canvas = await buildPredictionsImage({ playerName: name, matchday: md, fixtures, seasonName: data?.season?.name || '' });
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `ucl-md${md}-predictions.png`, { type: 'image/png' });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(() => {});
      } else {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `ucl-md${md}-predictions.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      }
    }, 'image/png');
  }

  return (
    <section className="workspace">
      <dialog ref={nameDialogRef} className="name-dialog" aria-labelledby="name-dialog-title">
        <form
          method="dialog"
          onSubmit={(event) => {
            const value = nameDraft.trim();
            if (!value) {
              event.preventDefault();
              return;
            }
            setPlayerName(value);
            persistPlayerName(value);
          }}
        >
          <h2 id="name-dialog-title">How do you want to be called?</h2>
          <p className="muted">
            This labels your predictions. It is saved on this device, and only asked once.
          </p>
          <input
            className="name-dialog-input"
            value={nameDraft}
            maxLength={80}
            placeholder="Your name"
            aria-label="Your name"
            autofocus
            onInput={(event) => setNameDraft(event.currentTarget.value)}
          />
          <div className="name-dialog-actions">
            <button type="submit" className="name-dialog-save" disabled={!nameDraft.trim()}>
              Save
            </button>
          </div>
        </form>
      </dialog>
      <div className="command-band">
        <div>
          <h1>Official UCL real draw</h1>
          <p>
            Predict the real league-phase fixtures. Predictions close 10 minutes before kickoff.
          </p>
        </div>
        <div className="draw-controls">
          <button
            type="button"
            className="playing-as"
            onClick={() => {
              setNameDraft((playerName || readStoredPlayerName() || '').trim());
              const node = nameDialogRef.current;
              if (node && !node.open) node.showModal();
            }}
          >
            Playing as <strong>{(playerName || '').trim() || 'Guest'}</strong>
          </button>
          <label className="seed-input">
            <span>Season year</span>
            <select value={seasonId} onChange={(event) => setSeasonId(event.currentTarget.value)}>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {fixturesStatus === 'error' ? (
        <ErrorState
          title="Real fixtures could not load"
          detail={error}
          onRetry={loadFixtures}
          retryLabel="Retry real fixtures"
        />
      ) : !data ? (
        <Skeleton rows={6} variant="fixture" label="Loading real fixtures" />
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
        <div className="real-layout">
          <section className="matchday-card-wrap">
            {(() => {
              const fixtures = matchdays[String(currentMd)] || [];
              const headerDate = formatMatchdayHeader(fixtures[0]?.kickoff);
              const mdSummary = fixtures.reduce(
                (acc, f) => {
                  const v = verdictFor(preds[f.id], f.result);
                  if (v) acc[v] += 1;
                  return acc;
                },
                { exact: 0, outcome: 0, miss: 0 },
              );
              const hasResults = mdSummary.exact + mdSummary.outcome + mdSummary.miss > 0;
              return (
                <article className="matchday" key={currentMd}>
                  <div className="matchday-head">
                    <div>
                      <strong>Matchday {currentMd}{headerDate ? `, ${headerDate}` : ''}</strong>
                      {hasResults && (
                        <p className="md-results-summary">
                          Your record this matchday:
                          <b className="verdict-exact"> {mdSummary.exact} exact</b>
                          <span> · </span>
                          <b className="verdict-outcome">{mdSummary.outcome} right outcome</b>
                          <span> · </span>
                          <b className="verdict-miss">{mdSummary.miss} wrong</b>
                        </p>
                      )}
                    </div>
                    <div className="matchday-head-actions">
                      <Button
                        className="md-nav-btn"
                        disabled={currentMd <= 1}
                        onClick={() => setCurrentMd((md) => md - 1)}
                        aria-label={`Previous matchday`}
                      >
                        &lsaquo;
                      </Button>
                      <span className="md-nav-label">MD {currentMd}/8</span>
                      <Button
                        className="md-nav-btn"
                        disabled={currentMd >= 8}
                        onClick={() => setCurrentMd((md) => md + 1)}
                        aria-label={`Next matchday`}
                      >
                        &rsaquo;
                      </Button>
                      <Button
                        className="md-nav-btn"
                        disabled={!(playerName || '').trim()}
                        onClick={() => { handleShareMatchday(currentMd); }}
                      >
                        Share MD {currentMd}
                      </Button>
                    </div>
                  </div>
                  <div className="fixture-list">
                    {fixtures.length ? (
                      fixtures.map((fixture) => {
                        const pred = preds[fixture.id] || {};
                        const result = fixture.result;
                        if (result) {
                          const verdict = verdictFor(pred, result);
                          return (
                            <FixtureRow
                              key={fixture.id}
                              className="score-row"
                              status="Final"
                              statusTitle={formatKickoff(fixture.kickoff)}
                              home={fixture.home_team}
                              away={fixture.away_team}
                              nameMode="full"
                              center={
                                <div className="score-group real-result">
                                  {onOpenMatch ? (
                                    <a
                                      className="real-row-link"
                                      href="#"
                                      aria-label={`${fixture.home_team.name} vs ${fixture.away_team.name} — view match details`}
                                      onClick={(e) => { e.preventDefault(); onOpenMatch(fixture.id, seasonId); }}
                                    >
                                      <span className="real-score">{result.home_goals}&ndash;{result.away_goals}</span>
                                      {verdict && (
                                        <span className={`fx-verdict ${verdict}`}>
                                          {VERDICT_LABEL[verdict]} &middot; your pick {pred.home_goals}&ndash;{pred.away_goals}
                                        </span>
                                      )}
                                    </a>
                                  ) : (
                                    <>
                                      <span className="real-score">{result.home_goals}&ndash;{result.away_goals}</span>
                                      {verdict && (
                                        <span className={`fx-verdict ${verdict}`}>
                                          {VERDICT_LABEL[verdict]} &middot; your pick {pred.home_goals}&ndash;{pred.away_goals}
                                        </span>
                                      )}
                                    </>
                                  )}
                                </div>
                              }
                            />
                          );
                        }
                        const disabled = Boolean(fixture.closed);
                        const liveScore = !result && live[fixture.id];
                        if (liveScore) {
                          return (
                            <FixtureRow
                              key={fixture.id}
                              className="score-row"
                              status={`LIVE ${liveScore.status}`}
                              statusTone="live"
                              statusTitle={formatKickoff(fixture.kickoff)}
                              home={fixture.home_team}
                              away={fixture.away_team}
                              nameMode="full"
                              center={
                                <div className="score-group real-result">
                                  {onOpenMatch ? (
                                    <a
                                      className="real-row-link"
                                      href="#"
                                      aria-label={`${fixture.home_team.name} vs ${fixture.away_team.name} — view match details`}
                                      onClick={(e) => { e.preventDefault(); onOpenMatch(fixture.id, seasonId); }}
                                    >
                                      <span className="real-score">{liveScore.home_goals}&ndash;{liveScore.away_goals}</span>
                                      <span className="fx-verdict live">Live</span>
                                    </a>
                                  ) : (
                                    <>
                                      <span className="real-score">{liveScore.home_goals}&ndash;{liveScore.away_goals}</span>
                                      <span className="fx-verdict live">Live</span>
                                    </>
                                  )}
                                </div>
                              }
                            />
                          );
                        }
                        return (
                          <FixtureRow
                            key={fixture.id}
                            className="score-row"
                            status={disabled ? 'Awaiting result' : formatKickoff(fixture.kickoff)}
                            statusTone={disabled ? 'waiting' : undefined}
                            statusTitle={formatKickoff(fixture.kickoff)}
                            home={fixture.home_team}
                            away={fixture.away_team}
                            nameMode="full"
                            center={
                              <div className="score-group">
                                <ScoreInput
                                  value={pred.home_goals}
                                  onChange={(v) => handleChange(fixture.id, 'home_goals', v)}
                                  disabled={disabled}
                                  label={`Home goals, ${fixture.home_team.name} versus ${fixture.away_team.name}, Matchday ${currentMd}`}
                                />
                                <span className="score-sep">&ndash;</span>
                                <ScoreInput
                                  value={pred.away_goals}
                                  onChange={(v) => handleChange(fixture.id, 'away_goals', v)}
                                  disabled={disabled}
                                  label={`Away goals, ${fixture.home_team.name} versus ${fixture.away_team.name}, Matchday ${currentMd}`}
                                />
                              </div>
                            }
                          />
                        );
                      })
                    ) : (
                      <EmptyState
                        title="No fixtures this matchday"
                        text="Use the matchday arrows above to find a matchday with fixtures."
                      />
                    )}
                  </div>
                </article>
              );
            })()}
          </section>
          <aside className="real-standings" aria-busy={syncStatus === 'saving'}>
            <div className="real-standings-head">
              <strong>UCL standings</strong>
              <span role="status">
                {syncStatus === 'saving'
                  ? 'Saving your picks…'
                  : syncStatus === 'error'
                    ? 'Your picks could not be saved'
                    : 'Real results + your picks'}
              </span>
            </div>
            <div className="real-standings-scroll">
              <StandingsTable
                rows={standings}
                variant="league"
                nameMode="full"
                playedHeader="P"
                className="real-league-table"
              />
            </div>
          </aside>
        </div>
        </>
      )}
    </section>
  );
}