import { useMemo } from 'preact/hooks';
import { computeStandings } from './standingsCalc';

export default function LeagueTable({ teams, matchPredictions }) {
  const standings = useMemo(
    () => computeStandings(teams || [], matchPredictions || {}),
    [teams, matchPredictions],
  );

  return (
    <div className="league-table-wrap">
      <h3 className="section-title">League Phase Standings</h3>
      <div className="league-table-scroll">
        <table className="league-table">
          <thead>
            <tr>
              <th>#</th>
              <th className="tbl-team">Team</th>
              <th>Pld</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>GF</th>
              <th>GA</th>
              <th>GD</th>
              <th>Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => {
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
                  <td>{row.played}</td>
                  <td>{row.wins}</td>
                  <td>{row.draws}</td>
                  <td>{row.losses}</td>
                  <td>{row.goals_for}</td>
                  <td>{row.goals_against}</td>
                  <td className={row.goal_diff > 0 ? 'gd-pos' : row.goal_diff < 0 ? 'gd-neg' : ''}>
                    {row.goal_diff > 0 ? '+' : ''}{row.goal_diff}
                  </td>
                  <td className="tbl-pts"><strong>{row.points}</strong></td>
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
