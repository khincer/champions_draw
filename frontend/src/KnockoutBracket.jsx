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

function ScoreRow({ team, goals, onChange, disabled, isAdvancing, className }) {
  return (
    <div className={`ko-team-row ${isAdvancing ? 'ko-advancing' : ''} ${className || ''}`}>
      {team ? (
        <>
          <span className="team-logo xs">
            {team.logo_url ? <img src={team.logo_url} alt="" /> : team.short_name?.slice(0, 3)}
          </span>
          <span className="ko-name">{team.short_name}</span>
          <ScoreInput
            value={goals}
            onChange={onChange}
            disabled={disabled}
            animateOnChange
          />
        </>
      ) : (
        <span className="ko-name ko-tbd">TBD</span>
      )}
    </div>
  );
}

function KnockoutMatch({ match, onScoreChange, disabled, isFinal }) {
  const {
    home_team, away_team, home_goals, away_goals,
    extra_time, penalties,
    et_home_goals, et_away_goals,
    pen_home_goals, pen_away_goals,
    winner, round, bracket_position,
  } = match;
  const winnerId = winner?.team_id;

  // Check if regular time is tied
  const regularTied = home_goals != null && away_goals != null && home_goals === away_goals;

  // Check if ET is played and still tied
  let etTied = false;
  if (regularTied && et_home_goals != null && et_away_goals != null) {
    etTied = (home_goals + et_home_goals) === (away_goals + et_away_goals);
  }

  // Tiebreaker description
  let tieDesc = null;
  if (winner && regularTied) {
    if (penalties && pen_home_goals != null) {
      tieDesc = `Pens ${pen_home_goals}–${pen_away_goals}`;
    } else if (extra_time && et_home_goals != null) {
      tieDesc = `ET ${home_goals + et_home_goals}–${away_goals + et_away_goals}`;
    }
  }

  const koKey = (field) => (e) => onScoreChange?.(round, bracket_position, field, e);

  return (
    <div
      className={`ko-match ${winner ? 'ko-decided' : ''} ${isFinal ? 'ko-match-final' : ''}`}
      style={{ gridRow: `span ${ROW_SPANS[match.round] || 2}` }}
    >
      <ScoreRow
        team={home_team}
        goals={home_goals}
        onChange={koKey('home_goals')}
        disabled={disabled || !home_team}
        isAdvancing={winnerId === home_team?.id}
      />
      <ScoreRow
        team={away_team}
        goals={away_goals}
        onChange={koKey('away_goals')}
        disabled={disabled || !away_team}
        isAdvancing={winnerId === away_team?.id}
      />

      {/* Extra time row — shown when 90-min score is tied */}
      {regularTied && (
        <div className="ko-tiebreaker">
          <span className="ko-tb-label">ET</span>
          <ScoreRow
            team={home_team}
            goals={et_home_goals}
            onChange={koKey('et_home_goals')}
            disabled={disabled}
            isAdvancing={false}
            className="ko-tb-row"
          />
          <ScoreRow
            team={away_team}
            goals={et_away_goals}
            onChange={koKey('et_away_goals')}
            disabled={disabled}
            isAdvancing={false}
            className="ko-tb-row"
          />
        </div>
      )}

      {/* Penalties row — shown when ET is played and still tied */}
      {etTied && (
        <div className="ko-tiebreaker ko-pens">
          <span className="ko-tb-label">Pens</span>
          <ScoreRow
            team={home_team}
            goals={pen_home_goals}
            onChange={koKey('pen_home_goals')}
            disabled={disabled}
            isAdvancing={false}
            className="ko-tb-row"
          />
          <ScoreRow
            team={away_team}
            goals={pen_away_goals}
            onChange={koKey('pen_away_goals')}
            disabled={disabled}
            isAdvancing={false}
            className="ko-tb-row"
          />
        </div>
      )}

      {tieDesc && <span className="ko-tie-desc">{tieDesc}</span>}
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
      <p className="section-desc">
        Single-leg knockout matches. If tied at 90 minutes, extra time is played;
        if still tied, penalties decide the winner.
      </p>
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
