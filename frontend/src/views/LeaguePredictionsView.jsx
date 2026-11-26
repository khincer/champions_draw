import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import FixtureRow from '../components/FixtureRow';
import SegmentControl from '../components/SegmentControl';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import ScoreInput from '../components/ScoreInput';
import { getPlayerName as readStoredPlayerName, setPlayerName as persistPlayerName } from '../lib/predictionStorage';
import { syncLeaguePicks } from '../lib/predictionSync';
import errorText from '../lib/errorText';
import { useI18n } from '../i18n';

const SYNC_DELAY_MS = 1200;
const VERDICT_LABEL = { exact: 'picks.exact', outcome: 'picks.outcome', miss: 'picks.miss' };

const LEAGUE_STORAGE_PREFIX = 'champions_draw_league_prediction_';

function loadLeaguePredLocal(key) {
  const empty = { predictions: {}, pending: {}, unavailable: {} };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return empty;
    const saved = JSON.parse(raw);
    if (saved.version !== 1) return { ...empty, predictions: saved };
    const [pending, unavailable] = [saved.pending, saved.unavailable].map((ids) => Object.fromEntries(
      ids.filter((id) => saved.predictions[id]).map((id) => [id, saved.predictions[id]]),
    ));
    return { predictions: saved.predictions, pending, unavailable };
  } catch {
    return empty;
  }
}

function saveLeaguePredLocal(key, { predictions, pending, unavailable }) {
  try {
    localStorage.setItem(key, JSON.stringify({
      version: 1, predictions, pending: Object.keys(pending), unavailable: Object.keys(unavailable),
    }));
  } catch {
    // localStorage might be full or unavailable
  }
}

function formatKickoff(value, locale, t) {
  if (!value) return t('picks.tbd');
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

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
  const leagueOptions = useMemo(
    () => (leagues || []).filter((league) => typeof league.id === 'number'),
    [leagues],
  );

  const { t, locale } = useI18n();

  const [leagueId, setLeagueId] = useState('');
  const [, refresh] = useState(0);
  const nameDialogRef = useRef(null);
  const nameButtonRef = useRef(null);
  const [nameDraft, setNameDraft] = useState('');
  const name = (playerName || '').trim();
  const storageKey = `${LEAGUE_STORAGE_PREFIX}${leagueId}_${name || 'Guest'}`;
  const contexts = useRef(new Map());
  const context = useMemo(() => {
    if (!contexts.current.has(storageKey)) {
      contexts.current.set(storageKey, {
        ...loadLeaguePredLocal(storageKey),
        data: null,
        error: '',
        syncError: '',
        inFlight: false,
        request: 0,
        timer: null,
      });
    }
    return contexts.current.get(storageKey);
  }, [storageKey]);
  const activeContext = useRef(context);
  activeContext.current = context;
  const mounted = useRef(true);
  const redraw = useCallback(() => {
    if (mounted.current && activeContext.current === context) refresh((previous) => previous + 1);
  }, [context]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function openNameDialog() {
    setNameDraft(name);
    const node = nameDialogRef.current;
    if (node && !node.open) node.showModal();
  }

  useEffect(() => {
    if (!(name || readStoredPlayerName().trim())) openNameDialog();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!leagueId && leagueOptions.length) setLeagueId(String(leagueOptions[0].id));
  }, [leagueOptions, leagueId]);

  const loadFixtures = useCallback(async () => {
    if (!leagueId) return;
    const attempt = ++context.request;
    context.error = '';
    redraw();
    try {
      const query = name ? `?player_name=${encodeURIComponent(name)}` : '';
      const data = await apiFetch(`/leagues/${leagueId}/predictions/${query}`);
      if (attempt !== context.request) return;
      context.data = data;
      for (const match of [...(data.upcoming || []), ...(data.inPlay || []), ...(data.finished || [])]) {
        if (!context.predictions[match.id] && match.prediction) context.predictions[match.id] = match.prediction;
      }
    } catch (err) {
      if (attempt === context.request) context.error = err.code || 'unknown';
    } finally {
      if (attempt === context.request) redraw();
    }
  }, [leagueId, name, context, apiFetch, redraw]);

  async function syncNow() {
    if (!leagueId || !name || context.inFlight || !Object.keys(context.pending).length) return;
    const sent = { ...context.pending };
    context.inFlight = true;
    context.syncError = '';
    redraw();
    let refreshFixtures = false;
    try {
      const saved = await syncLeaguePicks((predictions) => apiFetch(`/leagues/${leagueId}/predictions/`, {
        method: 'PUT',
        body: JSON.stringify({ player_name: name, predictions }),
      }), sent, (ids) => {
        refreshFixtures = true;
        for (const id of ids) {
          if (context.pending[id] !== sent[id]) continue;
          context.unavailable[id] = sent[id];
          delete context.pending[id];
        }
        if (mounted.current) saveLeaguePredLocal(storageKey, context);
      });
      for (const id of saved) {
        if (context.pending[id] === sent[id]) delete context.pending[id];
      }
    } catch (err) {
      context.syncError = err.code || 'unknown';
    } finally {
      context.inFlight = false;
      if (mounted.current) saveLeaguePredLocal(storageKey, context);
      redraw();
      if (mounted.current && activeContext.current === context) {
        if (refreshFixtures) loadFixtures();
        if (Object.keys(context.pending).some((id) => context.pending[id] !== sent[id])) scheduleSync();
      }
    }
  }

  function scheduleSync() {
    if (!leagueId || !name) return;
    clearTimeout(context.timer);
    context.timer = setTimeout(syncNow, SYNC_DELAY_MS);
  }

  useEffect(() => {
    loadFixtures();
    if (Object.keys(context.pending).length) scheduleSync();
    return () => {
      clearTimeout(context.timer);
      context.request += 1;
    };
  }, [context, loadFixtures]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleChange(matchId, field, value) {
    const pick = { ...context.predictions[matchId], [field]: value };
    context.predictions[matchId] = pick;
    context.pending[matchId] = pick;
    if (context.unavailable[matchId]) delete context.unavailable[matchId];
    saveLeaguePredLocal(storageKey, context);
    redraw();
    scheduleSync();
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

  const { data, predictions: preds, unavailable } = context;
  const hasPending = Boolean(Object.keys(context.pending).length);
  const hasUnavailable = Boolean(Object.keys(unavailable).length);
  const upcoming = data?.upcoming || [];
  const inPlay = data?.inPlay || [];
  const finished = data?.finished || [];
  const selectedLeague = leagueOptions.find((league) => String(league.id) === leagueId);

  function renderInputRow(match) {
    const pred = preds[match.id] || {};
    return (
      <FixtureRow
        key={match.id}
        className="score-row"
        status={formatKickoff(match.kickoff, locale, t)}
        statusTitle={formatKickoff(match.kickoff, locale, t)}
        home={sideTeam(match, 'home')}
        away={sideTeam(match, 'away')}
        nameMode="full"
        center={
          <div className="score-group">
            <ScoreInput
              value={pred.home_goals}
              onChange={(value) => handleChange(match.id, 'home_goals', value)}
              disabled={!name}
              label={`Home goals, ${match.home_name} versus ${match.away_name}`}
            />
            <span className="score-sep">&ndash;</span>
            <ScoreInput
              value={pred.away_goals}
              onChange={(value) => handleChange(match.id, 'away_goals', value)}
              disabled={!name}
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
    const score = match.result ? `${match.result.home_goals}\u2013${match.result.away_goals}` : t('picks.awaitingResult');
    return (
      <FixtureRow
        key={match.id}
        className="score-row"
        status={match.result ? t('picks.final') : t('picks.locked')}
        statusTone={match.result ? undefined : 'waiting'}
        statusTitle={formatKickoff(match.kickoff, locale, t)}
        home={sideTeam(match, 'home')}
        away={sideTeam(match, 'away')}
        nameMode="full"
        center={
          <div className="score-group real-result">
            <span className="real-score">{score}</span>
            {pick ? (
              <span className={`fx-verdict ${verdict || 'live'}`}>
                {unavailable[match.id]
                  ? t('picks.unsavedPick', { pick })
                  : verdict ? t('picks.verdictPick', { verdict: t(VERDICT_LABEL[verdict]), pick }) : t('picks.yourPick', { pick })}
              </span>
            ) : null}
          </div>
        }
      />
    );
  }

  function renderInPlayRow(match) {
    const pred = preds[match.id];
    const pick = pickSummary(pred);
    const score = match.result ? `${match.result.home_goals}\u2013${match.result.away_goals}` : t('picks.awaitingResult');
    return (
      <FixtureRow
        key={match.id}
        className="score-row"
        status={t('picks.inPlay')}
        statusTone="live"
        statusTitle={formatKickoff(match.kickoff, locale, t)}
        home={sideTeam(match, 'home')}
        away={sideTeam(match, 'away')}
        nameMode="full"
        center={
          <div className="score-group real-result">
            <span className="real-score">{score}</span>
            {pick ? <span className="fx-verdict live">{t(unavailable[match.id] ? 'picks.unsavedPick' : 'picks.yourPick', { pick })}</span> : null}
          </div>
        }
      />
    );
  }

  return (
    <section className="workspace">
      <dialog ref={nameDialogRef} className="name-dialog" aria-labelledby="picks-name-title" onClose={() => nameButtonRef.current?.focus()}>
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
          <h2 id="picks-name-title">{t('picks.namePrompt')}</h2>
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
          <h1>{t('picks.matchPicks')}</h1>
          <p>
            {t('picks.matchPicksText')}
          </p>
        </div>
        <button type="button" className="button secondary" ref={nameButtonRef} aria-haspopup="dialog" onClick={openNameDialog}>
          {t('picks.editName')}{name ? `: ${name}` : ''}
        </button>
      </div>

      {leaguesStatus === 'error' ? (
        <ErrorState
          title={t('teams.leaguesLoadFailed')}
          detail={leaguesError}
          onRetry={onRetryLeagues}
          retryLabel={t('picks.retryLeagues')}
        />
      ) : leaguesStatus === 'loading' || leaguesStatus === 'idle' ? (
        <Skeleton rows={4} label={t('teams.loadingLeagues')} />
      ) : !leagueOptions.length ? (
        <EmptyState
          title={t('picks.noLeagues')}
          text={t('picks.noLeaguesText')}
        />
      ) : (
        <>
          <SegmentControl
            items={leagueItems}
            value={leagueId}
            onChange={setLeagueId}
            className="segment-control homepage-filter"
            label={t('picks.filterByLeague')}
          />

          {context.error && !data ? (
            <ErrorState
              title={t('teams.fixturesLoadFailed')}
              detail={errorText(t, context.error)}
              onRetry={loadFixtures}
              retryLabel={t('picks.retryFixtures')}
            />
          ) : !data ? (
            <Skeleton rows={6} variant="fixture" label={t('teams.loadingFixtures')} />
          ) : (
            <>
              {context.error ? (
                <ErrorState title={t('teams.fixturesLoadFailed')} detail={errorText(t, context.error)} onRetry={loadFixtures} />
              ) : null}
              {context.syncError || hasUnavailable ? (
                <ErrorState
                  title={t('picks.saveFailed')}
                  detail={[
                    context.syncError && t('picks.saveFailedText', { error: errorText(t, context.syncError).replace(/[.!?]$/, '') }),
                    hasUnavailable && t('picks.unavailablePicks'),
                  ].filter(Boolean).join(' ')}
                  onRetry={context.syncError ? syncNow : undefined}
                  retryLabel={t('picks.retrySaving')}
                />
              ) : null}

              <div className="picks-layout">
                <section className="matchday-card-wrap" aria-labelledby="picks-upcoming-heading">
                  <article className="matchday">
                    <div className="matchday-head">
                      <strong id="picks-upcoming-heading">
                        {selectedLeague ? t('picks.upcomingWithLeague', { league: selectedLeague.name }) : t('picks.upcoming')}
                      </strong>
                      <span role="status">
                        {context.inFlight
                          ? t('picks.saving')
                          : context.syncError || hasUnavailable
                            ? t('picks.saveFailed')
                            : hasPending ? t('picks.pending') : t('picks.autoSave')}
                      </span>
                    </div>
                    <div className="fixture-list">
                      {upcoming.length ? (
                        upcoming.map((match) => match.closed ? renderResultRow(match) : renderInputRow(match))
                      ) : (
                        <EmptyState
                          title={t('picks.noUpcoming')}
                          text={t('picks.noUpcomingText')}
                        />
                      )}
                    </div>
                  </article>
                </section>

                {inPlay.length ? (
                  <section className="matchday-card-wrap" aria-labelledby="picks-inplay-heading">
                    <article className="matchday">
                      <div className="matchday-head">
                        <strong id="picks-inplay-heading">{t('picks.inPlay')}</strong>
                        <span>{t('picks.awaitingResult')}</span>
                      </div>
                      <div className="fixture-list">
                        {inPlay.map(renderInPlayRow)}
                      </div>
                    </article>
                  </section>
                ) : null}

                <section className="matchday-card-wrap" aria-labelledby="picks-finished-heading">
                  <article className="matchday">
                    <div className="matchday-head">
                      <strong id="picks-finished-heading">{t('picks.recentResults')}</strong>
                    </div>
                    <div className="fixture-list">
                      {finished.length ? (
                        finished.map(renderResultRow)
                      ) : (
                        <EmptyState
                          title={t('picks.noResults')}
                          text={t('picks.noResultsText')}
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
