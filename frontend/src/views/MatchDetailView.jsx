import { useEffect, useRef, useState } from 'preact/hooks';
import Crest from '../components/Crest';
import { ErrorState } from '../components/States';
import { apiFetch } from '../lib/api';
import errorText from '../lib/errorText';
import { useI18n } from '../i18n';

const STATUS_LABEL = { FINISHED: 'matchDetail.final', IN_PLAY: 'matchDetail.live', SCHEDULED: 'matchDetail.kickoff' };

export default function MatchDetailView({ fixtureId, seasonId, leagueId, onBack }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveScore, setLiveScore] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const backRef = useRef(null);
  const dialogRef = useRef(null);

  const isLeague = leagueId != null;
  const detailUrl = isLeague
    ? `/leagues/${leagueId}/matches/${String(fixtureId).replace(/^lm-/, '')}/details/`
    : `/ui/seasons/${seasonId}/match-details/${fixtureId}/`;
  const liveUrl = isLeague ? null : `/ui/seasons/${seasonId}/live-scores/`;

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLiveScore(null);
    setError('');
    setLoading(true);
    apiFetch(detailUrl)
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch((err) => { if (!cancelled) setError(err.code || 'unknown'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [detailUrl, reloadToken]);

  useEffect(() => {
    const node = dialogRef.current;
    if (node && !node.open) node.showModal();
  }, []);

  useEffect(() => {
    backRef.current?.focus();
  }, []);

  const status = data?.header?.status;

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
    ? t('matchDetail.dialogName', { home: header.home_team.name, away: header.away_team.name })
    : t('matchDetail.dialogNameFallback');

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
        ← {t('matchDetail.back')}
      </button>

      {loading && (
        <div className="match-detail-skeleton">
          <span className="match-detail-sr" role="status">{t('matchDetail.loading')}</span>
          <div className="md-skel md-skel-score" />
          <div className="md-skel md-skel-line" />
          <div className="md-skel md-skel-line" />
        </div>
      )}

      {!loading && error && (
        <ErrorState
          title={t('matchDetail.loadFailed')}
          detail={errorText(t, error)}
          onRetry={() => setReloadToken((token) => token + 1)}
          retryLabel={t('matchDetail.retry')}
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
                aria-label={score ? t('matchDetail.scoreLabel', { home: score.home_goals, away: score.away_goals }) : t('matchDetail.noScore')}
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
                {t(STATUS_LABEL[status] || 'matchDetail.final')}
              </span>
              <time className="match-detail-kickoff" dateTime={header.kickoff}>
                {new Date(header.kickoff).toLocaleString(locale)}
              </time>
            </div>
          </header>

          <div className="match-detail-body">
            {data.detail ? (
              <section className="match-detail-info" aria-labelledby="match-detail-info-title">
                <h2 id="match-detail-info-title">{t('matchDetail.matchInformation')}</h2>
                {('venue' in data.detail || data.detail.half_time) && (
                  <dl className="match-detail-facts">
                    {'venue' in data.detail && (
                      <>
                        <dt>{t('matchDetail.venue')}</dt>
                        <dd>{data.detail.venue || t('matchDetail.notAvailable')}</dd>
                      </>
                    )}
                    {data.detail.half_time && (
                      <>
                        <dt>{t('matchDetail.halfTime')}</dt>
                        <dd>
                          {data.detail.half_time.home_goals} : {data.detail.half_time.away_goals}
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                <h3>{t('matchDetail.referees')}</h3>
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
                  <p className="muted">{t('matchDetail.noReferees')}</p>
                )}
                {'odds' in data.detail && (
                  <>
                    <h3>{t('matchDetail.odds')}</h3>
                    <table className="match-detail-odds">
                      <thead>
                        <tr>
                          <th scope="col">{t('matchDetail.home')}</th>
                          <th scope="col">{t('matchDetail.draw')}</th>
                          <th scope="col">{t('matchDetail.away')}</th>
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
                {data.detail_error || t('matchDetail.detailsUnavailable')}
              </p>
            )}

            <div data-match-detail-seam hidden />
          </div>
        </>
      )}
    </dialog>
  );
}