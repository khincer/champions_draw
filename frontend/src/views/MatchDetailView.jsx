import { useEffect, useRef, useState } from 'preact/hooks';
import Crest from '../components/Crest';
import { apiFetch } from '../lib/api';

const STATUS_LABEL = { FINISHED: 'Final', IN_PLAY: 'Live', SCHEDULED: 'Kickoff' };

export default function MatchDetailView({ fixtureId, seasonId, onBack }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveScore, setLiveScore] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const backRef = useRef(null);

  const detailUrl = `/ui/seasons/${seasonId}/match-details/${fixtureId}/`;
  const liveUrl = `/ui/seasons/${seasonId}/live-scores/`;

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
  }, [detailUrl]);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const status = data?.header?.status;

  // Poll only while the match is in play: refresh the detail (the listing is
  // cached server-side, so this costs no upstream request) and overlay the
  // live score. The interval is torn down on unmount or when a refetch lands
  // as FINISHED (status change re-runs this effect, clearing the timer).
  useEffect(() => {
    if (status !== 'IN_PLAY') return undefined;
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

  return (
    <section className="match-detail-view" aria-busy={loading || refreshing}>
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
        <div className="match-detail-error" role="alert">
          <strong>Couldn't load match details</strong>
          <p>{error}</p>
        </div>
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
                <dl className="match-detail-facts">
                  <dt>Venue</dt>
                  <dd>{data.detail.venue || 'Not available'}</dd>
                </dl>
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
    </section>
  );
}