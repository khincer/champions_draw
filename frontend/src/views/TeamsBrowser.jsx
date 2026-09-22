import { useEffect, useMemo, useState } from 'preact/hooks';
import { ArrowLeft, ChevronDown, Home, Plane, RefreshCw } from 'lucide-preact';
import Button from '../components/Button';
import Crest from '../components/Crest';
import LeagueFixtureRow from '../components/LeagueFixtureRow';
import SegmentControl from '../components/SegmentControl';
import StandingsTable from '../components/StandingsTable';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { apiFetch } from '../lib/api';
import { useI18n } from '../i18n';
import { toMiniRow } from '../lib/teams';
import { formatAggregate, pairPlayoffTies } from '../lib/tieUtils';
import TeamPage from '../components/TeamPage';

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
  const { formatTime } = useI18n();
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
            <span className="tie-kickoff">{formatTime(m.kickoff)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function TeamsBrowser({
  leagues, selectedLeague, leagueStandings, setSelectedLeague, setLeagueStandings,
  leagueMatches, setLeagueMatches, viewTeam, setViewTeam,
  leaguesStatus, leaguesError, onRetryLeagues,
}) {
  const [standingsReq, setStandingsReq] = useState({ status: 'idle', error: '' });
  const [fixturesReq, setFixturesReq] = useState({ status: 'idle', error: '' });
  const [showNextMatches, setShowNextMatches] = useState(false);
  const [leaguePhase, setLeaguePhase] = useState('group');
  const [seasonMatchups, setSeasonMatchups] = useState([]);
  const playoffTies = useMemo(() => pairPlayoffTies(seasonMatchups), [seasonMatchups]);

  async function loadStandings(league) {
    if (!league) return;
    setStandingsReq({ status: 'loading', error: '' });
    try {
      if (league.kind === 'season') {
        const groupsData = await apiFetch(`/seasons/${league.season_id}/group-standings/`);
        const groups = groupsData?.groups || [];
        setLeagueStandings(
          groups.flatMap((g) => (g.standings || []).map((row) => ({ ...row, group: g.group }))),
        );
      } else {
        const data = await apiFetch(`/leagues/${league.id}/standings/`);
        setLeagueStandings(Array.isArray(data) ? data : (data.standings || []));
      }
      setStandingsReq({ status: 'success', error: '' });
    } catch (err) {
      setLeagueStandings([]);
      setStandingsReq({ status: 'error', error: err.message });
    }
  }

  async function loadFixtures(league) {
    if (!league) return;
    setFixturesReq({ status: 'loading', error: '' });
    try {
      if (league.kind === 'season') {
        const stateData = await apiFetch(`/ui/seasons/${league.season_id}/state/`);
        const matchups = stateData?.matchups || [];
        setSeasonMatchups(matchups);
        setLeagueMatches({
          finished: matchups.filter((m) => m.status === 'FINISHED').map(toMiniRow),
          upcoming: matchups.filter((m) => m.status !== 'FINISHED' && m.kickoff).map(toMiniRow),
        });
      } else {
        const data = await apiFetch(`/leagues/${league.id}/matches/`);
        setLeagueMatches(data || { finished: [], upcoming: [] });
      }
      setFixturesReq({ status: 'success', error: '' });
    } catch (err) {
      setLeagueMatches({ finished: [], upcoming: [] });
      setFixturesReq({ status: 'error', error: err.message });
    }
  }

  function loadLeagueData(league) {
    if (!league) return;
    loadStandings(league);
    loadFixtures(league);
  }

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
    setStandingsReq({ status: 'idle', error: '' });
    setFixturesReq({ status: 'idle', error: '' });
  }

  if (viewTeam) {
    return (
      <TeamPage
        team={viewTeam}
        league={selectedLeague}
        standings={leagueStandings}
        matches={leagueMatches}
        leagues={leagues}
        standingsReq={standingsReq}
        fixturesReq={fixturesReq}
        onRetryStandings={() => loadStandings(selectedLeague)}
        onRetryFixtures={() => loadFixtures(selectedLeague)}
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
              setStandingsReq({ status: 'idle', error: '' });
              setFixturesReq({ status: 'idle', error: '' });
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
            {standingsReq.status === 'loading' || standingsReq.status === 'idle' ? (
              <Skeleton rows={5} label="Loading standings" />
            ) : standingsReq.status === 'error' ? (
              <ErrorState
                title={selectedLeague.kind === 'season' ? 'Group standings could not load' : 'Standings could not load'}
                detail={standingsReq.error}
                onRetry={() => loadStandings(selectedLeague)}
              />
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
            ) : (
              <EmptyState
                title={selectedLeague.kind === 'season' ? 'No group table yet' : 'No table yet'}
                text="Nothing is published for this competition yet. Refresh to check again."
                action={<Button onClick={() => loadStandings(selectedLeague)}>Refresh</Button>}
              />
            )}
          </div>

          <aside>
            <h3 className="panel-title">Last Results</h3>
            {fixturesReq.status === 'loading' || fixturesReq.status === 'idle' ? (
              <Skeleton rows={3} label="Loading fixtures" variant="fixture" />
            ) : fixturesReq.status === 'error' ? (
              <ErrorState
                title="Fixtures could not load"
                detail={fixturesReq.error}
                onRetry={() => loadFixtures(selectedLeague)}
              />
            ) : leagueMatches.finished && leagueMatches.finished.length ? (
              <div className="fixture-mini-list">
                {leagueMatches.finished.map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
              </div>
            ) : (
              <EmptyState
                title="No finished matches yet"
                text="Results appear here once this competition has played fixtures. Refresh to check again."
                action={<Button onClick={() => loadFixtures(selectedLeague)}>Refresh</Button>}
              />
            )}
            <button
              className="next-matches-toggle"
              onClick={() => setShowNextMatches((v) => !v)}
            >
              <ChevronDown size={16} className={showNextMatches ? '' : 'arrow-closed'} />
              Next matches
            </button>
            {showNextMatches ? (
              fixturesReq.status === 'loading' || fixturesReq.status === 'idle' ? (
                <Skeleton rows={2} label="Loading fixtures" variant="fixture" />
              ) : fixturesReq.status === 'error' ? null : leagueMatches.upcoming && leagueMatches.upcoming.length ? (
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
      {leaguesStatus === 'loading' || leaguesStatus === 'idle' ? (
        <Skeleton rows={6} label="Loading leagues" />
      ) : leaguesStatus === 'error' ? (
        <ErrorState title="Leagues could not load" detail={leaguesError} onRetry={onRetryLeagues} />
      ) : leagues.length ? (
        <div className="leagues-grid">
          {leagues.map((league) => (
            <button className="league-card" key={league.id} onClick={() => handleSelectLeague(league)}>
              {league.emblem_url && <img src={league.emblem_url} alt="" />}
              <div className="league-card-name">{league.name}</div>
              {league.country && <div className="league-card-country">{league.country}</div>}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No leagues imported yet"
          action={<Button onClick={onRetryLeagues}>Refresh</Button>}
        />
      )}
    </div>
  );
}
