import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import './styles.css';
import CareerApp, { hasSavedCareer } from './views/CareerApp';
import PredictionApp from './PredictionApp';
import DrawAnimationStage from './views/DrawAnimationStage';
import Homepage from './views/Homepage';
import InteractiveDraft from './views/InteractiveDraft';
import MatchDetailView from './views/MatchDetailView';
import MatchdayBoard from './views/MatchdayBoard';
import PlayersRuns from './views/PlayersRuns';
import PotBoard from './views/PotBoard';
import RealDrawView from './views/RealDrawView';
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
import { clearLocal, loadLocal } from './predictionStorage';
import { apiFetch } from './lib/api';
import { inHomeRange } from './lib/format';
import { groupBy } from './lib/groupBy';

const PLAYER_STORAGE_KEY = 'champions_draw_player_name';

/* ─── App ─── */

function App() {
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
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(PLAYER_STORAGE_KEY) || '');
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

  function openMatch(fixtureId, seasonId) {
    /* The shared ref holds the last-rendered card button, which need not be the
       one the user activated, so remember the real opener. */
    const active = document.activeElement;
    detailOpenerRef.current = active instanceof HTMLElement && active !== document.body
      ? active
      : detailReturnFocusRef.current;
    setMatchDetail({ fixtureId, seasonId });
  }

  function closeMatch() {
    const opener = detailOpenerRef.current || detailReturnFocusRef.current;
    setMatchDetail(null);
    /* Focus can only land once the `hidden` wrapper has re-rendered: while it is
       still display:none focus() is a no-op and focus falls to <body>. */
    window.requestAnimationFrame(() => opener?.focus());
  }

  /* Shell-owned view-switch policy: mirrors the rail, so entering the workspace
     always lands on a real section instead of its unused 'home' default. */
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
    // Keep refreshing while any today/yesterday match is not finished yet.
    const timer = window.setInterval(() => {
      if (homeMatchesRef.current.some((m) => inHomeRange(m) && !m.result)) loadRealMatches();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [view, selectedSeasonId]);

  // Poll live scores while any closed match lacks a final result.
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
        /* Best-effort background poll (task 4.2): a failure — 502 included —
           belongs to the hub's inline live region. It must never become a
           page-level error and never disables the rest of the page. The copy
           names what failed and the retry, and points at the safe reference
           (the scores already on screen). Only the region's text changes; the
           node itself is never remounted per tick, which is what keeps a
           scrolled reader from being re-announced. */
        setLiveScoresError('Live scores unavailable — retrying every 30 seconds; showing the last known scores.');
      }
    };
    pollLive();
    const timer = window.setInterval(pollLive, 30_000);
    return () => window.clearInterval(timer);
  }, [view, selectedSeasonId, homeMatches]);

  useEffect(() => {
    if (view === 'teams' && leaguesStatus === 'idle') loadLeagues();
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
      // Seasons arrive ordered -name, so seasonPayload[0] is the newest.
      // Default the simulator to it; the season picker in the workspace lets
      // the user switch to any other season.
      const activeSeason = seasonPayload[0];
      if (activeSeason) setSelectedSeasonId(String(activeSeason.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  /* Home hub feed (task 4.1). A refresh failure keeps the cards already on
     screen and reports inline; only a first load with nothing to show becomes
     the error state, so a blip never blanks the hub or becomes a page error. */
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
      setHomeMatchesError(err.message);
    }
  }

  /* League list for the browser (task 4.1). */
  async function loadLeagues() {
    setLeaguesStatus('loading');
    setLeaguesError('');
    try {
      setLeagues(await apiFetch('/leagues/'));
      setLeaguesStatus('success');
    } catch (err) {
      setLeaguesStatus('error');
      setLeaguesError(err.message);
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
      setSeasonStateError(err.message);
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
      localStorage.setItem(PLAYER_STORAGE_KEY, normalizedPlayer);
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
      // the draw seed never changes (season name), so loadLocal's
      // drawSeed-mismatch discard can't tell them apart.
      clearLocal(selectedSeasonId, normalizedPlayer);

      if (drawMethod === 'interactive') {
        setDrawAnimation({ isActive: false, phase: 'idle', revealedCount: 0 });
        setInteractiveState(payload);
        setNotice(`${normalizedPlayer} started an interactive draw — pick teams pot by pot.`);
        await loadSeasonState(selectedSeasonId);
        return;
      }

      setNotice(`${normalizedPlayer} ran ${payload.summary.draw_seed} with ${payload.summary.total_matchups} fixtures.`);
      await loadSeasonState(selectedSeasonId);
      window.setTimeout(() => {
        setDrawAnimation({ isActive: true, phase: 'fixtures', revealedCount: 0 });
      }, 650);
    } catch (err) {
      /* The failure stays on the simulation panel and names itself, with the
         retry re-issuing only the draw POST (US:no-silent-failure). */
      setDrawError(err.message);
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
  // Predicted scores for the current draw, read from the same localStorage
  // snapshot PredictionApp persists to, so the Teams tab shows predictions.
  const teamPredictions = useMemo(
    () => (latestDrawSeed ? (loadLocal(selectedSeasonId, playerName, latestDrawSeed).matchPredictions || {}) : {}),
    [selectedSeasonId, playerName, latestDrawSeed],
  );
  const matchdays = groupBy(seasonState?.matchups || [], 'matchday');
  const pots = groupBy(seasonState?.teams || [], 'pot');

  return (
    <div className="app-layout">
      {/* The shell owns one h1 per view where a view has no single leading
          heading of its own; `career` and `real` already lead with exactly one. */}
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <SiteNav view={view} setView={setView} setActiveTab={setActiveTab} />
      <main className="app-main" id="main-content" aria-label="Main content" tabIndex={-1}>
        <div hidden={!!matchDetail}>
        {view === 'home' && (
          <section className="workspace">
            <h1 className="view-heading">Live hub</h1>
            <Homepage
              matches={homeMatches}
              matchesStatus={homeMatchesStatus}
              matchesError={homeMatchesError}
              onRetryMatches={loadRealMatches}
              liveScores={liveScores}
              liveScoresError={liveScoresError}
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
            <h1 className="view-heading">Leagues</h1>
            <TeamsBrowser
              leagues={leagues}
              leaguesStatus={leaguesStatus}
              leaguesError={leaguesError}
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

        {view === 'career' && (
          <section className="workspace" aria-label="Career mode">
            <CareerApp
              defaultName={playerName}
              seasonTeams={seasonState?.teams || []}
              onCareerAvailabilityChange={setCareerAvailable}
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

        {view === 'workspace' && (
          <section className="workspace">
            <h1 className="view-heading">Draw workspace</h1>
            {loading ? (
              <Skeleton rows={6} label="Loading prediction lab" />
            ) : !seasons.length ? (
              error ? (
                <ErrorState title="Seasons could not load" detail={error} onRetry={loadInitialData} />
              ) : (
                <EmptyState
                  title="No seasons imported yet"
                  text="Import the seed input, then refresh to load the workspace."
                  action={<Button onClick={loadInitialData}>Refresh</Button>}
                />
              )
            ) : (
              <>
                <WorkspaceHeader activeTab={activeTab} setActiveTab={setActiveTab} />
                {(error || notice) && <MessageBar error={error} notice={notice} />}

                {seasonStateStatus === 'loading' || seasonStateStatus === 'idle' ? (
                  <Skeleton rows={6} label="Loading season data" />
                ) : seasonStateStatus === 'error' ? (
                  <ErrorState
                    title="Season data could not load"
                    detail={seasonStateError}
                    onRetry={() => loadSeasonState(selectedSeasonId)}
                    retryLabel="Retry season data"
                  />
                ) : (
                  <>
                {activeTab === 'simulate' && !drawAnimation.isActive && (
                  <>
                    {drawError ? (
                      <ErrorState
                        title="The draw could not be generated"
                        detail={drawError}
                        onRetry={() => generateDraw()}
                        retryLabel="Retry draw"
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

render(<App />, document.getElementById('app'));
