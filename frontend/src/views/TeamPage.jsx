import { useEffect, useState } from 'preact/hooks';
import { Activity, ArrowLeft, RefreshCw } from 'lucide-preact';
import Crest from '../components/Crest';
import LeagueFixtureRow from '../components/LeagueFixtureRow';
import StandingsTable from '../components/StandingsTable';
import { StateMessage } from '../components/States';
import { apiFetch } from '../lib/api';
import { normTeamName } from '../lib/teams';

export default function TeamPage({ team, league, standings, matches, leagues, onBack, onRefresh }) {
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
        {team.crest ? (
          <Crest team={{ name: team.name, logo_url: team.crest }} size="md" className="team-page-crest" />
        ) : null}
        <h2 style={{ margin: 0 }}>{team.name}</h2>
        {league && <span className="league-badge">{league.name}</span>}
      </div>
      <div className="standings-layout">
        <div>
          <h3 className="panel-title">
            {isUcl ? 'Champions League table' : `League table — ${league ? league.name : ''}`}
          </h3>
          {standing ? (
            <StandingsTable
              rows={standings || []}
              variant="standings"
              nameMode="full"
              highlight={(row) => norm(row.team_name || row.team?.name || row.name) === norm(team.name)}
            />
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
