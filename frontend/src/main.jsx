import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  History,
  Home,
  LayoutGrid,
  ListOrdered,
  Plane,
  Play,
  RefreshCw,
  Swords,
  Trophy,
  UserRound,
  Users,
} from 'lucide-preact';
import championsLeagueLogoUrl from './assets/uefa-champions-league-logo.svg';
import './styles.css';
import CareerApp, { hasSavedCareer } from './CareerApp';
import PredictionApp from './PredictionApp';
import RealDrawView from './RealDrawView';
import { clearLocal, loadLocal } from './predictionStorage';

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

function shortTime(value) {
  if (!value) return 'TBD';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function shortDay(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

// Kickoff falls within [yesterday 00:00, tomorrow 00:00) in local time.
function inHomeRange(matchup) {
  const kickoff = matchup.kickoff ? new Date(matchup.kickoff) : null;
  if (!kickoff) return false;
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return kickoff >= start && kickoff < end;
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

        <div className="site-nav-section">Official</div>
        <button
          className={`site-nav-link ${view === 'real' ? 'active' : ''}`}
          onClick={() => setView('real')}
        >
          <Swords size={18} />
          Real Draw
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
          Leagues
        </button>
      </div>
    </nav>
  );
}

/* ─── Homepage (live hub, la-cancha style) ─── */

function HomeMatchCard({ match }) {
  const result = match.result;
  const status = result ? 'finished' : match.closed ? 'live' : 'upcoming';
  const statusLabel = result ? 'Final' : match.closed ? 'Live' : 'Kickoff';
  return (
    <article className="home-game-card" aria-label={`${match.home_team.name} versus ${match.away_team.name}`}>
      <header className="home-game-card-header">
        <div>
          <p className="hub-eyebrow">Champions League</p>
          <p className="hub-date">{shortDay(match.kickoff)}</p>
        </div>
        <span className={`hub-status ${status === 'finished' ? 'hub-final' : status === 'live' ? 'hub-live' : 'hub-upcoming'}`}>
          {status === 'live' && <span className="live-dot" aria-hidden="true" />}
          {statusLabel}
        </span>
      </header>
      <div className="hub-matchup">
        <div className="hub-team">
          <TeamLogo team={match.home_team} size="md" />
          <p className="hub-team-name">{match.home_team.name}</p>
          {match.home_team.short_name && <p className="hub-team-short">{match.home_team.short_name}</p>}
        </div>
        <div className="hub-score-area">
          {result ? (
            <p className="hub-score">
              <span>{result.home_goals}</span>
              <b>:</b>
              <span>{result.away_goals}</span>
            </p>
          ) : (
            <p className="hub-kickoff">{shortTime(match.kickoff)}</p>
          )}
          <p className="hub-score-caption">{status === 'finished' ? 'Result' : status === 'live' ? 'Live' : 'Kickoff'}</p>
        </div>
        <div className="hub-team">
          <TeamLogo team={match.away_team} size="md" />
          <p className="hub-team-name">{match.away_team.name}</p>
          {match.away_team.short_name && <p className="hub-team-short">{match.away_team.short_name}</p>}
        </div>
      </div>
      <footer className="home-game-card-footer">
        <span>Matchday {match.matchday}</span>
        <span aria-hidden="true">↗</span>
      </footer>
    </article>
  );
}

function Homepage({ matches }) {
  const inRange = useMemo(
    () => matches.filter(inHomeRange).sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')),
    [matches],
  );

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    return inRange.reduce(
      (acc, m) => {
        const key = new Date(m.kickoff).toDateString() === today ? 'Today' : 'Yesterday';
        acc[key].push(m);
        return acc;
      },
      { Today: [], Yesterday: [] },
    );
  }, [inRange]);

  if (!inRange.length) {
    return (
      <div className="homepage-matches">
        <StateMessage
          icon={Trophy}
          title="No matches today"
          text="Today and yesterday games appear here with live results as they happen."
        />
      </div>
    );
  }

  return (
    <div className="homepage-matches">
      {Object.entries(groups).map(([label, dayMatches]) =>
        dayMatches.length ? (
          <div key={label} className="homepage-day-section">
            <div className="match-section-title">
              <CalendarDays size={16} />
              {label} &middot; {shortDay(dayMatches[0].kickoff)}
            </div>
            {dayMatches.map((m) => <HomeMatchCard key={m.id} match={m} />)}
          </div>
        ) : null,
      )}
    </div>
  );
}

/* ─── Teams Browser ─── */

function normTeamName(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\b(fc|cf|afc|sc|sv|club)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function LeagueFixtureRow({ m }) {
  const done = m.status === 'FINISHED' && m.result;
  return (
    <div className="fixture-mini">
      <div className="fixture-mini-date">{shortDay(m.kickoff)}</div>
      <div className="fixture-mini-teams">
        <span className="fixture-mini-home">
          {m.home_crest ? <img src={m.home_crest} alt="" className="fixture-mini-crest" /> : null}
          {m.home_name}
        </span>
        <span className="fixture-mini-score">
          {done ? `${m.result.home_goals}–${m.result.away_goals}` : 'vs'}
        </span>
        <span className="fixture-mini-away">
          {m.away_name}
          {m.away_crest ? <img src={m.away_crest} alt="" className="fixture-mini-crest" /> : null}
        </span>
      </div>
      <div className="fixture-mini-time">{done ? 'FT' : shortTime(m.kickoff)}</div>
    </div>
  );
}

function TeamPage({ team, league, standings, matches, leagues, onBack, onRefresh }) {
  const [ucl, setUcl] = useState(null);

  useEffect(() => {
    if (league && league.code === 'CL') {
      setUcl(null);
      return undefined;
    }
    const cl = (leagues || []).find((l) => l.code === 'CL');
    if (!cl) {
      setUcl(null);
      return undefined;
    }
    let cancelled = false;
    Promise.all([
      apiFetch(`/leagues/${cl.id}/standings/`),
      apiFetch(`/leagues/${cl.id}/matches/`),
    ])
      .then(([st, mt]) => {
        if (cancelled) return;
        setUcl({
          standings: Array.isArray(st) ? st : (st.standings || []),
          matches: mt || { finished: [], upcoming: [] },
        });
      })
      .catch(() => { if (!cancelled) setUcl(null); });
    return () => { cancelled = true; };
  }, [league, leagues]);

  const norm = normTeamName;
  const standing = (standings || []).find(
    (r) => norm(r.team_name || r.team?.name) === norm(team.name),
  );
  const teamMatches = (list) => (list || []).filter(
    (m) => norm(m.home_name) === norm(team.name) || norm(m.away_name) === norm(team.name),
  );
  const finished = teamMatches(matches && matches.finished);
  const upcoming = teamMatches(matches && matches.upcoming);
  const uclStanding = ucl
    ? ucl.standings.find((r) => norm(r.team_name || r.team?.name) === norm(team.name))
    : null;
  const uclFinished = ucl ? teamMatches(ucl.matches.finished) : [];
  const uclUpcoming = ucl ? teamMatches(ucl.matches.upcoming) : [];
  const isUcl = league && league.code === 'CL';

  return (
    <div style={{ padding: '24px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={16} />
          Back to {league ? league.name : 'league'}
        </button>
        <button className="back-button" onClick={onRefresh}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="team-page-header">
        {team.crest ? <img src={team.crest} alt="" className="team-page-crest" /> : null}
        <h2 style={{ margin: 0 }}>{team.name}</h2>
        {league && <span className="league-badge">{league.name}</span>}
      </div>
      <div className="standings-layout">
        <div>
          <h3 className="panel-title">
            {isUcl ? 'Champions League table' : `League table — ${league ? league.name : ''}`}
          </h3>
          {standing ? (
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
                {(standings || []).map((row, i) => (
                  <tr
                    key={row.team?.id || i}
                    className={norm(row.team_name || row.team?.name) === norm(team.name) ? 'team-row-highlight' : ''}
                  >
                    <td className="standings-pos">{row.position || i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {row.team_crest ? (
                          <img src={row.team_crest} alt="" style={{ width: 20, height: 20 }} />
                        ) : row.team?.crest ? (
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
          ) : (
            <p className="muted">No standing found for {team.name} in this league.</p>
          )}

          {(finished.length || upcoming.length) ? (
            <>
              <h3 className="panel-title">Fixtures</h3>
              {finished.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">Recent results</div>
                  {finished.slice(0, 6).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
              {upcoming.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">Upcoming</div>
                  {upcoming.slice(0, 6).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <aside>
          {!isUcl ? (
            <div className="panel-card">
              <h3 className="panel-title">Champions League</h3>
              {ucl ? (
                uclStanding ? (
                  <div className="ucl-card">
                    <div className="ucl-card-row">
                      <span>Position</span>
                      <b>{uclStanding.position}</b>
                    </div>
                    <div className="ucl-card-row">
                      <span>Points</span>
                      <b>{uclStanding.points}</b>
                    </div>
                    <div className="ucl-card-row">
                      <span>Record</span>
                      <b>
                        {uclStanding.won ?? uclStanding.wins}W · {uclStanding.draw ?? uclStanding.draws}D ·{' '}
                        {uclStanding.lost ?? uclStanding.losses}L
                      </b>
                    </div>
                  </div>
                ) : (
                  <p className="muted small">Not in this UCL season.</p>
                )
              ) : (
                <StateMessage icon={Activity} title="Loading" text="Checking Champions League data" />
              )}
              {uclFinished.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">UCL results</div>
                  {uclFinished.slice(0, 4).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
              {uclUpcoming.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">UCL upcoming</div>
                  {uclUpcoming.slice(0, 4).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="panel-card">
            <h3 className="panel-title">Honours</h3>
            <p className="muted small">
              Trophy history is not synced yet. Add API-Football sync (key already in .env) to populate it.
            </p>
          </div>
          <div className="panel-card">
            <h3 className="panel-title">Squad</h3>
            <p className="muted small">
              Player data is not synced yet. Add API-Football sync (key already in .env) to populate it.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function TeamsBrowser({
  leagues, selectedLeague, leagueStandings, setSelectedLeague, setLeagueStandings,
  leagueMatches, setLeagueMatches, viewTeam, setViewTeam,
}) {
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);

  async function loadLeagueData(league) {
    setLoadingStandings(true);
    try {
      const data = await apiFetch(`/leagues/${league.id}/standings/`);
      setLeagueStandings(Array.isArray(data) ? data : (data.standings || []));
    } catch {
      setLeagueStandings([]);
    } finally {
      setLoadingStandings(false);
    }
    setLoadingMatches(true);
    try {
      const data = await apiFetch(`/leagues/${league.id}/matches/`);
      setLeagueMatches(data || { finished: [], upcoming: [] });
    } catch {
      setLeagueMatches({ finished: [], upcoming: [] });
    } finally {
      setLoadingMatches(false);
    }
  }

  // Fetch standings + results on mount (re-entering the tab) and whenever the
  // selected league changes, so fresh cron-synced data appears without a click.
  useEffect(() => {
    if (selectedLeague) loadLeagueData(selectedLeague);
  }, [selectedLeague]);

  function handleSelectLeague(league) {
    setSelectedLeague(league);
    setViewTeam(null);
    setLeagueStandings([]);
    setLeagueMatches({ finished: [], upcoming: [] });
  }

  if (viewTeam) {
    return (
      <TeamPage
        team={viewTeam}
        league={selectedLeague}
        standings={leagueStandings}
        matches={leagueMatches}
        leagues={leagues}
        onBack={() => setViewTeam(null)}
        onRefresh={() => loadLeagueData(selectedLeague)}
      />
    );
  }

  if (selectedLeague) {
    return (
      <div style={{ padding: '24px', maxWidth: 1280 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <button
            className="back-button"
            onClick={() => {
              setSelectedLeague(null);
              setLeagueStandings([]);
              setLeagueMatches({ finished: [], upcoming: [] });
            }}
          >
            <ArrowLeft size={16} />
            Back to leagues
          </button>
          <button className="back-button" onClick={() => loadLeagueData(selectedLeague)}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
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
                        <button
                          className="team-link"
                          onClick={() => setViewTeam({
                            name: row.team?.name || row.team_name,
                            crest: row.team_crest || row.team?.crest || row.team?.logo_url,
                          })}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {row.team_crest ? (
                              <img src={row.team_crest} alt="" style={{ width: 20, height: 20 }} />
                            ) : row.team?.crest ? (
                              <img src={row.team.crest} alt="" style={{ width: 20, height: 20 }} />
                            ) : row.team?.logo_url ? (
                              <img src={row.team.logo_url} alt="" style={{ width: 20, height: 20 }} />
                            ) : null}
                            <span>{row.team?.name || row.team_name}</span>
                          </div>
                        </button>
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

          <aside>
            <h3 className="panel-title">Results</h3>
            {loadingMatches ? (
              <StateMessage icon={Activity} title="Loading" text="Fetching fixtures" />
            ) : leagueMatches.finished && leagueMatches.finished.length ? (
              <div className="fixture-mini-list">
                {leagueMatches.finished.map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
              </div>
            ) : <p className="muted small">No finished matches yet.</p>}
            <h3 className="panel-title" style={{ marginTop: 24 }}>Upcoming</h3>
            {loadingMatches ? (
              <StateMessage icon={Activity} title="Loading" text="Fetching fixtures" />
            ) : leagueMatches.upcoming && leagueMatches.upcoming.length ? (
              <div className="fixture-mini-list">
                {leagueMatches.upcoming.map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
              </div>
            ) : <p className="muted small">No upcoming matches.</p>}
          </aside>
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
            {league.emblem_url && <img src={league.emblem_url} alt="" />}
            <div className="league-card-name">{league.name}</div>
            {league.country && <div className="league-card-country">{league.country}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ─── App ─── */

function App() {
  const [view, setView] = useState('home');
  const [homeMatches, setHomeMatches] = useState([]);
  const homeMatchesRef = useRef([]);
  const [leagues, setLeagues] = useState([]);
  const [selectedLeague, setSelectedLeague] = useState(null);
  const [leagueStandings, setLeagueStandings] = useState([]);
  const [leagueMatches, setLeagueMatches] = useState({ finished: [], upcoming: [] });
  const [viewTeam, setViewTeam] = useState(null);

  const [seasons, setSeasons] = useState([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [seasonState, setSeasonState] = useState(null);
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
  const [notice, setNotice] = useState('');
  const [predictionApi] = useState({});
  const [careerAvailable, setCareerAvailable] = useState(() => hasSavedCareer());

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (view !== 'home' || !selectedSeasonId) return undefined;
    async function loadRealMatches() {
      try {
        const payload = await apiFetch(`/ui/seasons/${selectedSeasonId}/real-fixtures/`);
        homeMatchesRef.current = payload.matchups;
        setHomeMatches(payload.matchups);
      } catch {
        // Homepage is best-effort; the real draw view surfaces errors.
      }
    }
    loadRealMatches();
    // Keep refreshing while any today/yesterday match is not finished yet.
    const timer = window.setInterval(() => {
      if (homeMatchesRef.current.some((m) => inHomeRange(m) && !m.result)) loadRealMatches();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [view, selectedSeasonId]);

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
      setError(err.message);
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
      <SiteNav view={view} setView={setView} setActiveTab={setActiveTab} />
      <main className="app-main">
        {view === 'home' && (
          <section className="workspace">
            <Homepage matches={homeMatches} />
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
              leagueMatches={leagueMatches}
              setLeagueMatches={setLeagueMatches}
              viewTeam={viewTeam}
              setViewTeam={setViewTeam}
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

        {view === 'real' && (
          <RealDrawView
            seasons={seasons}
            seasonId={selectedSeasonId}
            setSeasonId={setSelectedSeasonId}
            playerName={playerName}
            setPlayerName={setPlayerName}
            apiFetch={apiFetch}
          />
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
            <option value="interactive">Interactive (pick by pick)</option>
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
        ['teams', 'Leagues'],
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

function TeamLogo({ team, size = 'md', className = '', noFallback = false }) {
  const [failed, setFailed] = useState(false);
  const showImage = team.logo_url && !failed;
  return (
    <span className={`team-logo ${size} ${className}`.trim()}>
      {showImage ? (
        <img src={team.logo_url} alt={`${team.name} badge`} loading="lazy" onError={() => setFailed(true)} />
      ) : noFallback ? null : (
        <span>{team.short_name.slice(0, 3)}</span>
      )}
    </span>
  );
}

function InteractiveDraft({ seasonId, state, setState, apiFetch, selectedTeamId, setSelectedTeamId, onComplete, onReveal }) {
  const { teams, matchups, picks, current_pot, auto_finalized } = state;
  const pickedIds = new Set((picks || []).map((pick) => pick.season_team_id));
  const pickedTeams = (picks || [])
    .slice()
    .sort((a, b) => a.pick_order - b.pick_order)
    .map((pick) => teams.find((team) => team.id === pick.season_team_id))
    .filter(Boolean);
  const [pickingId, setPickingId] = useState(null);
  const [error, setError] = useState('');
  const [revealCount, setRevealCount] = useState(0);
  const [revealStart, setRevealStart] = useState(0);
  const [revealSession, setRevealSession] = useState(0);
  const [pendingFinalize, setPendingFinalize] = useState(false);

  const activeId = selectedTeamId;
  const activeTeam = teams.find((team) => team.id === activeId) || null;
  const activeMatchups = useMemo(() => {
    if (!activeTeam) return [];
    return (matchups || []).filter(
      (m) => m.home_team.id === activeTeam.id || m.away_team.id === activeTeam.id,
    );
  }, [activeTeam, matchups]);
  const activeOpponents = activeMatchups
    .map((m) => (m.home_team.id === activeTeam.id ? m.away_team : m.home_team))
    .sort((a, b) => a.pot - b.pot || a.name.localeCompare(b.name));

  // Reveal the selected team's opponents one by one, 1s apart. Opponents whose
  // matchup already existed (knownCount = revealStart) appear instantly; only
  // freshly-created matchups animate. Restarts on every selection via
  // revealSession.
  useEffect(() => {
    setRevealCount(revealStart);
    if (revealStart >= activeOpponents.length) return undefined;
    const timer = window.setInterval(() => {
      setRevealCount((count) => {
        if (count >= activeOpponents.length) {
          window.clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [revealSession, revealStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the parent (TeamInspector) in sync with the reveal: it should show
  // the same opponents, at the same pace, as the pots panel below.
  useEffect(() => {
    onReveal?.(new Set(revealedIds));
  }, [revealSession, revealCount, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pick that ended the draw still plays its full one-by-one reveal before
  // switching away to matchdays ("even if the simulator already finished").
  useEffect(() => {
    if (pendingFinalize && activeOpponents.length && revealCount >= activeOpponents.length) {
      const timer = window.setTimeout(() => onComplete(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pendingFinalize, revealCount, activeOpponents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePick(team) {
    setSelectedTeamId(team.id);
    // Opponents whose matchup already exists are "known": reveal them instantly
    // instead of replaying the one-by-one animation for them too.
    const knownCount = (matchups || []).filter(
      (m) => m.home_team.id === team.id || m.away_team.id === team.id,
    ).length;
    if (pickedIds.has(team.id)) {
      setRevealStart(knownCount); // re-click: show the whole list at once
      setRevealSession((session) => session + 1);
      return;
    }
    if (String(team.pot) !== String(current_pot)) {
      // Team is not on the clock: selecting only inspects it in the sidebar.
      setRevealStart(knownCount); // inspect-only: existing matchups are all known
      setRevealSession((session) => session + 1);
      return;
    }
    setRevealStart(knownCount);
    setRevealSession((session) => session + 1);
    setPickingId(team.id);
    setError('');
    try {
      const payload = await apiFetch(`/seasons/${seasonId}/interactive/pick/`, {
        method: 'POST',
        body: JSON.stringify({ season_team_id: team.id }),
      });
      setState(payload);
      setRevealSession((session) => session + 1); // start reveal once the pick's matchups are loaded
      if (payload.auto_finalized) {
        setPendingFinalize(true); // keep showing the reveal, then complete
        return;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setPickingId(null);
    }
  }

  const pots = ['1', '2', '3', '4'];
  const potTeams = (pot) =>
    (teams || []).filter((team) => String(team.pot) === pot).sort((a, b) => a.seeding_position - b.seeding_position);
  const revealedOpponents = activeOpponents.slice(0, revealCount);
  const revealedIds = new Set(revealedOpponents.map((opponent) => opponent.id));
  const onClock = String(current_pot);

  return (
    <section className="interactive-stage">
      <div className="draw-animation-head">
        <div>
          <h2>{auto_finalized ? 'Draw complete!' : `Interactive draw — Pot ${current_pot || '?'}`}</h2>
          <p>
            {pickedTeams.length} of 36 teams picked. Choose one team; all of its matchups are locked in immediately.
          </p>
        </div>
        <span className="draw-pulse" />
      </div>

      {error && <MessageBar error={error} />}

      <div className="interactive-head">
        <strong>{current_pot ? `Pot ${current_pot} on the clock` : 'All teams picked'}</strong>
        {activeTeam && <span>{activeTeam.name} selected</span>}
      </div>

      <div className="interactive-pots">
        {pots.map((pot) => (
          <article className="pot-panel" key={pot}>
            <div className="pot-head">
              <strong>Pot {pot}</strong>
              <span>{onClock === pot ? 'on the clock' : ''}</span>
            </div>
            {potTeams(pot).map((team) => {
              const isPicked = pickedIds.has(team.id);
              const isActive = activeId === team.id;
              const isRevealed = revealedIds.has(team.id);
              return (
                <button
                  className={`team-row ${isActive ? 'selected' : ''} ${
                    isRevealed && !isActive ? 'opponent' : ''
                  } ${isPicked ? 'picked' : ''}`}
                  key={team.id}
                  disabled={Boolean(pickingId) && pickingId === team.id}
                  onClick={() => handlePick(team)}
                >
                  <span>{team.seeding_position}</span>
                  <TeamLogo team={team} size="sm" />
                  <strong>{team.name}</strong>
                  <em>{team.association.code}</em>
                </button>
              );
            })}
          </article>
        ))}
      </div>

      <div className="picked-row">
        <strong>Picked</strong>
        {pickedTeams.length ? (
          pickedTeams.map((team) => (
            <button
              className={`picked-chip ${activeId === team.id ? 'active' : ''}`}
              key={team.id}
              onClick={() => handlePick(team)}
              title="Click to reveal opponents"
            >
              <TeamLogo team={team} size="sm" />
              <b>{team.short_name}</b>
            </button>
          ))
        ) : (
          <span className="muted">Teams you pick will appear here, one by one.</span>
        )}
      </div>

      <div className="reveal-box">
        <h3>
          {activeTeam ? `${activeTeam.name} — opponents` : 'Select a team'}
        </h3>
        <div className="reveal-badges">
          {activeTeam && revealedOpponents.length ? (
            revealedOpponents.map((opponent, index) => (
              <TeamLogo
                team={opponent}
                size="md"
                key={opponent.id}
                className={index < revealStart ? 'known' : ''}
              />
            ))
          ) : (
            <span className="muted">
              {activeTeam && !pickedIds.has(activeTeam.id)
                ? 'Pick this team to reveal its opponents.'
                : 'Opponents will appear here, one by one.'}
            </span>
          )}
        </div>
      </div>
    </section>
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

function TeamDetailPage({ teams, teamId, setTeamId, matchups, predictions = {}, onBack }) {
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
            const pred = predictions[String(m.id)];
            const hasScore = pred && (pred.home_goals != null || pred.away_goals != null);
            return (
              <div className="team-fixture-row" key={m.id}>
                <span className="matchday-chip">MD{m.matchday}</span>
                <TeamBadge team={isHome ? m.home_team : m.away_team} />
                <span className="versus">vs</span>
                <TeamBadge team={opponent} align="right" />
                {hasScore && (
                  <span className="team-fixture-score">
                    {pred.home_goals}&ndash;{pred.away_goals}
                  </span>
                )}
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

function TeamInspector({ team, teams, selectedTeamId, setSelectedTeamId, matchups, interactive = false, revealedOpponentIds = new Set() }) {
  if (!team) {
    return <aside className="inspector"><StateMessage icon={Users} title="No team selected" text="Choose a team from a pot." /></aside>;
  }
  // During an interactive reveal, show exactly the opponents revealed so far
  // (same pace as the badges below the pots); outside a reveal, show them all.
  const visibleMatchups =
    interactive && revealedOpponentIds.size
      ? matchups.filter((matchup) => {
          const opponentId =
            matchup.home_team.id === team.id ? matchup.away_team.id : matchup.home_team.id;
          return revealedOpponentIds.has(opponentId);
        })
      : matchups;
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
        {visibleMatchups.length ? (
          visibleMatchups
            .sort((a, b) => a.matchday - b.matchday)
            .map((matchup) => {
              const isHome = matchup.home_team.id === team.id;
              const opponent = isHome ? matchup.away_team : matchup.home_team;
              return (
                <div className="opponent-row" key={matchup.id}>
                  <span>MD{matchup.matchday}</span>
                  <TeamLogo team={opponent} size="sm" />
                  <strong>{opponent.name}</strong>
                  <em className="home-away">
                    {isHome ? <Home size={12} /> : <Plane size={12} />}
                    <span>Pot {opponent.pot}</span>
                  </em>
                </div>
              );
            })
        ) : (
          <p className="muted">
            {interactive
              ? 'Pick this team in the interactive draw to lock its opponents.'
              : 'Run a simulation to inspect this team\'s eight fixtures.'}
          </p>
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
