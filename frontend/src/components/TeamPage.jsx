import { useEffect, useRef, useState } from 'preact/hooks';
import { ArrowLeft, RefreshCw } from 'lucide-preact';
import Button from './Button';
import Crest from './Crest';
import LeagueFixtureRow from './LeagueFixtureRow';
import StandingsTable from './StandingsTable';
import { EmptyState, ErrorState, Skeleton } from './States';
import { apiFetch } from '../lib/api';
import errorText from '../lib/errorText';
import { useI18n } from '../i18n';
import { buildLeaderboards, groupSquad } from '../lib/teamProfile';
import { normTeamName } from '../lib/teams';

export default function TeamPage({
  team, league, standings, matches, leagues,
  standingsReq, fixturesReq, onRetryStandings, onRetryFixtures, onBack, onRefresh,
}) {
  const { t } = useI18n();
  const [ucl, setUcl] = useState(null);
  const [uclReq, setUclReq] = useState({ status: 'idle', error: '' });
  const uclTokenRef = useRef(0);
  const uclLeague = (league && league.code === 'CL') ? null : (leagues || []).find((l) => l.code === 'CL');

  async function loadUcl(cl) {
    const token = ++uclTokenRef.current;
    setUclReq({ status: 'loading', error: '' });
    try {
      const [st, mt] = await Promise.all([
        apiFetch(`/leagues/${cl.id}/standings/`),
        apiFetch(`/leagues/${cl.id}/matches/`),
      ]);
      if (token !== uclTokenRef.current) return;
      setUcl({
        standings: Array.isArray(st) ? st : (st.standings || []),
        matches: mt || { finished: [], upcoming: [] },
      });
      setUclReq({ status: 'success', error: '' });
    } catch (err) {
      if (token !== uclTokenRef.current) return;
      setUcl(null);
      setUclReq({ status: 'error', error: err.code || 'unknown' });
    }
  }

  useEffect(() => {
    if (!uclLeague) {
      uclTokenRef.current += 1;
      setUcl(null);
      setUclReq({ status: 'success', error: '' });
      return undefined;
    }
    loadUcl(uclLeague);
    return () => { uclTokenRef.current += 1; };
  }, [league, leagues]);

  const [teamData, setTeamData] = useState(null);
  const [teamReq, setTeamReq] = useState({ status: 'idle', error: '' });
  const teamTokenRef = useRef(0);

  async function loadTeamProfile() {
    const token = ++teamTokenRef.current;
    setTeamReq({ status: 'loading', error: '' });
    try {
      const data = await apiFetch(`/teams/profile/?name=${encodeURIComponent(team.name)}`);
      if (token !== teamTokenRef.current) return;
      setTeamData(data);
      setTeamReq({ status: 'success', error: '' });
    } catch (err) {
      if (token !== teamTokenRef.current) return;
      setTeamData(null);
      setTeamReq({ status: 'error', error: err.code || 'unknown' });
    }
  }

  useEffect(() => {
    loadTeamProfile();
    return () => { teamTokenRef.current += 1; };
  }, [team.name]);

  const norm = normTeamName;
  const standing = (standings || []).find(
    (r) => norm(r.team_name || r.team?.name || r.name) === norm(team.name),
  );
  const teamMatches = (list) => (list || []).filter(
    (m) => norm(m.home_name) === norm(team.name) || norm(m.away_name) === norm(team.name),
  );
  const finished = teamMatches(matches && matches.finished);
  const upcoming = teamMatches(matches && matches.upcoming);
  const uclStanding = ucl
    ? ucl.standings.find((r) => norm(r.team_name || r.team?.name || r.name) === norm(team.name))
    : null;
  const uclFinished = ucl ? teamMatches(ucl.matches.finished) : [];
  const uclUpcoming = ucl ? teamMatches(ucl.matches.upcoming) : [];
  const isUcl = league && league.code === 'CL';
  const profile = teamData ? teamData.profile : null;
  const squad = Array.isArray(teamData?.squad) ? teamData.squad : [];
  const statLeaders = Array.isArray(teamData?.stat_leaders) ? teamData.stat_leaders : [];
  const found = teamData ? teamData.found !== false : false;
  const squadGroups = groupSquad(squad);
  const leaderboards = buildLeaderboards(statLeaders);

  return (
    <div style={{ padding: '24px', maxWidth: 1280 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={16} />
          {t('nav.backToLeague', { league: league ? league.name : '' })}
        </button>
        <button className="back-button" onClick={onRefresh}>
          <RefreshCw size={14} /> {t('states.refresh')}
        </button>
      </div>
      <div className="team-page-header">
        {team.crest ? (
          <Crest team={{ name: team.name, logo_url: team.crest }} size="md" className="team-page-crest" />
        ) : null}
        <h2 style={{ margin: 0 }}>{team.name}</h2>
        {league && <span className="league-badge">{league.name}</span>}
      </div>
      <div className="standings-layout">
        <div>
          <h3 className="panel-title">
            {isUcl ? t('teams.championsLeagueTable') : t('teams.leagueTable', { league: league ? league.name : '' })}
          </h3>
          {standingsReq && (standingsReq.status === 'loading' || standingsReq.status === 'idle') ? (
            <Skeleton rows={5} label={t('teams.loadingLeagueTable')} />
          ) : standingsReq && standingsReq.status === 'error' ? (
            <ErrorState
              title={t('teams.leagueTableLoadFailed')}
              detail={errorText(t, standingsReq.error)}
              onRetry={onRetryStandings}
            />
          ) : standing ? (
            <StandingsTable
              rows={standings || []}
              variant="standings"
              nameMode="full"
              highlight={(row) => norm(row.team_name || row.team?.name || row.name) === norm(team.name)}
            />
          ) : (
            <EmptyState
              title={t('teams.noTableRow', { team: team.name })}
              text={t('teams.noTableRowText', { league: league ? league.name : '' })}
              action={<Button onClick={onRetryStandings}>{t('states.refresh')}</Button>}
            />
          )}

          {fixturesReq && (fixturesReq.status === 'loading' || fixturesReq.status === 'idle') ? (
            <>
              <h3 className="panel-title">{t('teams.fixtures')}</h3>
              <Skeleton rows={3} label={t('teams.loadingFixtures')} variant="fixture" />
            </>
          ) : fixturesReq && fixturesReq.status === 'error' ? (
            <>
              <h3 className="panel-title">{t('teams.fixtures')}</h3>
              <ErrorState
                title={t('teams.fixturesLoadFailed')}
                detail={errorText(t, fixturesReq.error)}
                onRetry={onRetryFixtures}
              />
            </>
          ) : (finished.length || upcoming.length) ? (
            <>
              <h3 className="panel-title">{t('teams.fixtures')}</h3>
              {finished.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">{t('teams.recentResults')}</div>
                  {finished.slice(0, 6).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
              {upcoming.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">{t('teams.upcoming')}</div>
                  {upcoming.slice(0, 6).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <h3 className="panel-title">{t('teams.fixtures')}</h3>
              <EmptyState
                title={t('teams.noFixtures')}
                text={t('teams.noTeamFixturesText')}
                action={<Button onClick={onRetryFixtures}>{t('states.refresh')}</Button>}
              />
            </>
          )}
        </div>

        <aside>
          {!isUcl ? (
            <div className="panel-card">
              <h3 className="panel-title">{t('teams.championsLeague')}</h3>
              {uclReq.status === 'loading' || uclReq.status === 'idle' ? (
                <Skeleton rows={3} label={t('teams.checkingChampionsLeague')} />
              ) : uclReq.status === 'error' ? (
                <ErrorState
                  title={t('teams.championsLeagueLoadFailed')}
                  detail={errorText(t, uclReq.error)}
                  onRetry={() => uclLeague && loadUcl(uclLeague)}
                />
              ) : ucl ? (
                uclStanding ? (
                  <div className="ucl-card">
                    <div className="ucl-card-row">
                      <span>{t('teams.position')}</span>
                      <b>{uclStanding.position}</b>
                    </div>
                    <div className="ucl-card-row">
                      <span>{t('teams.points')}</span>
                      <b>{uclStanding.points}</b>
                    </div>
                    <div className="ucl-card-row">
                      <span>{t('teams.record')}</span>
                      <b>
                        {uclStanding.won ?? uclStanding.wins}W · {uclStanding.draw ?? uclStanding.draws}D ·{' '}
                        {uclStanding.lost ?? uclStanding.losses}L
                      </b>
                    </div>
                  </div>
                ) : (
                  <p className="muted small">{t('teams.notInUcl')}</p>
                )
              ) : null}
              {uclFinished.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">{t('teams.uclResults')}</div>
                  {uclFinished.slice(0, 4).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
              {uclUpcoming.length ? (
                <div className="fixture-mini-list">
                  <div className="fixture-mini-heading">{t('teams.uclUpcoming')}</div>
                  {uclUpcoming.slice(0, 4).map((m) => <LeagueFixtureRow key={m.id} m={m} />)}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="panel-card">
            <h3 className="panel-title">{t('teams.honours')}</h3>
            <p className="muted small">
              {t('teams.trophyHistoryNotSynced')}
            </p>
          </div>
          <div className="panel-card">
            <h3 className="panel-title">{t('teams.squad')}</h3>
            {teamReq.status === 'loading' || teamReq.status === 'idle' ? (
              <Skeleton rows={3} label={t('teams.loadingSquad')} />
            ) : teamReq.status === 'error' ? (
              <ErrorState
                title={t('teams.teamDataLoadFailed')}
                detail={errorText(t, teamReq.error)}
                onRetry={loadTeamProfile}
              />
            ) : !found ? (
              <EmptyState
                title={t('teams.notInDatabase', { team: team.name })}
                text={t('teams.noClubRecord')}
              />
            ) : !profile && !squad.length && !statLeaders.length ? (
              <EmptyState
                title={t('teams.playerDataNotSynced')}
                text={t('teams.noSquadOnRecord')}
              />
            ) : squadGroups.length ? (
              squadGroups.map((group) => (
                <div className="fixture-mini-list" key={group.group}>
                  <div className="fixture-mini-heading">{group.group}</div>
                  {group.players.map((player, index) => (
                    <div className="squad-row" key={`${player.name}-${index}`}>
                      <span className="squad-number">{player.shirt_number ?? '-'}</span>
                      <span className="squad-name">{player.name}</span>
                      {player.birth_date ? <span className="squad-meta">{player.birth_date}</span> : null}
                      {player.height ? <span className="squad-meta">{player.height}</span> : null}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <p className="muted small">{t('teams.noSquadPlayers')}</p>
            )}
          </div>
          {profile ? (
            <div className="panel-card">
              <h3 className="panel-title">{t('teams.profile')}</h3>
              <div className="ucl-card">
                {profile.stadium_name ? (
                  <div className="ucl-card-row">
                    <span>{t('teams.stadium')}</span>
                    <b>{profile.stadium_name}</b>
                  </div>
                ) : null}
                {profile.stadium_capacity ? (
                  <div className="ucl-card-row">
                    <span>{t('teams.capacity')}</span>
                    <b>{profile.stadium_capacity}</b>
                  </div>
                ) : null}
                {profile.stadium_city ? (
                  <div className="ucl-card-row">
                    <span>{t('teams.stadiumCity')}</span>
                    <b>{profile.stadium_city}</b>
                  </div>
                ) : null}
                {profile.founded ? (
                  <div className="ucl-card-row">
                    <span>{t('teams.founded')}</span>
                    <b>{profile.founded}</b>
                  </div>
                ) : null}
                {profile.nickname ? (
                  <div className="ucl-card-row">
                    <span>{t('teams.nickname')}</span>
                    <b>{profile.nickname}</b>
                  </div>
                ) : null}
                {profile.primary_color ? (
                  <div className="ucl-card-row">
                    <span>{t('teams.colours')}</span>
                    <b
                      className="color-swatch"
                      style={{ background: profile.primary_color, color: profile.text_color || '#FFFFFF' }}
                    >
                      {profile.primary_color}
                    </b>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="panel-card">
            <h3 className="panel-title">{t('teams.topPlayers')}</h3>
            {leaderboards.length ? (
              leaderboards.map((competition) => (
                <div className="fixture-mini-list" key={competition.competition}>
                  <div className="fixture-mini-heading">{competition.competition}</div>
                  {competition.metrics.map((metric) => (
                    <div key={metric.metric}>
                      <div className="fixture-mini-heading">{metric.metric}</div>
                      {metric.rows.map((row, index) => (
                        <div className="leader-row" key={`${row.player_name}-${index}`}>
                          <span className="leader-rank">{row.rank}</span>
                          <span className="leader-name">{row.player_name || row.player_short_name || ''}</span>
                          <b className="leader-value">{row.value}</b>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <p className="muted small">{t('teams.noLeaderboardData')}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
