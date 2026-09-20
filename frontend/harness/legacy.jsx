/* Verbatim pre-Phase-2 (HEAD 7fb40b6) standings markup, kept only so the
   harness can diff the shared `StandingsTable` against the tables it replaced.
   This file is temporary harness scaffolding and is deleted after the run. */

/* HEAD LeagueTable.jsx — prediction app "Standings" tab (league dialect). */
export function LegacyLeagueTable({ rows }) {
  return (
    <div className="league-table-wrap">
      <h3 className="section-title">League Phase Standings</h3>
      <div className="league-table-scroll">
        <table className="league-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="tbl-team">Team</th>
              <th>Pts</th>
              <th>Pld</th>
              <th>GD</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>GF</th>
              <th>GA</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              let cls = 'table-row';
              if (row.position <= 8) cls += ' row-qualified';
              else if (row.position <= 24) cls += ' row-playoffs';
              else cls += ' row-eliminated';

              return (
                <tr className={cls} key={row.team_id}>
                  <td className="tbl-pos">{row.position}</td>
                  <td className="tbl-team">
                    <span className="team-logo xs">
                      {row.team?.logo_url
                        ? <img src={row.team.logo_url} alt=""/>
                        : row.team?.short_name?.slice(0, 3)}
                    </span>
                    <span className="tbl-name">{row.team?.short_name || row.short_name}</span>
                  </td>
                  <td className="tbl-pts"><strong>{row.points}</strong></td>
                  <td>{row.played}</td>
                  <td className={row.goal_diff > 0 ? 'gd-pos' : row.goal_diff < 0 ? 'gd-neg' : ''}>
                    {row.goal_diff > 0 ? '+' : ''}{row.goal_diff}
                  </td>
                  <td>{row.wins}</td>
                  <td>{row.draws}</td>
                  <td>{row.losses}</td>
                  <td>{row.goals_for}</td>
                  <td>{row.goals_against}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-legend">
        <span className="legend-dot q" /> Qualified (1-8)
        <span className="legend-dot p" /> Playoffs (9-24)
        <span className="legend-dot e" /> Eliminated (25-36)
      </div>
    </div>
  );
}

/* HEAD RealDrawView.jsx:460-506 — real UCL standings (league dialect, `P`). */
export function LegacyRealLeagueTable({ rows }) {
  return (
    <table className="league-table real-league-table">
      <thead>
        <tr>
          <th>#</th>
          <th className="tbl-team">Team</th>
          <th>Pts</th>
          <th>P</th>
          <th>GD</th>
          <th>W</th>
          <th>D</th>
          <th>L</th>
          <th>GF</th>
          <th>GA</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          let cls = 'table-row';
          if (row.position <= 8) cls += ' row-qualified';
          else if (row.position <= 24) cls += ' row-playoffs';
          else cls += ' row-eliminated';
          return (
            <tr className={cls} key={row.team_id}>
              <td className="tbl-pos">{row.position}</td>
              <td className="tbl-team">
                <span className="team-logo xs">
                  {row.team?.logo_url
                    ? <img src={row.team.logo_url} alt=""/>
                    : row.team?.short_name?.slice(0, 3)}
                </span>
                <span className="tbl-name">{row.team?.name || row.short_name}</span>
              </td>
              <td className="tbl-pts"><strong>{row.points}</strong></td>
              <td>{row.played}</td>
              <td className={row.goal_diff > 0 ? 'gd-pos' : row.goal_diff < 0 ? 'gd-neg' : ''}>
                {row.goal_diff > 0 ? '+' : ''}{row.goal_diff}
              </td>
              <td>{row.wins}</td>
              <td>{row.draws}</td>
              <td>{row.losses}</td>
              <td>{row.goals_for}</td>
              <td>{row.goals_against}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* HEAD main.jsx:361-402 — TeamPage league table (`standings` dialect, no band). */
export function LegacyTeamPageTable({ rows, norm, highlightName }) {
  return (
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
        {rows.map((row, i) => (
          <tr
            key={row.team?.id || i}
            className={norm(row.team_name || row.team?.name || row.name) === norm(highlightName) ? 'team-row-highlight' : ''}
          >
            <td className="standings-pos">{row.position || i + 1}</td>
            <td>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {row.logo_url ? (
                  <img src={row.logo_url} alt="" style={{ width: 20, height: 20 }} />
                ) : row.team_crest ? (
                  <img src={row.team_crest} alt="" style={{ width: 20, height: 20 }} />
                ) : row.team?.crest ? (
                  <img src={row.team.crest} alt="" style={{ width: 20, height: 20 }} />
                ) : row.team?.logo_url ? (
                  <img src={row.team.logo_url} alt="" style={{ width: 20, height: 20 }} />
                ) : null}
                {row.name || row.team?.name || row.team_name}
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
  );
}

/* HEAD main.jsx:505-560 — GroupStandingsTables (group row shape, team-link). */
export function LegacyGroupTable({ rows, group, onOpenTeam }) {
  return (
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
        {rows.filter((r) => r.group === group).map((row, i) => (
          <tr key={row.team_id || row.team?.id || i}>
            <td className="standings-pos">{row.position || i + 1}</td>
            <td>
              <button
                className="team-link"
                onClick={() => onOpenTeam({
                  name: row.name || row.team?.name || row.team_name,
                  crest: row.logo_url || row.team_crest || row.team?.crest || row.team?.logo_url,
                })}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {row.logo_url ? (
                    <img src={row.logo_url} alt="" style={{ width: 20, height: 20 }} />
                  ) : row.team_crest ? (
                    <img src={row.team_crest} alt="" style={{ width: 20, height: 20 }} />
                  ) : row.team?.crest ? (
                    <img src={row.team.crest} alt="" style={{ width: 20, height: 20 }} />
                  ) : row.team?.logo_url ? (
                    <img src={row.team.logo_url} alt="" style={{ width: 20, height: 20 }} />
                  ) : null}
                  <span>{row.name || row.team?.name || row.team_name}</span>
                </div>
              </button>
            </td>
            <td>{row.played ?? row.playedGames}</td>
            <td>{row.wins ?? row.won}</td>
            <td>{row.draws ?? row.draw}</td>
            <td>{row.losses ?? row.lost}</td>
            <td className="standings-pts">{row.points}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* HEAD main.jsx:739-783 — league page standings (`standings` dialect, team-link). */
export function LegacyLeaguePageTable({ rows, onOpenTeam }) {
  return (
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
        {rows.map((row, i) => (
          <tr key={row.team?.id || i}>
            <td className="standings-pos">{row.position || i + 1}</td>
            <td>
              <button
                className="team-link"
                onClick={() => onOpenTeam({
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
  );
}

/* HEAD PredictionApp.jsx:805-843 — prediction sidebar (sidebar dialect). */
export function LegacySidebarTable({ rows }) {
  return (
    <>
      <div className="sidebar-standings-scroll">
        <table className="sidebar-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 36).map((row) => {
              let cls = '';
              if (row.position <= 8) cls = 'r-qual';
              else if (row.position <= 24) cls = 'r-play';
              else cls = 'r-elim';
              return (
                <tr className={cls} key={row.team_id}>
                  <td className="sp">{row.position}</td>
                  <td className="st">
                    <span className="team-logo xs">
                      {row.team?.logo_url
                        ? <img src={row.team.logo_url} alt=""/>
                        : row.team?.short_name?.slice(0, 3)}
                    </span>
                    {row.team?.short_name || row.short_name}
                  </td>
                  <td className="spts">{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sidebar-legend">
        <span><span className="sq" /> 1-8</span>
        <span><span className="sp" /> 9-24</span>
        <span><span className="se" /> 25-36</span>
      </div>
    </>
  );
}

/* HEAD main.jsx LeagueFixtureRow — the mini fixture line (16px bare img crest).
   Stale by design for the crest-less side: HEAD emitted NOTHING there
   (`{m.home_crest ? <img/> : null}`), while the spec requires initials
   (UC:single-crest, "Missing image"). The harness asserts the new behaviour. */
export function LegacyLeagueFixtureRow({ m }) {
  const done = m.status === 'FINISHED' && m.result;
  return (
    <div className="fixture-mini">
      <div className="fixture-mini-date">{m.dateLabel}</div>
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
      <div className="fixture-mini-time">{done ? 'FT' : m.timeLabel}</div>
    </div>
  );
}

/* HEAD RealDrawView score-row — the real-fixture row (30px TeamLogo, status). */
export function LegacyScoreRow({ status, statusTone, statusTitle, home, away, center }) {
  return (
    <div className="fixture-row score-row">
      <div className={statusTone ? `fx-status ${statusTone}` : 'fx-status'} title={statusTitle}>{status}</div>
      <div className="team-badge score-team">
        <span className="team-logo sm">
          {home.logo_url
            ? <img src={home.logo_url} alt={home.name} />
            : home.short_name?.slice(0, 3)}
        </span>
        <b>{home.name}</b>
      </div>
      {center}
      <div className="team-badge right score-team">
        <b>{away.name}</b>
        <span className="team-logo sm">
          {away.logo_url
            ? <img src={away.logo_url} alt={away.name} />
            : away.short_name?.slice(0, 3)}
        </span>
      </div>
    </div>
  );
}
