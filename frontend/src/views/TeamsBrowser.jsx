import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ArrowLeft, Globe, Home, Plane, RefreshCw } from 'lucide-preact';
import Button from '../components/Button';
import Crest from '../components/Crest';
import LeagueFixtureRow from '../components/LeagueFixtureRow';
import SegmentControl from '../components/SegmentControl';
import StandingsTable from '../components/StandingsTable';
import { EmptyState, ErrorState, Skeleton } from '../components/States';
import { apiFetch } from '../lib/api';
import errorText from '../lib/errorText';
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
  const { t, formatTime } = useI18n();
  const { legs, aggregate } = tie;
  return (
    <section className="playoff-tie-card" aria-label={t('teams.playoffTieLabel')}>
      <span className="tie-agg">{formatAggregate(aggregate, t)}</span>
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
  const { t } = useI18n();
  const [standingsReq, setStandingsReq] = useState({ status: 'idle', error: '' });
  const [fixturesReq, setFixturesReq] = useState({ status: 'idle', error: '' });
  const standingsController = useRef(null);
  const fixturesController = useRef(null);
  const [leaguePhase, setLeaguePhase] = useState('group');
  const [seasonMatchups, setSeasonMatchups] = useState([]);
  const playoffTies = useMemo(() => pairPlayoffTies(seasonMatchups), [seasonMatchups]);

  /* Friendlies (FRN) is a plain list of games: no league phase, no knockout, and
     every matchup is matchday-less by design. That last part matters -- the
     group|playoffs toggle and `pairPlayoffTies` both read "no matchday" as "this
     is a knockout leg", which is true for LIB/SUD but misfiles every friendlies
     fixture. So FRN skips the toggle and the group tables entirely and renders
     its fixtures. */
  const gamesOnly = selectedLeague?.kind === 'season' && selectedLeague?.code === 'FRN';

  /* Matchday navigation for the league view. `toMiniRow` already carries the
     matchday through, so this groups client-side and needs no extra request. */
  const fixtureMatchdays = useMemo(() => {
    const all = [...(leagueMatches.finished || []), ...(leagueMatches.upcoming || [])];
    const byMatchday = new Map();
    for (const m of all) {
      if (m.matchday == null) continue;
      if (!byMatchday.has(m.matchday)) byMatchday.set(m.matchday, []);
      byMatchday.get(m.matchday).push(m);
    }
    return [...byMatchday.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([matchday, games]) => ({ matchday, games }));
  }, [leagueMatches]);

  /* Opens on the most recently played matchday, so the view starts on results
     rather than on a future matchday with no scores. */
  const latestPlayedMatchday = useMemo(() => {
    const played = fixtureMatchdays.filter((entry) => entry.games.some((m) => m.result));
    if (played.length) return played[played.length - 1].matchday;
    return fixtureMatchdays.length ? fixtureMatchdays[0].matchday : null;
  }, [fixtureMatchdays]);

  const [activeMatchday, setActiveMatchday] = useState(null);

  useEffect(() => {
    setActiveMatchday(latestPlayedMatchday);
  }, [latestPlayedMatchday]);

  const activeMatchdayGames =
    fixtureMatchdays.find((entry) => entry.matchday === activeMatchday)?.games || [];

  async function loadStandings(league) {
    if (!league) return;
    standingsController.current?.abort();
    const controller = new AbortController();
    standingsController.current = controller;
    const { signal } = controller;
    setStandingsReq({ status: 'loading', error: '' });
    try {
      if (league.kind === 'season') {
        const groupsData = await apiFetch(`/seasons/${league.season_id}/group-standings/`, { signal });
        if (signal.aborted) return;
        const groups = groupsData?.groups || [];
        setLeagueStandings(
          groups.flatMap((g) => (g.standings || []).map((row) => ({ ...row, group: g.group }))),
        );
      } else {
        const data = await apiFetch(`/leagues/${league.id}/standings/`, { signal });
        if (signal.aborted) return;
        setLeagueStandings(Array.isArray(data) ? data : (data.standings || []));
      }
      setStandingsReq({ status: 'success', error: '' });
    } catch (err) {
      if (signal.aborted) return;
      setLeagueStandings([]);
      setStandingsReq({ status: 'error', error: err.code || 'unknown' });
    }
  }

  async function loadFixtures(league) {
    if (!league) return;
    fixturesController.current?.abort();
    const controller = new AbortController();
    fixturesController.current = controller;
    const { signal } = controller;
    setFixturesReq({ status: 'loading', error: '' });
    try {
      if (league.kind === 'season') {
        const stateData = await apiFetch(`/ui/seasons/${league.season_id}/state/`, { signal });
        if (signal.aborted) return;
        const matchups = stateData?.matchups || [];
        setSeasonMatchups(matchups);
        setLeagueMatches({
          finished: matchups.filter((m) => m.status === 'FINISHED').map(toMiniRow),
          upcoming: matchups.filter((m) => m.status !== 'FINISHED' && m.kickoff).map(toMiniRow),
        });
      } else {
        const data = await apiFetch(`/leagues/${league.id}/matches/`, { signal });
        if (signal.aborted) return;
        setLeagueMatches(data || { finished: [], upcoming: [] });
      }
      setFixturesReq({ status: 'success', error: '' });
    } catch (err) {
      if (signal.aborted) return;
      setSeasonMatchups([]);
      setLeagueMatches({ finished: [], upcoming: [] });
      setFixturesReq({ status: 'error', error: err.code || 'unknown' });
    }
  }

  function loadLeagueData(league) {
    if (!league) return;
    loadStandings(league);
    loadFixtures(league);
  }

  function cancelLeagueRequests() {
    standingsController.current?.abort();
    fixturesController.current?.abort();
  }

  useEffect(() => {
    if (selectedLeague) loadLeagueData(selectedLeague);
    return cancelLeagueRequests;
  }, [selectedLeague]);

  function handleSelectLeague(league) {
    cancelLeagueRequests();
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
            onClick={() => handleSelectLeague(null)}
          >
            <ArrowLeft size={16} />
            {t('nav.backToLeagues')}
          </button>
          <button className="back-button" onClick={() => loadLeagueData(selectedLeague)}>
            <RefreshCw size={14} /> {t('states.refresh')}
          </button>
        </div>
        {selectedLeague.kind === 'season' && !gamesOnly && (
          <SegmentControl
            className="segment-control"
            label={t('teams.leaguePhase')}
            value={leaguePhase}
            onChange={setLeaguePhase}
            items={[
              { key: 'group', label: t('teams.groupStage') },
              { key: 'playoffs', label: t('standings.playoffs') },
            ]}
          />
        )}
        {gamesOnly ? (
          <div>
            <h2 style={{ marginTop: 16 }}>{selectedLeague.name}</h2>
            {fixturesReq.status === 'loading' || fixturesReq.status === 'idle' ? (
              <Skeleton rows={5} label={t('teams.loadingFixtures')} variant="fixture" />
            ) : fixturesReq.status === 'error' ? (
              <ErrorState
                title={t('teams.fixturesLoadFailed')}
                detail={errorText(t, fixturesReq.error)}
                onRetry={() => loadFixtures(selectedLeague)}
              />
            ) : leagueMatches.finished?.length || leagueMatches.upcoming?.length ? (
              <div className="fixture-mini-list">
                {[...leagueMatches.finished, ...leagueMatches.upcoming]
                  .map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
              </div>
            ) : (
              <EmptyState
                title={t('teams.noFinishedMatches')}
                text={t('teams.noFinishedMatchesText')}
                action={<Button onClick={() => loadFixtures(selectedLeague)}>{t('states.refresh')}</Button>}
              />
            )}
          </div>
        ) : selectedLeague.kind === 'season' && leaguePhase === 'playoffs' ? (
          fixturesReq.status === 'loading' || fixturesReq.status === 'idle' ? (
            <Skeleton rows={3} label={t('teams.loadingFixtures')} variant="fixture" />
          ) : fixturesReq.status === 'error' ? (
            <ErrorState
              title={t('teams.fixturesLoadFailed')}
              detail={errorText(t, fixturesReq.error)}
              onRetry={() => loadFixtures(selectedLeague)}
            />
          ) : playoffTies.length ? (
            <div className="playoff-tie-list">
              {playoffTies.map((tie) => <PlayoffTieCard key={tie.legs[0].id} tie={tie} />)}
            </div>
          ) : (
            <EmptyState
              title={t('teams.noPlayoffMatchups')}
              action={<Button onClick={() => loadFixtures(selectedLeague)}>{t('states.refresh')}</Button>}
            />
          )
        ) : (
        <div className="standings-layout standings-layout--league">
          <div>
            <h2 style={{ marginTop: 16 }}>{selectedLeague.name}</h2>
            {standingsReq.status === 'loading' || standingsReq.status === 'idle' ? (
              <Skeleton rows={5} label={t('teams.loadingStandings')} />
            ) : standingsReq.status === 'error' ? (
              <ErrorState
                title={selectedLeague.kind === 'season' ? t('teams.groupStandingsLoadFailed') : t('teams.standingsLoadFailed')}
                detail={errorText(t, standingsReq.error)}
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
                title={selectedLeague.kind === 'season' ? t('teams.noGroupTable') : t('teams.noTable')}
                text={t('teams.noTableText')}
                action={<Button onClick={() => loadStandings(selectedLeague)}>{t('states.refresh')}</Button>}
              />
            )}
          </div>

          <aside>
            <h3 className="panel-title">{t('teams.fixtures')}</h3>
            {fixturesReq.status === 'loading' || fixturesReq.status === 'idle' ? (
              <Skeleton rows={3} label={t('teams.loadingFixtures')} variant="fixture" />
            ) : fixturesReq.status === 'error' ? (
              <ErrorState
                title={t('teams.fixturesLoadFailed')}
                detail={errorText(t, fixturesReq.error)}
                onRetry={() => loadFixtures(selectedLeague)}
              />
            ) : fixtureMatchdays.length ? (
              <>
                <div className="matchday-nav-row" role="group" aria-label={t('teams.matchday')}>
                  {fixtureMatchdays.map(({ matchday }) => (
                    <button
                      key={matchday}
                      type="button"
                      className={`matchday-nav-btn${matchday === activeMatchday ? ' is-active' : ''}`}
                      aria-pressed={matchday === activeMatchday}
                      onClick={() => setActiveMatchday(matchday)}
                    >
                      {matchday}
                    </button>
                  ))}
                </div>
                <div className="fixture-mini-list">
                  {activeMatchdayGames.map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              </>
            ) : (
              <EmptyState
                title={t('teams.noFixtures')}
                text={t('teams.noFixturesText')}
                action={<Button onClick={() => loadFixtures(selectedLeague)}>{t('states.refresh')}</Button>}
              />
            )}
          </aside>
        </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: 1100 }}>
      {leaguesStatus === 'loading' || leaguesStatus === 'idle' ? (
        <Skeleton rows={6} label={t('teams.loadingLeagues')} />
      ) : leaguesStatus === 'error' ? (
        <ErrorState title={t('teams.leaguesLoadFailed')} detail={errorText(t, leaguesError)} onRetry={onRetryLeagues} />
      ) : leagues.length ? (
        <div className="leagues-grid">
          {leagues.map((league) => (
            <button className="league-card" key={league.id} onClick={() => handleSelectLeague(league)}>
              {/* International competitions carry no crest of their own -- FRN and
                  UNL both serve emblem_url: null -- so they get a globe instead of
                  an empty slot. */}
              {league.emblem_url
                ? <img src={league.emblem_url} alt="" />
                : <Globe size={40} aria-hidden="true" className="league-card-globe" />}
              <div className="league-card-name">{league.name}</div>
              {league.country && <div className="league-card-country">{league.country}</div>}
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          title={t('teams.noLeagues')}
          action={<Button onClick={onRetryLeagues}>{t('states.refresh')}</Button>}
        />
      )}
    </div>
  );
}
