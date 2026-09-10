import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import ScoreInput from './ScoreInput';
import { groupBy } from './main.jsx';
import {
  loadRealLocal,
  saveRealLocal,
  setPlayerName as persistPlayerName,
} from './predictionStorage';
import { computeStandings } from './standingsCalc';
import { buildPredictionsImage } from './sharePredictionsImage';

const SYNC_DELAY_MS = 1200;
const LIVE_POLL_MS = 30000;

function TeamLogo({ team }) {
  return (
    <span className="team-logo sm">
      {team.logo_url ? (
        <img src={team.logo_url} alt={team.name} />
      ) : (
        team.short_name?.slice(0, 3)
      )}
    </span>
  );
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
  const [error, setError] = useState('');
  const [currentMd, setCurrentMd] = useState(1);
  const [preds, setPreds] = useState(() => loadRealLocal(seasonId, playerName));
  const [live, setLive] = useState({});
  const predsRef = useRef(preds);
  const syncTimer = useRef(null);

  useEffect(() => {
    if (!seasonId) return;
    setData(null);
    setError('');
    setCurrentMd(1);
    apiFetch(`/ui/seasons/${seasonId}/real-fixtures/`)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [seasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPreds(loadRealLocal(seasonId, playerName) || {});
  }, [seasonId, playerName]);

  useEffect(() => {
    predsRef.current = preds;
  }, [preds]);

  // Pull the player's saved predictions from the backend once, keeping any
  // local (possibly unsaved) values — local wins for ids already present.
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
        // Backend unavailable: localStorage stays the source of truth.
      });
  }, [seasonId, playerName]); // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleSync(predictions) {
    const name = (playerName || '').trim();
    if (!seasonId || !name) return;
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => {
      apiFetch(`/ui/seasons/${seasonId}/real-predictions/`, {
        method: 'PUT',
        body: JSON.stringify({
          player_name: name,
          predictions: Object.entries(predictions).map(([id, v]) => ({
            id,
            home_goals: v.home_goals ?? null,
            away_goals: v.away_goals ?? null,
          })),
        }),
      }).catch((err) => {
        // Closed batches (400) are expected once a matchday kicks off; inputs
        // are already disabled on the client, so just don't retry.
        console.log('Real prediction sync skipped:', err.message);
      });
    }, SYNC_DELAY_MS);
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

  // A fixture is 'awaiting' once predictions close and no final result has
  // landed yet -- that is the window where a live score can exist.
  const anyAwaiting = useMemo(
    () => Boolean(data && data.matchups && data.matchups.some((f) => f.closed && !f.result)),
    [data],
  );

  // Poll the fixtures + live scores every 30s while a matchday is in play.
  // Refetching fixtures also picks up final results as the sync writes them.
  // Polling stops (and live is cleared) once every closed match has a result.
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
        .catch(() => {}); // source down → keep 'Awaiting result' rows
    };
    poll();
    const timer = setInterval(poll, LIVE_POLL_MS);
    return () => clearInterval(timer);
  }, [seasonId, anyAwaiting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Real standings: computed from the actual results inside the fixtures
  // payload, which the backend adds as fixtures are played.
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
      <div className="command-band">
        <div>
          <h1>Official UCL real draw</h1>
          <p>
            Predict the real league-phase fixtures. Predictions close 10 minutes before kickoff.
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
                const v = event.currentTarget.value;
                setPlayerName(v);
                persistPlayerName(v);
              }}
            />
          </label>
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
      {error ? (
        <p className="empty-row">Real fixtures unavailable</p>
      ) : !data ? (
        <p className="empty-row">Loading real fixtures...</p>
      ) : (
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
                      <button
                        type="button"
                        className="button secondary md-nav-btn"
                        disabled={currentMd <= 1}
                        onClick={() => setCurrentMd((md) => md - 1)}
                        aria-label={`Previous matchday`}
                      >
                        &lsaquo;
                      </button>
                      <span className="md-nav-label">MD {currentMd}/8</span>
                      <button
                        type="button"
                        className="button secondary md-nav-btn"
                        disabled={currentMd >= 8}
                        onClick={() => setCurrentMd((md) => md + 1)}
                        aria-label={`Next matchday`}
                      >
                        &rsaquo;
                      </button>
                      <button
                        type="button"
                        className="button secondary md-nav-btn"
                        disabled={!(playerName || '').trim()}
                        onClick={() => { handleShareMatchday(currentMd); }}
                      >
                        Share MD {currentMd}
                      </button>
                    </div>
                  </div>
                  <div className="fixture-list">
                    {fixtures.length ? (
                      fixtures.map((fixture) => {
                        const pred = preds[fixture.id] || {};
                        const result = fixture.result;
                        if (result) {
                          // Played with a real result — show it, no input.
                          const verdict = verdictFor(pred, result);
                          return (
                            <div className="fixture-row score-row" key={fixture.id}>
                              <div className="fx-status" title={formatKickoff(fixture.kickoff)}>Final</div>
                              <div className="team-badge score-team">
                                <TeamLogo team={fixture.home_team} />
                                <b>{fixture.home_team.name}</b>
                              </div>
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
                              <div className="team-badge right score-team">
                                <b>{fixture.away_team.name}</b>
                                <TeamLogo team={fixture.away_team} />
                              </div>
                            </div>
                          );
                        }
                        const disabled = Boolean(fixture.closed);
                        const liveScore = !result && live[fixture.id];
                        if (liveScore) {
                          // In play — show the current score, no input.
                          return (
                            <div className="fixture-row score-row" key={fixture.id}>
                              <div className="fx-status live" title={formatKickoff(fixture.kickoff)}>
                                LIVE {liveScore.status}
                              </div>
                              <div className="team-badge score-team">
                                <TeamLogo team={fixture.home_team} />
                                <b>{fixture.home_team.name}</b>
                              </div>
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
                              <div className="team-badge right score-team">
                                <b>{fixture.away_team.name}</b>
                                <TeamLogo team={fixture.away_team} />
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="fixture-row score-row" key={fixture.id}>
                            <div
                              className={disabled ? 'fx-status waiting' : 'fx-status'}
                              title={formatKickoff(fixture.kickoff)}
                            >
                              {disabled ? 'Awaiting result' : formatKickoff(fixture.kickoff)}
                            </div>
                            <div className="team-badge score-team">
                              <TeamLogo team={fixture.home_team} />
                              <b>{fixture.home_team.name}</b>
                            </div>
                            <div className="score-group">
                              <ScoreInput
                                value={pred.home_goals}
                                onChange={(v) => handleChange(fixture.id, 'home_goals', v)}
                                disabled={disabled}
                              />
                              <span className="score-sep">&ndash;</span>
                              <ScoreInput
                                value={pred.away_goals}
                                onChange={(v) => handleChange(fixture.id, 'away_goals', v)}
                                disabled={disabled}
                              />
                            </div>
                            <div className="team-badge right score-team">
                              <b>{fixture.away_team.name}</b>
                              <TeamLogo team={fixture.away_team} />
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <span className="empty-row">No fixtures this matchday.</span>
                    )}
                  </div>
                </article>
              );
            })()}
          </section>
          <aside className="real-standings">
            <div className="real-standings-head">
              <strong>UCL standings</strong>
              <span>Real results + your picks</span>
            </div>
            <div className="real-standings-scroll">
              <table className="league-table real-league-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th className="tbl-team">Team</th>
                    <th>Pts</th>
                    <th>P</th>
                    <th>GD</th>
                    <th>W</th>
                    <th>D</th>
                    <th>L</th>
                    <th>GF</th>
                    <th>GA</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((row) => {
                    let cls = 'table-row';
                    if (row.position <= 8) cls += ' row-qualified';
                    else if (row.position <= 24) cls += ' row-playoffs';
                    else cls += ' row-eliminated';
                    return (
                      <tr className={cls} key={row.team_id}>
                        <td className="tbl-pos">{row.position}</td>
                        <td className="tbl-team">
                          <span className="team-logo xs">
                            {row.team?.logo_url
                              ? <img src={row.team.logo_url} alt="" />
                              : row.team?.short_name?.slice(0, 3)}
                          </span>
                          <span className="tbl-name">{row.team?.name || row.short_name}</span>
                        </td>
                        <td className="tbl-pts"><strong>{row.points}</strong></td>
                        <td>{row.played}</td>
                        <td className={row.goal_diff > 0 ? 'gd-pos' : row.goal_diff < 0 ? 'gd-neg' : ''}>
                          {row.goal_diff > 0 ? '+' : ''}{row.goal_diff}
                        </td>
                        <td>{row.wins}</td>
                        <td>{row.draws}</td>
                        <td>{row.losses}</td>
                        <td>{row.goals_for}</td>
                        <td>{row.goals_against}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}