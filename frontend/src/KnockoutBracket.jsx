import ScoreInput from './ScoreInput';

const ROUND_LABELS = { R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const ROUND_ORDER = ['R16', 'QF', 'SF', 'F'];
const ROW_SPANS = { R16: 2, QF: 4, SF: 8, F: 16 };
const CONNECTORS = {
  R16: { sources: 8, targets: 4 },
  QF: { sources: 4, targets: 2 },
  SF: { sources: 2, targets: 1 },
};

function Connector({ sources, targets }) {
  const paths = [];
  for (let t = 0; t < targets; t++) {
    const a = t * (sources / targets);
    const b = a + 1;
    const ya = (a + 0.5) * (16 / sources);
    const yb = (b + 0.5) * (16 / sources);
    const ym = (t + 0.5) * (16 / targets);
    paths.push(`M0,${ya} H50 V${yb} H0 M50,${ym} H100`);
  }

  return (
    <svg className="ko-connector" viewBox="0 0 100 16" preserveAspectRatio="none">
      {paths.map((d, t) => (
        <path key={t} d={d} />
      ))}
    </svg>
  );
}

function KnockoutMatch({ match, onScoreChange, disabled, isFinal }) {
  const { home_team, away_team, home_goals, away_goals, winner } = match;
  const winnerId = winner?.team_id;

  return (
    <div
      className={`ko-match ${winner ? 'ko-decided' : ''} ${isFinal ? 'ko-match-final' : ''}`}
      style={{ gridRow: `span ${ROW_SPANS[match.round] || 2}` }}
    >
      <div className={`ko-team-row ${winnerId === home_team?.id ? 'ko-advancing' : ''}`}>
        {home_team ? (
          <>
            <span className="team-logo xs">
              {home_team.logo_url ? <img src={home_team.logo_url} alt="" /> : home_team.short_name?.slice(0, 3)}
            </span>
            <span className="ko-name">{home_team.short_name}</span>
            <ScoreInput
              value={home_goals}
              onChange={(v) => onScoreChange?.(match.round, match.bracket_position, 'home_goals', v)}
              disabled={disabled || !home_team}
              animateOnChange
            />
          </>
        ) : (
          <span className="ko-name ko-tbd">TBD</span>
        )}
      </div>
      <div className={`ko-team-row ${winnerId === away_team?.id ? 'ko-advancing' : ''}`}>
        {away_team ? (
          <>
            <span className="team-logo xs">
              {away_team.logo_url ? <img src={away_team.logo_url} alt="" /> : away_team.short_name?.slice(0, 3)}
            </span>
            <span className="ko-name">{away_team.short_name}</span>
            <ScoreInput
              value={away_goals}
              onChange={(v) => onScoreChange?.(match.round, match.bracket_position, 'away_goals', v)}
              disabled={disabled || !away_team}
              animateOnChange
            />
          </>
        ) : (
          <span className="ko-name ko-tbd">TBD</span>
        )}
      </div>
    </div>
  );
}

export default function KnockoutBracket({ bracket, onScoreChange }) {
  if (!bracket || Object.keys(bracket).length === 0) {
    return (
      <div className="state-message">
        <strong>Knockout rounds not yet available</strong>
        <span>Complete the playoff round to unlock the knockout bracket.</span>
      </div>
    );
  }

  return (
    <div className="ko-bracket-scroll">
      <h3 className="section-title">Knockout Phase</h3>
      <div className="ko-bracket">
        {ROUND_ORDER.map((roundKey, i) => {
          const matches = bracket[roundKey] || [];
          const hasTeams = matches.some(m => m.home_team && m.away_team);
          return (
            <div className="ko-col" key={roundKey} style={{ gridColumn: i * 2 + 1 }}>
              <h4 className="ko-round-title">{ROUND_LABELS[roundKey]}</h4>
              <div className="ko-matches">
                {matches.map((m) => (
                  <KnockoutMatch
                    key={`${m.round}-${m.bracket_position}`}
                    match={m}
                    onScoreChange={onScoreChange}
                    disabled={!hasTeams}
                    isFinal={roundKey === 'F'}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {ROUND_ORDER.slice(0, -1).map((roundKey, i) => (
          <div className="ko-gap" key={`gap-${roundKey}`} style={{ gridColumn: i * 2 + 2 }}>
            <Connector {...CONNECTORS[roundKey]} />
          </div>
        ))}
      </div>
    </div>
  );
}