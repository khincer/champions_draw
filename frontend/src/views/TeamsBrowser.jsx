import { useEffect, useMemo, useState } from 'preact/hooks';
import { Activity, ArrowLeft, ChevronDown, Home, Plane, RefreshCw } from 'lucide-preact';
import Crest from '../components/Crest';
import LeagueFixtureRow from '../components/LeagueFixtureRow';
import SegmentControl from '../components/SegmentControl';
import StandingsTable from '../components/StandingsTable';
import { StateMessage } from '../components/States';
import { apiFetch } from '../lib/api';
import { shortTime } from '../lib/format';
import { toMiniRow } from '../lib/teams';
import { formatAggregate, pairPlayoffTies } from '../tieUtils';
import TeamPage from './TeamPage';

/* League browser: the league grid, one league page (standings + fixtures with
   the group|playoffs toggle) and the team page it swaps in. Moved out of
   `main.jsx` verbatim. `GroupStandingsTables` and `PlayoffTieCard` stay local
   to this file because TeamsBrowser is their only consumer. */

/* One table per group, used for season-kind league standings.  Handles both
   flat rows ({name, logo_url, played, wins, ...}) and football-data rows
   ({team?.name, team_crest, playedGames, won, ...}). */
function GroupStandingsTables({ rows, onOpenTeam }) {
  const groupOrder = useMemo(() => {
    const seen = [];
    for (const row of rows) {
      if (!seen.includes(row.group)) seen.push(row.group);
    }
    return seen;
  }, [rows]);

  return (
    <div className="group-standings">
      {groupOrder.map((group) => (
        <section key={group} className="group-standing-block">
          <h3 className="group-title">Group {group}</h3>
          <StandingsTable
            rows={rows.filter((r) => r.group === group)}
            variant="standings"
            nameMode="full"
            onTeamClick={(row) => onOpenTeam({
              name: row.name || row.team?.name || row.team_name,
              crest: row.logo_url || row.team_crest || row.team?.crest || row.team?.logo_url,
            })}
          />
        </section>
      ))}
    </div>
  );
}

/* Read-only playoff tie in the league Playoffs view: the aggregate line plus
   its legs, paired client-side by pairPlayoffTies (LPV-4). No score editing. */
function PlayoffTieCard({ tie }) {
  const { legs, aggregate } = tie;
  return (
    <section className="playoff-tie-card" aria-label="Playoff tie">
      <span className="tie-agg">{formatAggregate(aggregate)}</span>
      <div className="tie-legs">
        {legs.map((m, i) => (
          <div className="playoff-leg-row" key={m.id}>
            <span className="playoff-leg-label">Leg {i + 1}</span>
            <div className="playoff-side">
              <Home size={12} className="playoff-venue-icon" />
              <Crest team={m.home_team} size="sm" />
              <span className="playoff-name">{m.home_team?.short_name || m.home_team?.name}</span>
            </div>
            <span className="score-sep">
              {m.home_goals != null && m.away_goals != null ? `${m.home_goals}–${m.away_goals}` : '–'}
            </span>
            <div className="playoff-side">
              <span className="playoff-name">{m.away_team?.short_name || m.away_team?.name}</span>
              <Crest team={m.away_team} size="sm" />
              <Plane size={12} className="playoff-venue-icon" />
            </div>
            <span className="tie-kickoff">{shortTime(m.kickoff)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function TeamsBrowser({
  leagues, selectedLeague, leagueStandings, setSelectedLeague, setLeagueStandings,
  leagueMatches, setLeagueMatches, viewTeam, setViewTeam,
}) {
  const [loadingStandings, setLoadingStandings] = useState(false);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [showNextMatches, setShowNextMatches] = useState(false);
  const [leaguePhase, setLeaguePhase] = useState('group'); // 'group' | 'playoffs' — LPV-1, not persisted
  const [seasonMatchups, setSeasonMatchups] = useState([]);
  const playoffTies = useMemo(() => pairPlayoffTies(seasonMatchups), [seasonMatchups]);

  async function loadLeagueData(league) {
    if (league.kind === 'season') {
      setLeagueStandings([]);
      setLoadingStandings(true);
      setLoadingMatches(true);
      try {
        const [stateData, groupsData] = await Promise.all([
          apiFetch(`/ui/seasons/${league.season_id}/state/`),
          apiFetch(`/seasons/${league.season_id}/group-standings/`),
        ]);
        const matchups = stateData?.matchups || [];
        setSeasonMatchups(stateData?.matchups || []);
        const finished = matchups.filter((m) => m.status === 'FINISHED').map(toMiniRow);
        const upcoming = matchups.filter((m) => m.status !== 'FINISHED' && m.kickoff).map(toMiniRow);
        setLeagueMatches({ finished, upcoming });
        // Flatten every group's standings; each row keeps its group label so
        // the league page can split tables again (TeamPage reuses the flat
        // list unchanged).
        const groups = groupsData?.groups || [];
        setLeagueStandings(
          groups.flatMap((g) => (g.standings || []).map((row) => ({ ...row, group: g.group }))),
        );
      } catch {
        setLeagueMatches({ finished: [], upcoming: [] });
        setLeagueStandings([]);
      } finally {
        setLoadingStandings(false);
        setLoadingMatches(false);
      }
      return;
    }
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
    setLeaguePhase('group');
    setSeasonMatchups([]);
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
              setLeaguePhase('group');
              setSeasonMatchups([]);
            }}
          >
            <ArrowLeft size={16} />
            Back to leagues
          </button>
          <button className="back-button" onClick={() => loadLeagueData(selectedLeague)}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        {selectedLeague.kind === 'season' && (
          <SegmentControl
            className="segment-control"
            label="League phase"
            value={leaguePhase}
            onChange={setLeaguePhase}
            items={[
              { key: 'group', label: 'Group Stage' },
              { key: 'playoffs', label: 'Playoffs' },
            ]}
          />
        )}
        {selectedLeague.kind === 'season' && leaguePhase === 'playoffs' ? (
          playoffTies.length ? (
            <div className="playoff-tie-list">
              {playoffTies.map((tie) => <PlayoffTieCard key={tie.legs[0].id} tie={tie} />)}
            </div>
          ) : (
            <p className="muted">No playoff matchups yet.</p>
          )
        ) : (
        <div className="standings-layout standings-layout--league">
          <div>
            <h2 style={{ marginTop: 16 }}>{selectedLeague.name}</h2>
            {loadingStandings ? (
              <StateMessage icon={Activity} title="Loading standings" text="Fetching league table" />
            ) : selectedLeague.kind === 'season' && leagueStandings.length ? (
              <GroupStandingsTables rows={leagueStandings} onOpenTeam={(team) => setViewTeam(team)} />
            ) : leagueStandings.length ? (
              <StandingsTable
                rows={leagueStandings}
                variant="standings"
                nameMode="full"
                onTeamClick={(row) => setViewTeam({
                  name: row.team?.name || row.team_name,
                  crest: row.team_crest || row.team?.crest || row.team?.logo_url,
                })}
              />
            ) : <p className="muted">No standings available.</p>}
          </div>

          <aside>
            <h3 className="panel-title">Last Results</h3>
            {loadingMatches ? (
              <StateMessage icon={Activity} title="Loading" text="Fetching fixtures" />
            ) : leagueMatches.finished && leagueMatches.finished.length ? (
              <div className="fixture-mini-list">
                {leagueMatches.finished.map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
              </div>
            ) : <p className="muted small">No finished matches yet.</p>}
            <button
              className="next-matches-toggle"
              onClick={() => setShowNextMatches((v) => !v)}
            >
              <ChevronDown size={16} className={showNextMatches ? '' : 'arrow-closed'} />
              Next matches
            </button>
            {showNextMatches ? (
              loadingMatches ? (
                <StateMessage icon={Activity} title="Loading" text="Fetching fixtures" />
              ) : leagueMatches.upcoming && leagueMatches.upcoming.length ? (
                <div className="fixture-mini-list" style={{ marginTop: 8 }}>
                  {leagueMatches.upcoming.map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : <p className="muted small">No upcoming matches.</p>
            ) : null}
          </aside>
        </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100 }}>
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
