import Crest, { TeamBadge } from './Crest';

function Side({ team, align, badge, layout, nameMode }) {
  const full = team?.name || '';
  const short = team?.short_name || full;
  const label = nameMode === 'short' ? short : full;

  if (badge) return <TeamBadge team={team} align={align} />;

  if (layout === 'mini') {
    return (
      <span className={align === 'right' ? 'fixture-mini-away' : 'fixture-mini-home'}>
        {align === 'right' ? null : <Crest team={team} size="xs" />}
        {label}
        {align === 'right' ? <Crest team={team} size="xs" /> : null}
      </span>
    );
  }

  return (
    <div className={`team-badge score-team ${align === 'right' ? 'right' : ''}`.trim()}>
      {align === 'right' ? <b>{label}</b> : <Crest team={team} size="sm" />}
      {align === 'right' ? <Crest team={team} size="sm" /> : <b>{label}</b>}
    </div>
  );
}

export default function FixtureRow({
  layout = 'row',
  className = '',
  competition,
  leading,
  trailing,
  status,
  statusTone,
  statusTitle,
  date,
  time,
  home,
  away,
  nameMode = 'short',
  badge = false,
  center,
  scoreText,
}) {
  if (layout === 'mini') {
    return (
      <div className={`fixture-mini ${className}`.trim()}>
        <div className="fixture-mini-date">{date}</div>
        <div className="fixture-mini-teams">
          <Side team={home} layout="mini" nameMode={nameMode} />
          <span className="fixture-mini-score">{scoreText}</span>
          <Side team={away} layout="mini" nameMode={nameMode} align="right" />
        </div>
        <div className="fixture-mini-time">{time}</div>
      </div>
    );
  }

  const statusCell = status || competition ? (
    <div className={`fx-status ${statusTone || ''}`.trim()} title={statusTitle}>
      {competition ? <span className="fx-competition">{competition}</span> : null}
      {status}
    </div>
  ) : null;

  return (
    <div className={`${layout === 'team' ? 'team-fixture-row' : 'fixture-row'} ${className}`.trim()}>
      {leading}
      {statusCell}
      <Side team={home} layout={layout} nameMode={nameMode} badge={badge} />
      {center}
      <Side team={away} layout={layout} nameMode={nameMode} badge={badge} align="right" />
      {trailing}
    </div>
  );
}
