import ScoreInput from './ScoreInput';

function computeAgg(l1h, l1a, l2h, l2a) {
  if ([l1h, l1a, l2h, l2a].some(v => v == null)) return null;
  return { home: l1a + l2h, away: l1h + l2a };
}

function TeamBadge({ team, side, aggGoals, isWinner, score1, score2, field1, field2, matchupIdx, onScoreChange }) {
  return (
    <div className={`bracket-team ${side === 'right' ? 'bracket-team-right' : ''} ${isWinner ? 'bracket-winner' : ''}`}>
      <div className="bracket-team-row">
        <span className="bracket-seed">{team?.seeding_position}</span>
        <span className="team-logo sm">
          {team?.logo_url
            ? <img src={team.logo_url} alt="" />
            : team?.short_name?.slice(0, 3)}
        </span>
        <span className="bracket-name">{team?.short_name}</span>
        {isWinner && <span className="bracket-won-badge">W</span>}
      </div>
      <div className="bracket-scores-row">
        <span className="bracket-leg-label">Leg1</span>
        <ScoreInput
          value={score1}
          onChange={(v) => onScoreChange(matchupIdx, field1, v)}
        />
        <span className="score-sep">–</span>
        <ScoreInput
          value={score2}
          onChange={(v) => onScoreChange(matchupIdx, field2, v)}
        />
        <span className="bracket-leg-label">Leg2</span>
        {aggGoals != null && <span className="bracket-agg">Agg: {aggGoals}</span>}
      </div>
    </div>
  );
}

function BracketMatch({ matchup, onScoreChange }) {
  const {
    matchup_index, home_team, away_team,
    leg1_home_goals, leg1_away_goals,
    leg2_home_goals, leg2_away_goals,
    winner,
  } = matchup;

  const agg = computeAgg(leg1_home_goals, leg1_away_goals, leg2_home_goals, leg2_away_goals);
  const winnerId = winner?.team_id;
  const homeWon = winnerId && winnerId === home_team?.id;
  const awayWon = winnerId && winnerId === away_team?.id;
  const decided = !!winnerId;

  return (
    <div className={`bracket-match ${decided ? 'bracket-decided' : ''}`}>
      <div className="bracket-match-label">#{matchup_index}</div>

      <TeamBadge
        team={home_team}
        side="left"
        isWinner={homeWon}
        aggGoals={agg?.home}
        score1={leg1_home_goals}
        score2={leg2_home_goals}
        field1="leg1_home_goals"
        field2="leg2_home_goals"
        matchupIdx={matchup_index}
        onScoreChange={onScoreChange}
      />

      <div className="bracket-connector">
        <div className="bracket-connector-arm top" />
        <div className="bracket-connector-center">
          {decided ? (
            <div className="bracket-advance-inner winner-animate">
              <span className="team-logo xs">
                {winner?.logo_url
                  ? <img src={winner.logo_url} alt="" />
                  : winner?.short_name?.slice(0, 3)}
              </span>
              <span className="bracket-advance-name">{winner?.short_name}</span>
              <span className="bracket-arrow">►</span>
            </div>
          ) : (
            <div className="bracket-advance-inner bracket-tbd">
              <span className="bracket-leg-labels">
                <span>Leg1</span>
                <span className="score-sep">–</span>
                <span>Leg2</span>
              </span>
            </div>
          )}
        </div>
        <div className="bracket-connector-arm bottom" />
      </div>

      <TeamBadge
        team={away_team}
        side="right"
        isWinner={awayWon}
        aggGoals={agg?.away}
        score1={leg1_away_goals}
        score2={leg2_away_goals}
        field1="leg1_away_goals"
        field2="leg2_away_goals"
        matchupIdx={matchup_index}
        onScoreChange={onScoreChange}
      />
    </div>
  );
}

export default function PlayoffBracket({ matchups, onScoreChange }) {
  if (!matchups || matchups.length === 0) {
    return (
      <div className="state-message">
        <strong>Playoffs not yet available</strong>
        <span>Complete your league phase predictions to unlock the playoff bracket.</span>
      </div>
    );
  }

  return (
    <div className="bracket-wrap">
      <h3 className="section-title">Playoff Round</h3>
      <p className="section-desc">
        Positions 9–24 compete in two-legged ties. Higher seed plays leg 2 at home.
      </p>
      <div className="bracket-round">
        <div className="bracket-round-head">
          <span className="bracket-round-line left" />
          <span className="bracket-round-label">Playoffs</span>
          <span className="bracket-round-line right" />
        </div>
        {matchups.map((m) => (
          <BracketMatch key={m.matchup_index} matchup={m} onScoreChange={onScoreChange} />
        ))}
      </div>
    </div>
  );
}
