import Crest from './Crest';

/* Single standings table (UC:single-standings-table).
   Owns the qualified / playoffs / eliminated logic once. Ordering is never
   touched here — rows render in the order the caller computed them, and every
   number keeps the `??` fallback chain the hand-written tables used so both
   payload shapes (flat `{played, wins, draws, losses}` and football-data
   `{playedGames, won, draw, lost, team: {...}}`) resolve to the same values.

   Three class dialects are preserved from the tables this replaces
   (`standings` = league/team pages, `league` = league-phase table, `sidebar` =
   prediction sidebar) so no stylesheet rule had to be retuned. Header cells
   keep the classes they carry today — only `standings` styles its own headers.

   `playedHeader` defaults to `P` because four of the five replaced tables
   (`TeamPage`, `GroupStandingsTables`, the league page and the real-draw
   standings) labelled the column `P`; only the prediction league table
   labelled it `Pld`, so that one call site passes it explicitly. */
const BANDS = {
  qualified: { mark: '▲', text: 'Qualified', league: 'row-qualified', sidebar: 'r-qual' },
  playoffs: { mark: '◆', text: 'Playoffs', league: 'row-playoffs', sidebar: 'r-play' },
  eliminated: { mark: '▼', text: 'Eliminated', league: 'row-eliminated', sidebar: 'r-elim' },
};

function bandOf(position) {
  const value = Number(position);
  if (!Number.isFinite(value)) return null;
  if (value <= 8) return 'qualified';
  if (value <= 24) return 'playoffs';
  return 'eliminated';
}

const CELLS = {
  pos: { header: '#', slot: 'pos', value: (row, index) => row.position ?? index + 1 },
  team: { header: 'Team', slot: 'team' },
  played: { header: 'P', value: (row) => row.playedGames ?? row.played },
  won: { header: 'W', value: (row) => row.won ?? row.wins },
  drawn: { header: 'D', value: (row) => row.draw ?? row.draws },
  lost: { header: 'L', value: (row) => row.lost ?? row.losses },
  points: { header: 'Pts', slot: 'pts', value: (row) => row.points },
  goalDiff: {
    header: 'GD',
    className: (row) => (row.goal_diff > 0 ? 'gd-pos' : row.goal_diff < 0 ? 'gd-neg' : ''),
    value: (row) => `${row.goal_diff > 0 ? '+' : ''}${row.goal_diff}`,
  },
  goalsFor: { header: 'GF', value: (row) => row.goals_for },
  goalsAgainst: { header: 'GA', value: (row) => row.goals_against },
};

const VARIANTS = {
  standings: {
    table: 'standings-table',
    columns: ['pos', 'team', 'played', 'won', 'drawn', 'lost', 'points'],
    header: { pos: 'standings-pos', team: '', pts: 'standings-pts' },
    cell: { pos: 'standings-pos', team: '', pts: 'standings-pts' },
    banded: false,
    rowBase: '',
  },
  league: {
    table: 'league-table',
    columns: ['pos', 'team', 'points', 'played', 'goalDiff', 'won', 'drawn', 'lost', 'goalsFor', 'goalsAgainst'],
    header: { pos: '', team: 'tbl-team', pts: '' },
    cell: { pos: 'tbl-pos', team: 'tbl-team', pts: 'tbl-pts' },
    banded: true,
    rowBase: 'table-row',
  },
  sidebar: {
    table: 'sidebar-table',
    columns: ['pos', 'team', 'points'],
    header: { pos: '', team: '', pts: '' },
    cell: { pos: 'sp', team: 'st', pts: 'spts' },
    banded: true,
    rowBase: '',
  },
};

function resolveTeam(row, nameMode) {
  const full = row.name || row.team?.name || row.team_name || row.short_name || '';
  const short = row.team?.short_name || row.short_name || full;
  return {
    name: nameMode === 'short' ? short : full,
    short_name: short,
    logo_url: row.logo_url || row.team_crest || row.team?.crest || row.team?.logo_url,
  };
}

function TeamCell({ team, variant }) {
  if (variant === 'standings') {
    return (
      <div className="standings-team">
        <Crest team={team} size="xs" />
        <span>{team.name}</span>
      </div>
    );
  }
  if (variant === 'sidebar') {
    return (
      <>
        <Crest team={team} size="xs" />
        {team.name}
      </>
    );
  }
  return (
    <>
      <Crest team={team} size="xs" />
      <span className="tbl-name">{team.name}</span>
    </>
  );
}

export default function StandingsTable({
  rows = [],
  variant = 'standings',
  nameMode = 'full',
  playedHeader = 'P',
  onTeamClick,
  highlight,
  legend,
  scrollClassName,
  className = '',
}) {
  const spec = VARIANTS[variant];
  const columns = spec.columns.map((key) =>
    key === 'played' ? { ...CELLS.played, header: playedHeader } : CELLS[key],
  );

  const table = (
    <table className={`${spec.table} ${className}`.trim()}>
      <thead>
        <tr>
          {columns.map((column) => (
            <th className={column.slot ? spec.header[column.slot] : ''} key={column.header}>
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const team = resolveTeam(row, nameMode);
          const band = spec.banded ? bandOf(row.position) : null;
          const bandClass = band
            ? variant === 'sidebar'
              ? BANDS[band].sidebar
              : BANDS[band].league
            : '';
          const rowClassName = [
            spec.rowBase,
            bandClass,
            highlight?.(row) ? 'team-row-highlight' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <tr className={rowClassName} key={row.team_id ?? row.team?.id ?? index}>
              {columns.map((column) => {
                const cellClassName = [
                  column.slot ? spec.cell[column.slot] : '',
                  column.className?.(row) || '',
                ]
                  .filter(Boolean)
                  .join(' ');

                if (column.slot === 'team') {
                  const content = <TeamCell team={team} variant={variant} />;
                  return (
                    <td className={cellClassName} key="team">
                      {onTeamClick ? (
                        <button className="team-link" type="button" onClick={() => onTeamClick(row)}>
                          {content}
                        </button>
                      ) : (
                        content
                      )}
                    </td>
                  );
                }

                return (
                  <td className={cellClassName} key={column.header}>
                    {column.value(row, index)}
                    {column.slot === 'pos' && band ? (
                      <>
                        <span className="band-mark" aria-hidden="true">{BANDS[band].mark}</span>
                        <span className="sr-only">{BANDS[band].text}</span>
                      </>
                    ) : null}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  return (
    <>
      {scrollClassName ? <div className={scrollClassName}>{table}</div> : table}
      {legend === 'league' ? (
        <div className="table-legend">
          <span className="legend-dot q" /> Qualified (1-8)
          <span className="legend-dot p" /> Playoffs (9-24)
          <span className="legend-dot e" /> Eliminated (25-36)
        </div>
      ) : null}
      {legend === 'sidebar' ? (
        <div className="sidebar-legend">
          <span><span className="sq" /> 1-8</span>
          <span><span className="sp" /> 9-24</span>
          <span><span className="se" /> 25-36</span>
        </div>
      ) : null}
    </>
  );
}
