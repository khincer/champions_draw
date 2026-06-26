import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  History,
  Lock,
  Play,
  RefreshCcw,
  Shield,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-preact';
import './styles.css';

const API_ROOT = '/api';

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
  const isConsole = window.location.pathname.startsWith('/console');
  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [seasonState, setSeasonState] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState('matchdays');
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [drawSeed, setDrawSeed] = useState('rest-test-1');
  const [resetDraw, setResetDraw] = useState(true);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
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

  async function loadInitialData() {
    setLoading(true);
    setError('');
    try {
      const [seasonPayload, userPayload] = await Promise.all([
        apiFetch('/seasons/'),
        apiFetch('/me/'),
      ]);
      setSeasons(seasonPayload);
      setCurrentUser(userPayload);
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
    } catch (err) {
      setError(err.message);
    }
  }

  async function generateDraw() {
    if (!selectedSeasonId) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const seed = drawSeed.trim() || `draw-${Date.now()}`;
      const payload = await apiFetch(`/seasons/${selectedSeasonId}/draw/`, {
        method: 'POST',
        body: JSON.stringify({ seed, reset: resetDraw }),
      });
      setNotice(`Draw ${payload.summary.draw_seed} completed with ${payload.summary.total_matchups} matchups.`);
      await loadSeasonState(selectedSeasonId);
    } catch (err) {
      setError(err.message);
      await loadSeasonState(selectedSeasonId);
    } finally {
      setWorking(false);
    }
  }

  async function seedSeason() {
    if (!selectedSeasonId) return;
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const payload = await apiFetch(`/seasons/${selectedSeasonId}/seed/`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice(`Seeded ${payload.summary.total_teams} teams into pots.`);
      await loadSeasonState(selectedSeasonId);
    } catch (err) {
      setError(err.message);
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
    <main className="app-shell">
      <Sidebar isConsole={isConsole} activeTab={activeTab} setActiveTab={setActiveTab} />
      <section className="workspace">
        <TopBar
          isConsole={isConsole}
          seasons={seasons}
          selectedSeasonId={selectedSeasonId}
          setSelectedSeasonId={setSelectedSeasonId}
          currentUser={currentUser}
        />

        {loading ? (
          <StateMessage icon={Activity} title="Loading draw workspace" text="Fetching seasons and current draw state." />
        ) : (
          <>
            <StatusStrip seasonState={seasonState} latestDraw={latestDraw} />
            {(error || notice) && <MessageBar error={error} notice={notice} />}

            <section className="command-band">
              <div>
                <h1>{isConsole ? 'Operator console' : 'Champions League draw viewer'}</h1>
                <p>
                  {isConsole
                    ? 'Manage seeding, generation, matchday validation, and draw history.'
                    : 'Explore pots, matchdays, and run persisted demo draws.'}
                </p>
              </div>
              <div className="draw-controls">
                <label className="seed-input">
                  <span>Draw seed</span>
                  <input value={drawSeed} onInput={(event) => setDrawSeed(event.currentTarget.value)} />
                </label>
                <label className="toggle-row">
                  <input type="checkbox" checked={resetDraw} onChange={(event) => setResetDraw(event.currentTarget.checked)} />
                  <span>Reset current draw</span>
                </label>
                {isConsole && (
                  <button className="button secondary" disabled={working} onClick={seedSeason}>
                    <RefreshCcw size={16} />
                    Re-seed
                  </button>
                )}
                <button className="button primary" disabled={working} onClick={generateDraw}>
                  <Play size={16} />
                  {working ? 'Working' : isConsole ? 'Generate draw' : 'Generate demo'}
                </button>
              </div>
            </section>

            {isConsole && currentUser && !currentUser.is_authenticated && (
              <div className="auth-callout">
                <Lock size={18} />
                <span>Console actions require Django login.</span>
                <a href="/admin/login/?next=/console/">Log in</a>
              </div>
            )}

            <section className="content-grid">
              <div className="primary-column">
                <ViewTabs activeTab={activeTab} setActiveTab={setActiveTab} />
                {activeTab === 'matchdays' && <MatchdayBoard matchdays={matchdays} />}
                {activeTab === 'pots' && <PotBoard pots={pots} selectedTeamId={selectedTeam?.id} setSelectedTeamId={setSelectedTeamId} />}
                {activeTab === 'history' && <DrawHistory draws={seasonState?.draws || []} />}
              </div>
              <TeamInspector team={selectedTeam} matchups={teamMatchups} />
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function Sidebar({ isConsole, activeTab, setActiveTab }) {
  const items = [
    ['matchdays', CalendarDays, 'Matchdays'],
    ['pots', Trophy, 'Pots'],
    ['history', History, 'History'],
  ];
  return (
    <aside className="sidebar">
      <div className="brand-mark">
        <Sparkles size={20} />
        <div>
          <strong>Champions Draw</strong>
          <span>{isConsole ? 'Console' : 'Public'}</span>
        </div>
      </div>
      <nav>
        {items.map(([key, Icon, label]) => (
          <button key={key} className={activeTab === key ? 'active' : ''} onClick={() => setActiveTab(key)}>
            <Icon size={17} />
            {label}
          </button>
        ))}
      </nav>
      <a className="sidebar-link" href={isConsole ? '/' : '/console/'}>
        {isConsole ? 'Open public UI' : 'Open console'}
        <ChevronRight size={15} />
      </a>
    </aside>
  );
}

function TopBar({ isConsole, seasons, selectedSeasonId, setSelectedSeasonId, currentUser }) {
  return (
    <header className="topbar">
      <div className="route-title">
        <span>{isConsole ? 'Admin side' : 'Open public UI'}</span>
        <strong>League phase workspace</strong>
      </div>
      <div className="top-actions">
        <select value={selectedSeasonId} onChange={(event) => setSelectedSeasonId(event.currentTarget.value)}>
          {seasons.map((season) => (
            <option value={season.id} key={season.id}>
              {season.name}
            </option>
          ))}
        </select>
        {isConsole ? (
          <a className="identity" href="/admin/">
            <Shield size={16} />
            {currentUser?.is_authenticated ? currentUser.username : 'Login'}
          </a>
        ) : (
          <span className="identity public">
            <Users size={16} />
            Public demo
          </span>
        )}
      </div>
    </header>
  );
}

function StatusStrip({ seasonState, latestDraw }) {
  const summary = seasonState?.summary || {};
  return (
    <section className="status-strip">
      <Metric label="Teams" value={summary.team_count || 0} />
      <Metric label="Seeded" value={summary.seeded_team_count || 0} />
      <Metric label="Matchups" value={summary.matchup_count || 0} />
      <Metric label="Draws" value={summary.draw_count || 0} />
      <div className={`draw-state ${latestDraw?.status === 'COMPLETED' ? 'ok' : latestDraw?.status === 'FAILED' ? 'bad' : ''}`}>
        {latestDraw?.status === 'COMPLETED' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
        <div>
          <span>Latest draw</span>
          <strong>{latestDraw ? `${latestDraw.status} · ${latestDraw.draw_seed}` : 'No draw yet'}</strong>
        </div>
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
        ['matchdays', 'Matchdays'],
        ['pots', 'Pots'],
        ['history', 'History'],
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
                <span className="empty-row">Generate a draw to fill this matchday.</span>
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
      <b>{team.short_name}</b>
      <span>{team.association.code}</span>
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
              <strong>{team.name}</strong>
              <em>{team.association.code}</em>
            </button>
          ))}
        </article>
      ))}
    </section>
  );
}

function DrawHistory({ draws }) {
  return (
    <section className="history-list">
      {draws.length ? (
        draws.map((draw) => (
          <article className="history-row" key={draw.id}>
            <span className={`status-dot ${draw.status.toLowerCase()}`} />
            <div>
              <strong>{draw.draw_seed}</strong>
              <span>{draw.status} · {draw.matchups_created} matchups · {shortDate(draw.completed_at)}</span>
              {draw.error_message && <em>{draw.error_message}</em>}
            </div>
          </article>
        ))
      ) : (
        <StateMessage icon={History} title="No draw history" text="Draw attempts will appear here." />
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
        <span>{team.association.name}</span>
        <h2>{team.name}</h2>
        <p>Pot {team.pot} · Seed {team.seeding_position} · Coeff. {team.uefa_club_coefficient}</p>
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
                  <strong>{opponent.name}</strong>
                  <em>{isHome ? 'Home' : 'Away'} · Pot {opponent.pot}</em>
                </div>
              );
            })
        ) : (
          <p className="muted">Generate a draw to inspect this team’s eight fixtures.</p>
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
