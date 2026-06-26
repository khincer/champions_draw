import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  History,
  Play,
  Users,
} from 'lucide-preact';
import './styles.css';

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

function groupBy(items, key) {
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

function App() {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [seasonState, setSeasonState] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem(PLAYER_STORAGE_KEY) || '');
  const [drawSeed, setDrawSeed] = useState('prediction-1');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [drawAnimation, setDrawAnimation] = useState({ isActive: false, phase: 'idle', revealedCount: 0 });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadInitialData();
  }, []);

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
      const seed = fresh ? `prediction-${Date.now()}` : drawSeed.trim() || `prediction-${Date.now()}`;
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

  if (activeTab === 'home') {
    return (
      <main className="homepage-shell">
        {loading ? (
          <StateMessage icon={Activity} title="Loading prediction lab" text="Fetching seasons, pots, and recent simulations." />
        ) : (
          <>
            <LandingPage working={working} generateDraw={generateDraw} setActiveTab={setActiveTab} />
            <AppFooter />
          </>
        )}
      </main>
    );
  }

  return (
    <main className="app-shell no-sidebar">
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
                drawSeed={drawSeed}
                setDrawSeed={setDrawSeed}
                working={working}
                selectedSeasonId={selectedSeasonId}
                generateDraw={generateDraw}
              />
            )}

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
                {activeTab === 'pots' && <PotBoard pots={pots} selectedTeamId={selectedTeam?.id} setSelectedTeamId={setSelectedTeamId} />}
                {activeTab === 'history' && <PlayersRuns draws={seasonState?.draws || []} />}
              </div>
              <TeamInspector team={selectedTeam} matchups={teamMatchups} />
            </section>
            <AppFooter />
          </>
        )}
      </section>
    </main>
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
      <svg viewBox="0 0 64 64" role="img" aria-hidden="true">
        <circle cx="32" cy="32" r="27" />
        <path d="M32 9l5.2 14.1 15 .7-11.8 9.3 4 14.5L32 39.4 19.6 47.6l4-14.5-11.8-9.3 15-.7L32 9z" />
        <path d="M18.4 22.7l27.2 20.1M45.6 22.7L18.4 42.8M32 9v46" />
      </svg>
      <span>Champions League</span>
    </div>
  );
}

function LandingPage({ working, generateDraw, setActiveTab }) {
  return (
    <section className="landing">
      <div className="landing-copy">
        <h1>Make your Champions League draw prediction</h1>
        <p>
          Run a fresh league-phase simulation, save it under your name, and compare your draw against the other saved
          runs from the community.
        </p>
        <div className="landing-actions">
          <button className="button primary landing-button" disabled={working} onClick={() => generateDraw({ fresh: true })}>
            <Play size={18} />
            {working ? 'Running' : 'Run a simulation'}
          </button>
          <button className="button secondary landing-button" onClick={() => setActiveTab('history')}>
            <History size={18} />
            View saved runs
          </button>
        </div>
      </div>
    </section>
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
  drawSeed,
  setDrawSeed,
  working,
  selectedSeasonId,
  generateDraw,
}) {
  return (
    <section className="command-band">
      <div>
        <h1>Run your Champions League simulation</h1>
        <p>
          Enter your player name, choose a seed, and publish a league-phase prediction. Every run is saved so other
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
          <span>Simulation seed</span>
          <input value={drawSeed} onInput={(event) => setDrawSeed(event.currentTarget.value)} />
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
        ['pots', 'Pots'],
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

function PotBoard({ pots, selectedTeamId, setSelectedTeamId }) {
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
              onClick={() => setSelectedTeamId(team.id)}
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

function PlayersRuns({ draws }) {
  return (
    <section className="history-list">
      {draws.length ? (
        draws.map((draw) => (
          <article className="history-row" key={draw.id}>
            <span className={`status-dot ${draw.status.toLowerCase()}`} />
            <div>
              <strong>{draw.player_name || 'Guest player'}</strong>
              <span>{draw.draw_seed} - {draw.status} - {draw.matchups_created} fixtures - {shortDate(draw.completed_at)}</span>
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

function TeamInspector({ team, matchups }) {
  if (!team) {
    return <aside className="inspector"><StateMessage icon={Users} title="No team selected" text="Choose a team from a pot." /></aside>;
  }
  return (
    <aside className="inspector">
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
