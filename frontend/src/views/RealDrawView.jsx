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
import errorText from '../lib/errorText';
import { useI18n } from '../i18n';

const SYNC_DELAY_MS = 1200;
const LIVE_POLL_MS = 30000;

function formatKickoff(value, locale, t) {
  if (!value) return t('picks.tbd');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatMatchdayHeader(value, locale) {
  if (!value) return '';
  return new Intl.DateTimeFormat(locale, {
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

const VERDICT_LABEL = { exact: 'picks.exact', outcome: 'picks.outcome', miss: 'picks.miss' };

/* The competitions this page serves, in the order the cards render. Order is
   deliberate: the Champions League is the one with predictions and share. */
const REAL_COMPETITIONS = [
  { code: 'UCL', label: 'Champions League' },
  { code: 'LIB', label: 'Libertadores' },
  { code: 'SUD', label: 'Sudamericana' },
];

export default function RealDrawView({
  seasonId,
  setSeasonId,
  seasons,
  playerName,
  setPlayerName,
  apiFetch,
  onOpenMatch,
}) {
  const { t, locale } = useI18n();
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
      setError(err.code || 'unknown');
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
      setSyncError(err.code || 'unknown');
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

  /* Newest season per competition, so a card always opens the current one rather
     than whichever the global selector happened to hold. */
  const seasonByCompetition = useMemo(() => {
    const newest = new Map();
    for (const season of seasons || []) {
      const held = newest.get(season.competition);
      if (!held || String(season.name) > String(held.name)) newest.set(season.competition, season);
    }
    return newest;
  }, [seasons]);

  const selectedSeason = (seasons || []).find((s) => String(s.id) === String(seasonId));
  const selectedCompetition = selectedSeason?.competition;
  const selectedCompetitionLabel =
    REAL_COMPETITIONS.find((c) => c.code === selectedCompetition)?.label;

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
    const canvas = await buildPredictionsImage({ playerName: name, matchday: md, fixtures, seasonName: data?.season?.name || '', t, locale });
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
          <h2 id="name-dialog-title">{t('picks.namePrompt')}</h2>
          <p className="muted">
            {t('picks.namePromptText')}
          </p>
          <label className="name-dialog-label">
            {t('picks.yourName')}
            <input
              className="name-dialog-input"
              value={nameDraft}
              maxLength={80}
              autofocus
              onInput={(event) => setNameDraft(event.currentTarget.value)}
            />
          </label>
          <div className="name-dialog-actions">
            <button type="submit" className="name-dialog-save" disabled={!nameDraft.trim()}>
              {t('picks.save')}
            </button>
          </div>
        </form>
      </dialog>
      <div className="command-band">
        <div>
          <h1>{selectedCompetitionLabel || t('realDraw.international')}</h1>
          <p>
            {t('realDraw.description')}
          </p>
        </div>
        <div className="draw-controls">
          <button
            type="button"
            className="playing-as"
            aria-haspopup="dialog"
            onClick={() => {
              setNameDraft((playerName || readStoredPlayerName() || '').trim());
              const node = nameDialogRef.current;
              if (node && !node.open) node.showModal();
            }}
          >
            {t('realDraw.playingAs')} <strong>{(playerName || '').trim() || t('realDraw.guest')}</strong>
          </button>
        </div>
      </div>
      <div className="real-competition-cards" role="group" aria-label={t('realDraw.competition')}>
        {REAL_COMPETITIONS.map(({ code, label }) => {
          const season = seasonByCompetition.get(code);
          const active = selectedCompetition === code;
          return (
            <button
              key={code}
              type="button"
              className={`real-competition-card${active ? ' is-active' : ''}`}
              aria-pressed={active}
              disabled={!season}
              onClick={() => { if (season) setSeasonId(String(season.id)); }}
            >
              <strong>{label}</strong>
              <span className="real-competition-season">
                {season ? season.name : t('realDraw.notAvailable')}
              </span>
            </button>
          );
        })}
      </div>
      {fixturesStatus === 'error' ? (
        <ErrorState
          title={t('realDraw.loadFailed')}
          detail={errorText(t, error)}
          onRetry={loadFixtures}
          retryLabel={t('realDraw.retryFixtures')}
        />
      ) : !data ? (
        <Skeleton rows={6} variant="fixture" label={t('realDraw.loadingFixtures')} />
      ) : (
        <>
          {syncError ? (
            <ErrorState
              title={t('picks.saveFailed')}
              detail={t('picks.saveFailedText', { error: errorText(t, syncError) })}
              onRetry={() => syncNow(predsRef.current)}
              retryLabel={t('picks.retrySaving')}
            />
          ) : null}
        <div className="real-layout">
          <section className="matchday-card-wrap">
            {(() => {
              const fixtures = matchdays[String(currentMd)] || [];
              const headerDate = formatMatchdayHeader(fixtures[0]?.kickoff, locale);
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
                      <strong>
                        {headerDate
                          ? t('realDraw.matchdayWithDate', { md: currentMd, date: headerDate })
                          : t('realDraw.matchday', { md: currentMd })}
                      </strong>
                      {hasResults && (
                        <p className="md-results-summary">
                          {t('realDraw.recordThisMatchday')}
                          <b className="verdict-exact"> {t('realDraw.exactCount', { n: mdSummary.exact })}</b>
                          <span> · </span>
                          <b className="verdict-outcome">{t('realDraw.outcomeCount', { n: mdSummary.outcome })}</b>
                          <span> · </span>
                          <b className="verdict-miss">{t('realDraw.missCount', { n: mdSummary.miss })}</b>
                        </p>
                      )}
                    </div>
                    <div className="matchday-head-actions">
                      <Button
                        className="md-nav-btn"
                        disabled={currentMd <= 1}
                        onClick={() => setCurrentMd((md) => md - 1)}
                        aria-label={t('realDraw.previousMatchday')}
                      >
                        &lsaquo;
                      </Button>
                      <span className="md-nav-label">{t('realDraw.matchdayLabel', { md: currentMd })}</span>
                      <Button
                        className="md-nav-btn"
                        disabled={currentMd >= 8}
                        onClick={() => setCurrentMd((md) => md + 1)}
                        aria-label={t('realDraw.nextMatchday')}
                      >
                        &rsaquo;
                      </Button>
                      <Button
                        className="md-nav-btn"
                        disabled={!(playerName || '').trim()}
                        onClick={() => { handleShareMatchday(currentMd); }}
                      >
                        {t('realDraw.shareMatchday', { md: currentMd })}
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
                              status={t('picks.final')}
                              statusTitle={formatKickoff(fixture.kickoff, locale, t)}
                              home={fixture.home_team}
                              away={fixture.away_team}
                              nameMode="full"
                              center={
                                <div className="score-group real-result">
                                  {onOpenMatch ? (
                                    <a
                                      className="real-row-link"
                                      href="#"
                                      aria-label={t('realDraw.viewMatchDetails', { home: fixture.home_team.name, away: fixture.away_team.name })}
                                      onClick={(e) => { e.preventDefault(); onOpenMatch(fixture.id, seasonId); }}
                                    >
                                      <span className="real-score">{result.home_goals}&ndash;{result.away_goals}</span>
                                      {verdict && (
                                        <span className={`fx-verdict ${verdict}`}>
                                          {t('realDraw.verdictPick', { verdict: t(VERDICT_LABEL[verdict]), pick: `${pred.home_goals}\u2013${pred.away_goals}` })}
                                        </span>
                                      )}
                                    </a>
                                  ) : (
                                    <>
                                      <span className="real-score">{result.home_goals}&ndash;{result.away_goals}</span>
                                      {verdict && (
                                        <span className={`fx-verdict ${verdict}`}>
                                          {t('realDraw.verdictPick', { verdict: t(VERDICT_LABEL[verdict]), pick: `${pred.home_goals}\u2013${pred.away_goals}` })}
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
                              status={t('realDraw.liveStatus', { status: liveScore.status })}
                              statusTone="live"
                              statusTitle={formatKickoff(fixture.kickoff, locale, t)}
                              home={fixture.home_team}
                              away={fixture.away_team}
                              nameMode="full"
                              center={
                                <div className="score-group real-result">
                                  {onOpenMatch ? (
                                    <a
                                      className="real-row-link"
                                      href="#"
                                      aria-label={t('realDraw.viewMatchDetails', { home: fixture.home_team.name, away: fixture.away_team.name })}
                                      onClick={(e) => { e.preventDefault(); onOpenMatch(fixture.id, seasonId); }}
                                    >
                                      <span className="real-score">{liveScore.home_goals}&ndash;{liveScore.away_goals}</span>
                                      <span className="fx-verdict live">{t('realDraw.live')}</span>
                                    </a>
                                  ) : (
                                    <>
                                      <span className="real-score">{liveScore.home_goals}&ndash;{liveScore.away_goals}</span>
                                      <span className="fx-verdict live">{t('realDraw.live')}</span>
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
                            status={disabled ? t('picks.awaitingResult') : formatKickoff(fixture.kickoff, locale, t)}
                            statusTone={disabled ? 'waiting' : undefined}
                            statusTitle={formatKickoff(fixture.kickoff, locale, t)}
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
                        title={t('realDraw.noFixtures')}
                        text={t('realDraw.noFixturesText')}
                      />
                    )}
                  </div>
                </article>
              );
            })()}
          </section>
          <aside className="real-standings" aria-busy={syncStatus === 'saving'}>
            <div className="real-standings-head">
              <strong>{t('realDraw.uclStandings')}</strong>
              <span role="status">
                {syncStatus === 'saving'
                  ? t('picks.saving')
                  : syncStatus === 'error'
                    ? t('picks.saveFailed')
                    : t('realDraw.resultsAndPicks')}
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
