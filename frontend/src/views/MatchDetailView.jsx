import { useEffect, useRef, useState } from 'preact/hooks';
import Crest from '../components/Crest';
import { ErrorState } from '../components/States';
import { apiFetch } from '../lib/api';

const STATUS_LABEL = { FINISHED: 'Final', IN_PLAY: 'Live', SCHEDULED: 'Kickoff' };

export default function MatchDetailView({ fixtureId, seasonId, leagueId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveScore, setLiveScore] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  /* Bumped by the error state's retry, which re-issues only the detail request
     (US:no-silent-failure — the error card used to be a dead end). */
  const [reloadToken, setReloadToken] = useState(0);
  const backRef = useRef(null);
  const dialogRef = useRef(null);

  /* League rows (`lm-{fixture_id}`) have no season, so they resolve through the
     league-scoped route; UCL rows keep the season-scoped one. */
  const isLeague = leagueId != null;
  const detailUrl = isLeague
    ? `/leagues/${leagueId}/matches/${String(fixtureId).replace(/^lm-/, '')}/details/`
    : `/ui/seasons/${seasonId}/match-details/${fixtureId}/`;
  /* No live-scores feed for leagues, so the in-play overlay is UCL-only. */
  const liveUrl = isLeague ? null : `/ui/seasons/${seasonId}/live-scores/`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLiveScore(null);
    setError('');
    setLoading(true);
    apiFetch(detailUrl)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [detailUrl, reloadToken]);

  /* Modal so the top layer seals the page behind the overlay: Tab cannot leave
     it and the background is inert. Escape arrives as `cancel` (handled below). */
  useEffect(() => {
    const node = dialogRef.current;
    if (node && !node.open) node.showModal();
  }, []);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const status = data?.header?.status;

  // Poll only while the match is in play: refresh the detail (the listing is
  // cached server-side, so this costs no upstream request) and overlay the
  // live score. The interval is torn down on unmount or when a refetch lands
  // as FINISHED (status change re-runs this effect, clearing the timer).
  useEffect(() => {
    if (status !== 'IN_PLAY' || !liveUrl) return undefined;
    let cancelled = false;
    const tick = async () => {
      setRefreshing(true);
      try {
        const [fresh, live] = await Promise.all([apiFetch(detailUrl), apiFetch(liveUrl)]);
        if (cancelled) return;
        setData(fresh);
        setLiveScore(live.live?.[fixtureId] || null);
      } catch {
        // Keep the last known data; the next tick retries.
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    };
    const timer = window.setInterval(tick, 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [status, detailUrl, liveUrl, fixtureId]);

  const header = data?.header;
  const score = status === 'IN_PLAY' && liveScore ? liveScore : header?.score;
  const dialogName = header
    ? `Match details: ${header.home_team.name} versus ${header.away_team.name}`
    : 'Match details';

  /* Native `showModal()` seals the page behind the overlay, but with a single
     focusable control (the Back button) Chromium lets Tab fall out to <body>
     and back. Wrap the ring so focus never leaves the dialog while it is open
     (A11Y:dialog-focus-return). */
  function trapTab(event) {
    if (event.key !== 'Tab') return;
    const node = dialogRef.current;
    if (!node) return;
    const focusables = [...node.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="match-detail-view"
      aria-label={dialogName}
      aria-busy={loading || refreshing}
      onCancel={(event) => {
        event.preventDefault();
        onBack?.();
      }}
      onKeyDown={trapTab}
    >
      <button
        ref={backRef}
        type="button"
        className="back-button match-detail-back"
        onClick={onBack}
      >
        ← Back
      </button>

      {loading && (
        <div className="match-detail-skeleton">
          <span className="match-detail-sr" role="status">Loading match details</span>
          <div className="md-skel md-skel-score" />
          <div className="md-skel md-skel-line" />
          <div className="md-skel md-skel-line" />
        </div>
      )}

      {!loading && error && (
        <ErrorState
          title="Couldn't load match details"
          detail={error}
          onRetry={() => setReloadToken((token) => token + 1)}
          retryLabel="Retry match details"
        />
      )}

      {!loading && !error && header && (
        <>
          <header className="match-detail-header">
            <h1 className="match-detail-title">
              <span className="match-detail-team">
                <Crest team={header.home_team} className="match-detail-crest" />
                {header.home_team.name}
              </span>
              <span
                className={`match-detail-score${status === 'IN_PLAY' ? ' live' : ''}`}
                aria-live="polite"
                aria-label={score ? `${score.home_goals} to ${score.away_goals}` : 'No score yet'}
              >
                {score ? (
                  <>
                    <span>{score.home_goals}</span>
                    <b>:</b>
                    <span>{score.away_goals}</span>
                  </>
                ) : (
                  '–'
                )}
              </span>
              <span className="match-detail-team">
                {header.away_team.name}
                <Crest team={header.away_team} className="match-detail-crest" />
              </span>
            </h1>
            <div className="match-detail-meta">
              <span className="matchday-chip">MD{header.matchday}</span>
              <span className={`match-detail-pill ${(status || '').toLowerCase()}`}>
                {status === 'IN_PLAY' && <span className="live-dot" aria-hidden="true" />}
                {STATUS_LABEL[status] || status}
              </span>
              <time className="match-detail-kickoff" dateTime={header.kickoff}>
                {new Date(header.kickoff).toLocaleString()}
              </time>
            </div>
          </header>

          <div className="match-detail-body">
            {data.detail ? (
              <section className="match-detail-info" aria-labelledby="match-detail-info-title">
                <h2 id="match-detail-info-title">Match Information</h2>
                {/* Key presence drives the block: UCL always carries `venue`
                    (possibly null) and `odds`, leagues carry neither. So the
                    league view shows no empty Venue/Odds rows. */}
                {('venue' in data.detail || data.detail.half_time) && (
                  <dl className="match-detail-facts">
                    {'venue' in data.detail && (
                      <>
                        <dt>Venue</dt>
                        <dd>{data.detail.venue || 'Not available'}</dd>
                      </>
                    )}
                    {data.detail.half_time && (
                      <>
                        <dt>Half-time</dt>
                        <dd>
                          {data.detail.half_time.home_goals} : {data.detail.half_time.away_goals}
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                <h3>Referees</h3>
                {data.detail.referees?.length ? (
                  <ul className="match-detail-referees">
                    {data.detail.referees.map((referee, index) => (
                      <li key={index}>
                        <strong>{referee.name}</strong>
                        {referee.role && <span>{referee.role.toLowerCase()}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">No referee information available.</p>
                )}
                {'odds' in data.detail && (
                  <>
                    <h3>Odds</h3>
                    <table className="match-detail-odds">
                      <thead>
                        <tr>
                          <th scope="col">Home</th>
                          <th scope="col">Draw</th>
                          <th scope="col">Away</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>{data.detail.odds?.homeWin ?? '–'}</td>
                          <td>{data.detail.odds?.draw ?? '–'}</td>
                          <td>{data.detail.odds?.awayWin ?? '–'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}
              </section>
            ) : (
              <p className="match-detail-note">
                {data.detail_error || 'Match details are not available.'}
              </p>
            )}

            {/* Reservoir for a future timeline/lineups block (spec seam slot). */}
            <div data-match-detail-seam hidden />
          </div>
        </>
      )}
    </dialog>
  );
}