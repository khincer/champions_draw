import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './styles.css';
import CareerApp, { hasSavedCareer } from './views/CareerApp';
import PredictionApp from './views/PredictionApp';
import DrawAnimationStage from './views/DrawAnimationStage';
import Homepage from './views/Homepage';
import InteractiveDraft from './views/InteractiveDraft';
import MatchDetailView from './views/MatchDetailView';
import MatchdayBoard from './views/MatchdayBoard';
import PlayersRuns from './views/PlayersRuns';
import PotBoard from './views/PotBoard';
import RealDrawView from './views/RealDrawView';
import LeaguePredictionsView from './views/LeaguePredictionsView';
import SimulationPanel from './views/SimulationPanel';
import TeamDetailPage from './views/TeamDetailPage';
import TeamInspector from './views/TeamInspector';
import TeamsBrowser from './views/TeamsBrowser';
import Button from './components/Button';
import MessageBar from './components/MessageBar';
import MobileNav from './components/MobileNav';
import { EmptyState, ErrorState, Skeleton } from './components/States';
import AppFooter from './components/shell/AppFooter';
import SiteNav from './components/shell/SiteNav';
import ViewTabs from './components/shell/ViewTabs';
import WorkspaceHeader from './components/shell/WorkspaceHeader';
import { clearLocal, loadLocal } from './lib/predictionStorage';
import { apiFetch } from './lib/api';
import { inHomeRange } from './lib/format';
import { groupBy } from './lib/groupBy';
import { I18nProvider, useI18n } from './i18n';

const PLAYER_STORAGE_KEY = 'champions_draw_player_name';

/* Guarded exactly like lib/theme.js: a blocked read yields the default, a
   blocked write degrades to session-only. The mount must survive blocked
   storage rather than throwing inside a state initializer. */
function readStoredPlayerName() {
  try {
    return window.localStorage.getItem(PLAYER_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function writeStoredPlayerName(name) {
  try {
    window.localStorage.setItem(PLAYER_STORAGE_KEY, name);
  } catch {
    // Storage unavailable (private mode) — the name still applies for this session.
  }
}

/* Failures carry a stable machine code (lib/api.js) and the shell notices name
   their own catalogue key. Resolving either one at render time keeps the copy
   in step with the active locale; an unrecognised code falls back to the
   generic message, so a failure can never surface a raw key or backend text. */
function errorText(t, value) {
  if (!value) return '';
  const key = value.includes('.') ? value : `errors.${value}`;
  const text = t(key);
  return text === key ? t('errors.unknown') : text;
}

/* ─── App ─── */

function App() {
  const { t } = useI18n();
  const [view, setView] = useState('home');
  const [homeMatches, setHomeMatches] = useState([]);
  const [homeMatchesStatus, setHomeMatchesStatus] = useState('idle');
  const [homeMatchesError, setHomeMatchesError] = useState('');
  const homeMatchesRef = useRef([]);
  const [liveScores, setLiveScores] = useState({});
  const [liveScoresError, setLiveScoresError] = useState('');
  const [leagues, setLeagues] = useState([]);
  const [leaguesStatus, setLeaguesStatus] = useState('idle');
  const [leaguesError, setLeaguesError] = useState('');
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [leagueStandings, setLeagueStandings] = useState([]);
  const [leagueMatches, setLeagueMatches] = useState({ finished: [], upcoming: [] });
  const [viewTeam, setViewTeam] = useState(null);

  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [seasonState, setSeasonState] = useState(null);
  const [seasonStateStatus, setSeasonStateStatus] = useState('idle');
  const [seasonStateError, setSeasonStateError] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [teamDetailId, setTeamDetailId] = useState(null);
  const [playerName, setPlayerName] = useState(readStoredPlayerName);
  const [drawSeed, setDrawSeed] = useState('prediction-1');
  const [drawMethod, setDrawMethod] = useState('sat');
  const [interactiveState, setInteractiveState] = useState(null);
  const [revealedOpponentIds, setRevealedOpponentIds] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [drawAnimation, setDrawAnimation] = useState({ isActive: false, phase: 'idle', revealedCount: 0 });
  const [error, setError] = useState('');
  const [drawError, setDrawError] = useState('');
  const [notice, setNotice] = useState('');
  const [predictionApi] = useState({});
  const [careerAvailable, setCareerAvailable] = useState(() => hasSavedCareer());
  const [matchDetail, setMatchDetail] = useState(null);
  const detailReturnFocusRef = useRef(null);
  const detailOpenerRef = useRef(null);

  function openMatch(fixtureId, seasonId, leagueId) {
    
    const active = document.activeElement;
    detailOpenerRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : detailReturnFocusRef.current;
    setMatchDetail({ fixtureId, seasonId, leagueId });
  }

  function closeMatch() {
    const opener = detailOpenerRef.current || detailReturnFocusRef.current;
    setMatchDetail(null);
    window.requestAnimationFrame(() => opener?.focus());
  }

  function selectView(next) {
    setView(next);
    if (next === 'workspace') setActiveTab('simulate');
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (view !== 'home' || !selectedSeasonId) return undefined;
    loadRealMatches();
    const timer = window.setInterval(() => {
      if (homeMatchesRef.current.some((m) => inHomeRange(m) && !m.result)) loadRealMatches();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [view, selectedSeasonId]);

  useEffect(() => {
    if (view !== 'home' || !selectedSeasonId) return undefined;
    const anyAwaiting = homeMatchesRef.current.some((m) => m.closed && !m.result);
    if (!anyAwaiting) return undefined;
    const pollLive = async () => {
      try {
        const data = await apiFetch(`/ui/seasons/${selectedSeasonId}/live-scores/`);
        setLiveScores(data.live || {});
        setLiveScoresError('');
      } catch {
        setLiveScoresError('shell.liveScoresUnavailable');
      }
    };
    pollLive();
    const timer = window.setInterval(pollLive, 30_000);
    return () => window.clearInterval(timer);
  }, [view, selectedSeasonId, homeMatches]);

  useEffect(() => {
    if ((view === 'teams' || view === 'picks') && leaguesStatus === 'idle') loadLeagues();
  }, [view, leaguesStatus]);

  useEffect(() => {
    if (selectedSeasonId) {
      loadSeasonState(selectedSeasonId);
    }
  }, [selectedSeasonId]);

  useEffect(() => {
    if (!drawAnimation.isActive || drawAnimation.phase !== 'fixtures') return undefined;

    const totalMatchups = seasonState?.matchups?.length || 0;
    if (!totalMatchups) return undefined;

    const timer = window.setInterval(() => {
      setDrawAnimation((current) => {
        if (!current.isActive || current.phase !== 'fixtures') return current;
        const nextCount = Math.min(current.revealedCount + 8, totalMatchups);
        if (nextCount >= totalMatchups) {
          window.setTimeout(() => {
            setDrawAnimation({ isActive: false, phase: 'idle', revealedCount: 0 });
            setActiveTab('matchdays');
          }, 700);
          return { ...current, phase: 'complete', revealedCount: nextCount };
        }
        return { ...current, revealedCount: nextCount };
      });
    }, 120);

    return () => window.clearInterval(timer);
  }, [drawAnimation.isActive, drawAnimation.phase, seasonState?.matchups?.length]);

  async function loadInitialData() {
    setLoading(true);
    setError('');
    try {
      const seasonPayload = await apiFetch('/seasons/');
      setSeasons(seasonPayload);
      
      const activeSeason = seasonPayload[0];
      if (activeSeason) setSelectedSeasonId(String(activeSeason.id));
    } catch (err) {
      setError(err.code);
    } finally {
      setLoading(false);
    }
  }

  async function loadRealMatches() {
    const hadCards = homeMatchesRef.current.length > 0;
    if (!hadCards) setHomeMatchesStatus('loading');
    try {
      const payload = await apiFetch('/homepage/matches/');
      homeMatchesRef.current = payload.matchups || [];
      setHomeMatches(payload.matchups || []);
      setHomeMatchesStatus('success');
      setHomeMatchesError('');
    } catch (err) {
      setHomeMatchesStatus(hadCards ? 'success' : 'error');
      setHomeMatchesError(err.code);
    }
  }

  async function loadLeagues() {
    setLeaguesStatus('loading');
    setLeaguesError('');
    try {
      setLeagues(await apiFetch('/leagues/'));
      setLeaguesStatus('success');
    } catch (err) {
      setLeaguesStatus('error');
      setLeaguesError(err.code);
    }
  }

  async function loadSeasonState(seasonId) {
    setError('');
    setSeasonStateStatus('loading');
    setSeasonStateError('');
    try {
      const payload = await apiFetch(`/ui/seasons/${seasonId}/state/`);
      setSeasonState(payload);
      setSeasonStateStatus('success');
      if (!selectedTeamId && payload.teams.length) {
        setSelectedTeamId(payload.teams[0].id);
      }
      return payload;
    } catch (err) {
      setSeasonStateStatus('error');
      setSeasonStateError(err.code);
      return null;
    }
  }

  async function generateDraw({ fresh = false } = {}) {
    if (!selectedSeasonId) return;
    setActiveTab('simulate');
    setDrawAnimation({ isActive: true, phase: 'pots', revealedCount: 0 });
    setWorking(true);
    setDrawError('');
    setNotice('');
    try {
      const season = seasons.find((s) => String(s.id) === String(selectedSeasonId));
      const seed = season ? season.name : `prediction-${Date.now()}`;
      const normalizedPlayer = playerName.trim() || 'Guest player';
      writeStoredPlayerName(normalizedPlayer);
      setPlayerName(normalizedPlayer);
      setDrawSeed(seed);

      const payload = await apiFetch(`/seasons/${selectedSeasonId}/draw/`, {
        method: 'POST',
        body: JSON.stringify({
          seed,
          reset: true,
          player_name: normalizedPlayer,
          method: drawMethod,
        }),
      });

      // A fresh simulation must not inherit the previous run's predictions:
      // the draw seed never changes, so loadLocal's
      // drawSeed-mismatch discard can't tell them apart.
      clearLocal(selectedSeasonId, normalizedPlayer);

      if (drawMethod === 'interactive') {
        setDrawAnimation({ isActive: false, phase: 'idle', revealedCount: 0 });
        setInteractiveState(payload);
        setNotice({ key: 'shell.interactiveStarted', params: { player: normalizedPlayer } });
        await loadSeasonState(selectedSeasonId);
        return;
      }

      setNotice({
        key: 'shell.drawRanFixtures',
        params: {
          player: normalizedPlayer,
          seed: payload.summary.draw_seed,
          count: payload.summary.total_matchups,
        },
      });
      await loadSeasonState(selectedSeasonId);
      window.setTimeout(() => {
        setDrawAnimation({ isActive: true, phase: 'fixtures', revealedCount: 0 });
      }, 650);
    } catch (err) {
      /* The failure stays on the simulation panel and names itself, with the
         retry re-issuing only the draw POST. */
      setDrawError(err.code);
      setDrawAnimation({ isActive: false, phase: 'idle', revealedCount: 0 });
      await loadSeasonState(selectedSeasonId);
    } finally {
      setWorking(false);
    }
  }

  const selectedTeam = useMemo(() => {
    const teams = interactiveState ? interactiveState.teams : seasonState?.teams || [];
    return teams.find((team) => team.id === selectedTeamId) || teams[0] || null;
  }, [interactiveState, seasonState, selectedTeamId]);

  async function makeInteractiveComplete() {
    setInteractiveState(null);
    setDrawAnimation({ isActive: false, phase: 'idle', revealedCount: 0 });
    setActiveTab('matchdays');
    await loadSeasonState(selectedSeasonId);
  }

  const teamMatchups = useMemo(() => {
    if (!selectedTeam) return [];
    const matchups = interactiveState ? interactiveState.matchups || [] : seasonState?.matchups || [];
    return matchups.filter(
      (matchup) => matchup.home_team.id === selectedTeam.id || matchup.away_team.id === selectedTeam.id,
    );
  }, [selectedTeam, interactiveState, seasonState]);

  const latestDraw = seasonState?.draws?.[0];
  const latestDrawSeed = latestDraw?.draw_seed;
  const teamPredictions = useMemo(
    () => (latestDrawSeed ? (loadLocal(selectedSeasonId, playerName, latestDrawSeed).matchPredictions || {}) : {}),
    [selectedSeasonId, playerName, latestDrawSeed],
  );
  const matchdays = groupBy(seasonState?.matchups || [], 'matchday');
  const pots = groupBy(seasonState?.teams || [], 'pot');

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main-content">{t('a11y.skipToMainContent')}</a>
      <SiteNav view={view} setView={setView} setActiveTab={setActiveTab} />
      <main className="app-main" id="main-content" aria-label={t('a11y.mainContent')} tabIndex={-1}>
        <div hidden={!!matchDetail}>
        {view === 'home' && (
          <section className="workspace">
            <Homepage
              matches={homeMatches}
              matchesStatus={homeMatchesStatus}
              matchesError={errorText(t, homeMatchesError)}
              onRetryMatches={loadRealMatches}
              liveScores={liveScores}
              liveScoresError={errorText(t, liveScoresError)}
              onOpenMatch={openMatch}
              onNavigate={selectView}
              playerName={playerName}
              seasonId={selectedSeasonId}
              detailReturnFocusRef={detailReturnFocusRef}
            />
            <AppFooter />
          </section>
        )}

        {view === 'teams' && (
          <section className="workspace">
            <h1 className="view-heading">{t('shell.leaguesTitle')}</h1>
            <TeamsBrowser
              leagues={leagues}
              leaguesStatus={leaguesStatus}
              leaguesError={errorText(t, leaguesError)}
              onRetryLeagues={loadLeagues}
              selectedLeague={selectedLeague}
              leagueStandings={leagueStandings}
              setSelectedLeague={setSelectedLeague}
              setLeagueStandings={setLeagueStandings}
              leagueMatches={leagueMatches}
              setLeagueMatches={setLeagueMatches}
              viewTeam={viewTeam}
              setViewTeam={setViewTeam}
            />
            <AppFooter />
          </section>
        )}


        {view === 'real' && (
          <RealDrawView
            seasons={seasons}
            seasonId={selectedSeasonId}
            setSeasonId={setSelectedSeasonId}
            playerName={playerName}
            setPlayerName={setPlayerName}
            apiFetch={apiFetch}
            onOpenMatch={openMatch}
          />
        )}

        {view === 'picks' && (
          <LeaguePredictionsView
            leagues={leagues}
            leaguesStatus={leaguesStatus}
            leaguesError={errorText(t, leaguesError)}
            onRetryLeagues={loadLeagues}
            playerName={playerName}
            setPlayerName={setPlayerName}
            apiFetch={apiFetch}
          />
        )}

        {view === 'workspace' && (
          <section className="workspace">
            <h1 className="view-heading">{t('shell.workspaceTitle')}</h1>
            {loading ? (
              <Skeleton rows={6} label={t('shell.loadingPredictionLab')} />
            ) : !seasons.length ? (
              error ? (
                <ErrorState title={t('states.seasonsLoadFailed')} detail={errorText(t, error)} onRetry={loadInitialData} />
              ) : (
                <EmptyState
                  title={t('states.noSeasons')}
                  text={t('states.noSeasonsText')}
                  action={<Button onClick={loadInitialData}>{t('states.refresh')}</Button>}
                />
              )
            ) : (
              <>
                <WorkspaceHeader activeTab={activeTab} setActiveTab={setActiveTab} />
                {(error || notice) && (
                  <MessageBar error={errorText(t, error)} notice={notice ? t(notice.key, notice.params) : ''} />
                )}

                {seasonStateStatus === 'loading' || seasonStateStatus === 'idle' ? (
                  <Skeleton rows={6} label={t('shell.loadingSeasonData')} />
                ) : seasonStateStatus === 'error' ? (
                  <ErrorState
                    title={t('states.seasonDataLoadFailed')}
                    detail={errorText(t, seasonStateError)}
                    onRetry={() => loadSeasonState(selectedSeasonId)}
                    retryLabel={t('states.retrySeasonData')}
                  />
                ) : (
                  <>
                {activeTab === 'simulate' && !drawAnimation.isActive && (
                  <>
                    {drawError ? (
                      <ErrorState
                        title={t('states.drawFailed')}
                        detail={errorText(t, drawError)}
                        onRetry={() => generateDraw()}
                        retryLabel={t('states.retryDraw')}
                      />
                    ) : null}
                    <SimulationPanel
                      playerName={playerName}
                      setPlayerName={setPlayerName}
                      seasons={seasons}
                      selectedSeasonId={selectedSeasonId}
                      setSelectedSeasonId={setSelectedSeasonId}
                      drawMethod={drawMethod}
                      setDrawMethod={setDrawMethod}
                      working={working}
                      generateDraw={generateDraw}
                    />
                  </>
                )}

                {activeTab === 'predict' ? (
                  <PredictionApp
                    seasonId={selectedSeasonId}
                    playerName={playerName}
                    seasonState={seasonState}
                    predictionApi={predictionApi}
                    apiFetch={apiFetch}
                  />
                ) : (
                  <section className="content-grid">
                    <div className="primary-column">
                      {activeTab === 'simulate' && (
                        drawMethod === 'interactive' && interactiveState ? (
                          <InteractiveDraft
                            seasonId={selectedSeasonId}
                            state={interactiveState}
                            setState={setInteractiveState}
                            apiFetch={apiFetch}
                            selectedTeamId={selectedTeam?.id}
                            setSelectedTeamId={setSelectedTeamId}
                            onComplete={makeInteractiveComplete}
                            onReveal={setRevealedOpponentIds}
                          />
                        ) : (
                          drawAnimation.isActive ? (
                            <DrawAnimationStage
                              phase={drawAnimation.phase}
                              pots={pots}
                              matchups={seasonState?.matchups || []}
                              revealedCount={drawAnimation.revealedCount}
                            />
                          ) : (
                            <MatchdayBoard matchdays={matchdays} />
                          )
                        )
                      )}
                      {activeTab === 'matchdays' && <MatchdayBoard matchdays={matchdays} />}
                      {activeTab === 'pots' && <PotBoard pots={pots} selectedTeamId={selectedTeam?.id} setSelectedTeamId={setSelectedTeamId} onTeamClick={(id) => { setTeamDetailId(id); setActiveTab('teams'); }} />}
                      {activeTab === 'teams' && (
                        <TeamDetailPage
                          teams={seasonState?.teams || []}
                          teamId={teamDetailId}
                          setTeamId={setTeamDetailId}
                          matchups={seasonState?.matchups || []}
                          predictions={teamPredictions}
                          onBack={() => setActiveTab('pots')}
                        />
                      )}
                      {activeTab === 'history' && <PlayersRuns draws={seasonState?.draws || []} />}
                    </div>
                    <TeamInspector
                      team={selectedTeam}
                      teams={seasonState?.teams || []}
                      selectedTeamId={selectedTeam?.id}
                      setSelectedTeamId={setSelectedTeamId}
                      matchups={teamMatchups}
                      interactive={Boolean(interactiveState)}
                      revealedOpponentIds={revealedOpponentIds}
                    />
                  </section>
                )}
                  </>
                )}
                <AppFooter />
              </>
            )}
          </section>
        )}
        </div>
        {matchDetail && (
          <MatchDetailView
            fixtureId={matchDetail.fixtureId}
            seasonId={matchDetail.seasonId}
            leagueId={matchDetail.leagueId}
            onBack={closeMatch}
            detailReturnFocusRef={detailReturnFocusRef}
          />
        )}
      </main>
      <MobileNav
        view={view}
        onSelectView={selectView}
        overlayOpen={!!matchDetail}
        tabs={view === 'workspace' ? <ViewTabs activeTab={activeTab} setActiveTab={setActiveTab} /> : null}
      />
    </div>
  );
}

render(
  <I18nProvider>
    <App />
  </I18nProvider>,
  document.getElementById('app'),
);
