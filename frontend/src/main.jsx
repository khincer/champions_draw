import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  History,
  Home,
  LayoutGrid,
  ListOrdered,
  Play,
  Swords,
  Trophy,
  UserRound,
  Users,
} from 'lucide-preact';
import championsLeagueLogoUrl from './assets/uefa-champions-league-logo.svg';
import './styles.css';
import CareerApp, { hasSavedCareer } from './CareerApp';
import PredictionApp from './PredictionApp';

const API_ROOT = '/api';
const PLAYER_STORAGE_KEY = 'champions_draw_player_name';

function getCookie(name) {
  const cookies = document.cookie ? document.cookie.split('; ') : [];
  for (const cookie of cookies) {
    const [key, ...parts] = cookie.split('=');
    if (key === name) return decodeURIComponent(parts.join('='));
  }
  return '';
}

async function apiFetch(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  };
  const csrfToken = getCookie('csrftoken');
  if (csrfToken && options.method && options.method !== 'GET') {
    headers['X-CSRFToken'] = csrfToken;
  }

  const response = await fetch(`${API_ROOT}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.detail || `Request failed with ${response.status}`);
  }
  return payload;
}

export function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const value = item[key] ?? 'Unassigned';
    groups[value] = groups[value] || [];
    groups[value].push(item);
    return groups;
  }, {});
}

function shortDate(value) {
  if (!value) return 'Pending';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/* ─── Site Nav Sidebar ─── */

function SiteNav({ view, setView, setActiveTab }) {
  return (
    <nav className="site-nav">
      <div className="site-nav-logo">
        <img src={championsLeagueLogoUrl} alt="Champions League" />
      </div>
      <div className="site-nav-links">
        <button
          className={`site-nav-link ${view === 'home' ? 'active' : ''}`}
          onClick={() => setView('home')}
        >
          <Home size={18} />
          Home
        </button>

        <div className="site-nav-section">Simulators</div>
        <button
          className={`site-nav-link ${view === 'workspace' ? 'active' : ''}`}
          onClick={() => { setView('workspace'); setActiveTab('simulate'); }}
        >
          <Trophy size={18} />
          Draw Simulator
        </button>
        <button
          className={`site-nav-link ${view === 'career' ? 'active' : ''}`}
          onClick={() => setView('career')}
        >
          <UserRound size={18} />
          Career Mode
        </button>

        <div className="site-nav-section">Browse</div>
        <button
          className={`site-nav-link ${view === 'teams' ? 'active' : ''}`}
          onClick={() => setView('teams')}
        >
          <LayoutGrid size={18} />
          Teams
        </button>
      </div>
    </nav>
  );
}

/* ─── Homepage ─── */

function Homepage({ homeMatches }) {
  const { recent, upcoming } = homeMatches;

  if (!recent.length && !upcoming.length) {
    return (
      <div className="homepage-matches">
        <StateMessage
          icon={Trophy}
          title="Welcome to the Champions League simulator"
          text="No matches yet. Run a simulation to generate fixtures, or check back once the season begins."
        />
      </div>
    );
  }

  return (
    <div className="homepage-matches">
      <div>
        <div className="match-section-title">
          <History size={16} />
          Recent Results
        </div>
        {recent.length ? recent.map((m) => (
          <div className="match-card" key={m.id}>
            <TeamBadge team={m.home_team} />
            <span className="score">{m.home_score}&ndash;{m.away_score}</span>
            <TeamBadge team={m.away_team} align="right" />
            <span className="match-meta">MD{m.matchday}</span>
          </div>
        )) : <p className="muted">No results yet.</p>}
      </div>
      <div>
        <div className="match-section-title">
          <Play size={16} />
          Upcoming Fixtures
        </div>
        {upcoming.length ? upcoming.map((m) => (
          <div className="match-card" key={m.id}>
            <TeamBadge team={m.home_team} />
            <span className="score">
              {m.kickoff ? shortDate(m.kickoff) : 'TBD'}
            </span>
            <TeamBadge team={m.away_team} align="right" />
            <span className="match-meta">MD{m.matchday}</span>
          </div>
        )) : <p className="muted">No upcoming fixtures.</p>}
      </div>
    </div>
  );
}

/* ─── Teams Browser ─── */

function TeamsBrowser({ leagues, selectedLeague, leagueStandings, setSelectedLeague, setLeagueStandings }) {
  const [loadingStandings, setLoadingStandings] = useState(false);

  async function handleSelectLeague(league) {
    setSelectedLeague(league);
    setLoadingStandings(true);
    try {
      const data = await apiFetch(`/leagues/${league.id}/standings/`);
      setLeagueStandings(Array.isArray(data) ? data : data.standings || []);
    } catch {
      setLeagueStandings([]);
    } finally {
      setLoadingStandings(false);
    }
  }

  if (selectedLeague) {
    return (
      <div style={{ padding: '24px', maxWidth: 1100 }}>
        <button className="back-button" onClick={() => { setSelectedLeague(null); setLeagueStandings([]); }}>
          <ArrowLeft size={16} />
          Back to leagues
        </button>
        <div className="standings-layout">
          <div>
            <h2 style={{ marginTop: 16 }}>{selectedLeague.name}</h2>
            {loadingStandings ? (
              <StateMessage icon={Activity} title="Loading standings" text="Fetching league table" />
            ) : leagueStandings.length ? (
              <table className="standings-table">
                <thead>
                  <tr>
                    <th className="standings-pos">#</th>
                    <th>Team</th>
                    <th>P</th>
                    <th>W</th>
                    <th>D</th>
                    <th>L</th>
                    <th className="standings-pts">Pts</th>
                  </tr>
                </thead>
                <tbody>
                  {leagueStandings.map((row, i) => (
                    <tr key={row.team?.id || i}>
                      <td className="standings-pos">{row.position || i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {row.team?.crest ? (
                            <img src={row.team.crest} alt="" style={{ width: 20, height: 20 }} />
                          ) : row.team?.logo_url ? (
                            <img src={row.team.logo_url} alt="" style={{ width: 20, height: 20 }} />
                          ) : null}
                          {row.team?.name || row.team_name}
                        </div>
                      </td>
                      <td>{row.playedGames ?? row.played}</td>
                      <td>{row.won ?? row.wins}</td>
                      <td>{row.draw ?? row.draws}</td>
                      <td>{row.lost ?? row.losses}</td>
                      <td className="standings-pts">{row.points}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="muted">No standings available.</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100 }}>
      <h2 style={{ marginBottom: 16 }}>Leagues</h2>
      <div className="leagues-grid">
        {leagues.map((league) => (
          <button className="league-card" key={league.id} onClick={() => handleSelectLeague(league)}>
            {league.emblem && <img src={league.emblem} alt="" />}
            <div className="league-card-name">{league.name}</div>
            {league.area?.name && <div className="league-card-country">{league.area.name}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── App ─── */

function App() {
  const [view, setView] = useState('home');
  const [homeMatches, setHomeMatches] = useState({ recent: [], upcoming: [] });
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [leagueStandings, setLeagueStandings] = useState([]);

  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [seasonState, setSeasonState] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [teamDetailId, setTeamDetailId] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(PLAYER_STORAGE_KEY) || '');
  const [drawSeed, setDrawSeed] = useState('prediction-1');
  const [drawMethod, setDrawMethod] = useState('sat');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [drawAnimation, setDrawAnimation] = useState({ isActive: false, phase: 'idle', revealedCount: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [predictionApi] = useState({});
  const [careerAvailable, setCareerAvailable] = useState(() => hasSavedCareer());

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (view === 'home') {
      apiFetch('/homepage/matches/')
        .then(setHomeMatches)
        .catch(() => setHomeMatches({ recent: [], upcoming: [] }));
    }
  }, [view]);

  useEffect(() => {
    if (view === 'teams' && !leagues.length) {
      apiFetch('/leagues/').then(setLeagues).catch(() => {});
    }
  }, [view, leagues.length]);

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
      const activeSeason = seasonPayload.find((season) => season.is_active) || seasonPayload[0];
      if (activeSeason) setSelectedSeasonId(String(activeSeason.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadSeasonState(seasonId) {
    setError('');
    try {
      const payload = await apiFetch(`/ui/seasons/${seasonId}/state/`);
      setSeasonState(payload);
      if (!selectedTeamId && payload.teams.length) {
        setSelectedTeamId(payload.teams[0].id);
      }
      return payload;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }

  async function generateDraw({ fresh = false } = {}) {
    if (!selectedSeasonId) return;
    setActiveTab('simulate');
    setDrawAnimation({ isActive: true, phase: 'pots', revealedCount: 0 });
    setWorking(true);
    setError('');
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
      setNotice(`${normalizedPlayer} ran ${payload.summary.draw_seed} with ${payload.summary.total_matchups} fixtures.`);
      await loadSeasonState(selectedSeasonId);
      window.setTimeout(() => {
        setDrawAnimation({ isActive: true, phase: 'fixtures', revealedCount: 0 });
      }, 650);
    } catch (err) {
      setError(err.message);
      setDrawAnimation({ isActive: false, phase: 'idle', revealedCount: 0 });
      await loadSeasonState(selectedSeasonId);
    } finally {
      setWorking(false);
    }
  }

  const selectedTeam = useMemo(() => {
    return seasonState?.teams.find((team) => team.id === selectedTeamId) || seasonState?.teams[0] || null;
  }, [seasonState, selectedTeamId]);

  const teamMatchups = useMemo(() => {
    if (!selectedTeam || !seasonState) return [];
    return seasonState.matchups.filter(
      (matchup) => matchup.home_team.id === selectedTeam.id || matchup.away_team.id === selectedTeam.id,
    );
  }, [selectedTeam, seasonState]);

  const latestDraw = seasonState?.draws?.[0];
  const matchdays = groupBy(seasonState?.matchups || [], 'matchday');
  const pots = groupBy(seasonState?.teams || [], 'pot');

  return (
    <div className="app-layout">
      <SiteNav view={view} setView={setView} setActiveTab={setActiveTab} />
      <main className="app-main">
        {view === 'home' && (
          <section className="workspace">
            <Homepage homeMatches={homeMatches} />
            <AppFooter />
          </section>
        )}

        {view === 'teams' && (
          <section className="workspace">
            <TeamsBrowser
              leagues={leagues}
              selectedLeague={selectedLeague}
              leagueStandings={leagueStandings}
              setSelectedLeague={setSelectedLeague}
              setLeagueStandings={setLeagueStandings}
            />
            <AppFooter />
          </section>
        )}

        {view === 'career' && (
          <main className="app-shell career-app-shell">
            <CareerApp
              defaultName={playerName}
              seasonTeams={seasonState?.teams || []}
              onHome={() => setView('home')}
              onCareerAvailabilityChange={setCareerAvailable}
            />
            <AppFooter />
          </main>
        )}

        {view === 'workspace' && (
          <section className="workspace">
            {loading ? (
              <StateMessage icon={Activity} title="Loading prediction lab" text="Fetching seasons, pots, and recent simulations." />
            ) : (
              <>
                <WorkspaceHeader activeTab={activeTab} setActiveTab={setActiveTab} />
                {(error || notice) && <MessageBar error={error} notice={notice} />}

                {activeTab === 'simulate' && !drawAnimation.isActive && (
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
                      )}
                      {activeTab === 'matchdays' && <MatchdayBoard matchdays={matchdays} />}
                      {activeTab === 'pots' && <PotBoard pots={pots} selectedTeamId={selectedTeam?.id} setSelectedTeamId={setSelectedTeamId} onTeamClick={(id) => { setTeamDetailId(id); setActiveTab('teams'); }} />}
                      {activeTab === 'teams' && (
                        <TeamDetailPage
                          teams={seasonState?.teams || []}
                          teamId={teamDetailId}
                          setTeamId={setTeamDetailId}
                          matchups={seasonState?.matchups || []}
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
                    />
                  </section>
                )}
                <AppFooter />
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function WorkspaceHeader({ activeTab, setActiveTab }) {
  return (
    <header className="workspace-header">
      <ChampionsLeagueLogo />
      <ViewTabs activeTab={activeTab} setActiveTab={setActiveTab} />
    </header>
  );
}

function ChampionsLeagueLogo() {
  return (
    <div className="champions-logo" aria-label="Champions League">
      <img src={championsLeagueLogoUrl} alt="UEFA Champions League logo" />
    </div>
  );
}

function AppFooter() {
  return <footer className="app-footer">Unofficial draw simulator for fan predictions.</footer>;
}

function DrawAnimationStage({ phase, pots, matchups, revealedCount }) {
  const revealedMatchups = matchups.slice(0, revealedCount);
  const revealedByMatchday = groupBy(revealedMatchups, 'matchday');

  return (
    <section className="draw-animation-stage">
      <div className="draw-animation-head">
        <div>
          <h2>{phase === 'pots' ? 'Loading the four pots' : 'Building the league-phase fixtures'}</h2>
          <p>{phase === 'pots' ? 'The draw starts from the seeded pots.' : `${revealedMatchups.length} of ${matchups.length} fixtures placed.`}</p>
        </div>
        <span className="draw-pulse" />
      </div>

      <div className="animated-pot-grid">
        {['1', '2', '3', '4'].map((pot, index) => (
          <article className="animated-pot" style={{ '--delay': `${index * 90}ms` }} key={pot}>
            <div className="pot-head">
              <strong>Pot {pot}</strong>
              <span>{pots[pot]?.length || 0} teams</span>
            </div>
            <div className="animated-team-list">
              {(pots[pot] || []).map((team) => (
                <span className="animated-team" key={team.id}>
                  <TeamLogo team={team} size="sm" />
                  <strong>{team.short_name}</strong>
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      {phase === 'fixtures' && (
        <div className="animated-fixtures">
          {Array.from({ length: 8 }, (_, index) => String(index + 1)).map((matchday) => {
            const fixtures = revealedByMatchday[matchday] || [];
            return (
              <article className="animated-matchday" key={matchday}>
                <div className="matchday-head">
                  <strong>Matchday {matchday}</strong>
                  <span>{fixtures.length} fixtures</span>
                </div>
                <div className="fixture-list">
                  {fixtures.slice(0, 5).map((fixture) => (
                    <FixtureRow fixture={fixture} key={fixture.id} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SimulationPanel({
  playerName,
  setPlayerName,
  seasons,
  selectedSeasonId,
  setSelectedSeasonId,
  drawMethod,
  setDrawMethod,
  working,
  generateDraw,
}) {
  return (
    <section className="command-band">
      <div>
        <h1>Run your Champions League simulation</h1>
        <p>
          Enter your player name, choose a season, and publish a league-phase prediction. Every run is saved so other
          players can compare fixtures, pots, and outcomes.
        </p>
      </div>
      <div className="draw-controls">
        <label className="seed-input">
          <span>Player name</span>
          <input
            value={playerName}
            maxLength={80}
            placeholder="Your name"
            onInput={(event) => setPlayerName(event.currentTarget.value)}
          />
        </label>
        <label className="seed-input">
          <span>Season year</span>
          <select value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.currentTarget.value)}>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </label>
        <label className="seed-input">
          <span>Draw method</span>
          <select value={drawMethod} onChange={(event) => setDrawMethod(event.currentTarget.value)}>
            <option value="sat">SAT (uniform)</option>
            <option value="sequential">Sequential (UEFA-style)</option>
          </select>
        </label>
        <button className="button primary" disabled={working || !selectedSeasonId} onClick={() => generateDraw()}>
          <Play size={16} />
          {working ? 'Running' : 'Run simulation'}
        </button>
      </div>
    </section>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MessageBar({ error, notice }) {
  return (
    <div className={`message-bar ${error ? 'error' : 'notice'}`}>
      {error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}
      <span>{error || notice}</span>
    </div>
  );
}

function ViewTabs({ activeTab, setActiveTab }) {
  return (
    <div className="view-tabs">
      {[
        ['simulate', 'Run simulation'],
        ['matchdays', 'Fixtures'],
        ['predict', 'Predict'],
        ['pots', 'Pots'],
        ['teams', 'Teams'],
        ['history', 'Saved runs'],
      ].map(([key, label]) => (
        <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function MatchdayBoard({ matchdays }) {
  const orderedMatchdays = Array.from({ length: 8 }, (_, index) => String(index + 1));
  return (
    <section className="board">
      {orderedMatchdays.map((matchday) => {
        const fixtures = matchdays[matchday] || [];
        return (
          <article className="matchday" key={matchday}>
            <div className="matchday-head">
              <strong>Matchday {matchday}</strong>
              <span>{fixtures.length} fixtures</span>
            </div>
            <div className="fixture-list">
              {fixtures.length ? (
                fixtures.slice(0, 9).map((fixture) => <FixtureRow fixture={fixture} key={fixture.id} />)
              ) : (
                <span className="empty-row">Run a simulation to fill this matchday.</span>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function FixtureRow({ fixture }) {
  return (
    <div className="fixture-row">
      <TeamBadge team={fixture.home_team} />
      <span className="versus">vs</span>
      <TeamBadge team={fixture.away_team} align="right" />
    </div>
  );
}

function TeamBadge({ team, align }) {
  return (
    <span className={`team-badge ${align === 'right' ? 'right' : ''}`}>
      <TeamLogo team={team} size="sm" />
      <b>{team.short_name}</b>
      <span>{team.association.code}</span>
    </span>
  );
}

function TeamLogo({ team, size = 'md' }) {
  const [failed, setFailed] = useState(false);
  const showImage = team.logo_url && !failed;
  return (
    <span className={`team-logo ${size}`}>
      {showImage ? (
        <img src={team.logo_url} alt={`${team.name} badge`} loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span>{team.short_name.slice(0, 3)}</span>
      )}
    </span>
  );
}

function PotBoard({ pots, selectedTeamId, setSelectedTeamId, onTeamClick }) {
  return (
    <section className="pot-grid">
      {['1', '2', '3', '4'].map((pot) => (
        <article className="pot-panel" key={pot}>
          <div className="pot-head">
            <strong>Pot {pot}</strong>
            <span>{pots[pot]?.length || 0} teams</span>
          </div>
          {(pots[pot] || []).map((team) => (
            <button
              className={`team-row ${selectedTeamId === team.id ? 'selected' : ''}`}
              key={team.id}
              onClick={() => {
                setSelectedTeamId(team.id);
                if (onTeamClick) onTeamClick(team.id);
              }}
            >
              <span>{team.seeding_position}</span>
              <TeamLogo team={team} size="sm" />
              <strong>{team.name}</strong>
              <em>{team.association.code}</em>
            </button>
          ))}
        </article>
      ))}
    </section>
  );
}

function TeamDetailPage({ teams, teamId, setTeamId, matchups, onBack }) {
  const team = teams.find((t) => t.id === teamId) || teams[0];
  const teamMatchups = matchups.filter(
    (m) => m.home_team.id === team?.id || m.away_team.id === team?.id,
  ).sort((a, b) => a.matchday - b.matchday);

  if (!team) {
    return <StateMessage icon={Users} title="No teams" text="No teams found for this season." />;
  }

  return (
    <section className="team-detail-page">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        Back
      </button>

      <div className="team-detail-header">
        <TeamLogo team={team} size="lg" />
        <div>
          <h1>{team.name}</h1>
          <p className="team-detail-meta">
            {team.association.name} · Pot {team.pot} · Seed {team.seeding_position}
          </p>
          <p className="team-detail-coeff">UEFA Club Coefficient: {team.uefa_club_coefficient}</p>
          {team.is_title_holder && <span className="badge badge-gold">Title Holder</span>}
          {team.qualified_via !== 'LEAGUE_POSITION' && (
            <span className="badge badge-blue">{team.qualified_via.replace(/_/g, ' ').toLowerCase()}</span>
          )}
        </div>
      </div>

      <div className="team-detail-select">
        <label>
          <span>View team</span>
          <select value={team.id} onChange={(e) => setTeamId(Number(e.target.value))}>
            {teams.map((t) => (
              <option value={t.id} key={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>

      <h2>Fixtures</h2>
      {teamMatchups.length ? (
        <div className="team-fixtures">
          {teamMatchups.map((m) => {
            const isHome = m.home_team.id === team.id;
            const opponent = isHome ? m.away_team : m.home_team;
            return (
              <div className="team-fixture-row" key={m.id}>
                <span className="matchday-chip">MD{m.matchday}</span>
                <TeamBadge team={isHome ? m.home_team : m.away_team} />
                <span className="versus">vs</span>
                <TeamBadge team={opponent} align="right" />
                <span className={`venue-chip ${isHome ? 'home' : 'away'}`}>{isHome ? 'H' : 'A'}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Run a simulation to see this team's fixtures.</p>
      )}
    </section>
  );
}

function PlayersRuns({ draws }) {
  return (
    <section className="history-list">
      {draws.length ? (
        draws.map((draw) => (
          <article className="history-row" key={draw.id}>
            <span className={`status-dot ${draw.status.toLowerCase()}`} />
            <div>
              <strong>{draw.player_name || 'Guest player'}</strong>
              <span>{draw.draw_seed} · {draw.method} - {draw.status} - {draw.matchups_created} fixtures - {shortDate(draw.completed_at)}</span>
              {draw.error_message && <em>{draw.error_message}</em>}
            </div>
          </article>
        ))
      ) : (
        <StateMessage icon={History} title="No player runs yet" text="Run the first simulation and it will appear here." />
      )}
    </section>
  );
}

function TeamInspector({ team, teams, selectedTeamId, setSelectedTeamId, matchups }) {
  if (!team) {
    return <aside className="inspector"><StateMessage icon={Users} title="No team selected" text="Choose a team from a pot." /></aside>;
  }
  return (
    <aside className="inspector">
      <label className="team-picker">
        <span>Inspect team</span>
        <select value={selectedTeamId || ''} onChange={(event) => setSelectedTeamId(Number(event.currentTarget.value))}>
          {teams.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inspector-head">
        <TeamLogo team={team} size="lg" />
        <span>{team.association.name}</span>
        <h2>{team.name}</h2>
        <p>Pot {team.pot} - Seed {team.seeding_position} - Coeff. {team.uefa_club_coefficient}</p>
      </div>
      <div className="opponent-list">
        <strong>Opponents</strong>
        {matchups.length ? (
          matchups
            .sort((a, b) => a.matchday - b.matchday)
            .map((matchup) => {
              const isHome = matchup.home_team.id === team.id;
              const opponent = isHome ? matchup.away_team : matchup.home_team;
              return (
                <div className="opponent-row" key={matchup.id}>
                  <span>MD{matchup.matchday}</span>
                  <TeamLogo team={opponent} size="sm" />
                  <strong>{opponent.name}</strong>
                  <em>{isHome ? 'Home' : 'Away'} - Pot {opponent.pot}</em>
                </div>
              );
            })
        ) : (
          <p className="muted">Run a simulation to inspect this team's eight fixtures.</p>
        )}
      </div>
    </aside>
  );
}

function StateMessage({ icon: Icon, title, text }) {
  return (
    <div className="state-message">
      <Icon size={22} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

render(<App />, document.getElementById('app'));
