import { useState } from 'preact/hooks';
import ScoreInput from './ScoreInput';

function computeAggWinner(l1h, l1a, l2h, l2a, homeId, awayId) {
  if ([l1h, l1a, l2h, l2a].some(v => v == null)) return null;
  const aggHome = l1a + l2h;
  const aggAway = l1h + l2a;
  if (aggHome > aggAway) return homeId;
  if (aggAway > aggHome) return awayId;
  if (l2a > l1h) return awayId;
  if (l1h > l2a) return homeId;
  return homeId;
}

function PlayoffTie({ matchup, onScoreChange }) {
  const { matchup_index, home_team, away_team, leg1_home_goals, leg1_away_goals, leg2_home_goals, leg2_away_goals, winner } = matchup;

  const homeLogo = home_team?.logo_url
    ? <img src={home_team.logo_url} alt="" />
    : home_team?.short_name?.slice(0, 3);
  const awayLogo = away_team?.logo_url
    ? <img src={away_team.logo_url} alt="" />
    : away_team?.short_name?.slice(0, 3);

  const l1h = leg1_home_goals;
  const l1a = leg1_away_goals;
  const l2h = leg2_home_goals;
  const l2a = leg2_away_goals;
  const aggHome = [l1a, l2h].every(v => v != null) ? l1a + l2h : null;
  const aggAway = [l1h, l2a].every(v => v != null) ? l1h + l2a : null;

  const winnerId = computeAggWinner(l1h, l1a, l2h, l2a, home_team?.id, away_team?.id);
  const WinnerComponent = winnerId ? (
    <div className={`playoff-winner ${winner?.id ? 'winner-animate' : ''}`}>
      <span className="team-logo sm">{winnerId === home_team?.id ? homeLogo : awayLogo}</span>
      <strong>{winnerId === home_team?.id ? home_team?.short_name : away_team?.short_name}</strong>
      <span className="winner-badge">Advances</span>
    </div>
  ) : (
    <div className="playoff-winner pending">Waiting for scores</div>
  );

  return (
    <div className="playoff-tie">
      <div className="playoff-header">
        <span className="playoff-seed">#{matchup_index}</span>
        <span className="playoff-pairing">
          ({home_team?.seeding_position || '?'}) <strong>{home_team?.short_name}</strong>
          <span className="playoff-vs">vs</span>
          <strong>{away_team?.short_name}</strong> ({away_team?.seeding_position || '?'})
        </span>
      </div>

      <div className="playoff-legs">
        <div className="playoff-leg">
          <span className="leg-label">Leg 1 (away)</span>
          <div className="score-group">
            <ScoreInput
              value={leg1_home_goals}
              onChange={(v) => onScoreChange(matchup_index, 'leg1_home_goals', v)}
              animateOnChange
            />
            <span className="score-sep">–</span>
            <ScoreInput
              value={leg1_away_goals}
              onChange={(v) => onScoreChange(matchup_index, 'leg1_away_goals', v)}
              animateOnChange
            />
          </div>
        </div>

        <div className="playoff-leg">
          <span className="leg-label">Leg 2 (home)</span>
          <div className="score-group">
            <ScoreInput
              value={leg2_home_goals}
              onChange={(v) => onScoreChange(matchup_index, 'leg2_home_goals', v)}
              animateOnChange
            />
            <span className="score-sep">–</span>
            <ScoreInput
              value={leg2_away_goals}
              onChange={(v) => onScoreChange(matchup_index, 'leg2_away_goals', v)}
              animateOnChange
            />
          </div>
        </div>
      </div>

      <div className="playoff-aggregate">
        <span className="agg-label">Aggregate: </span>
        <span className="agg-score">
          {aggHome != null ? `${home_team?.short_name} ${aggHome}–${aggAway} ${away_team?.short_name}` : '–'}
        </span>
      </div>

      {WinnerComponent}
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
    <div className="playoff-bracket">
      <h3 className="section-title">Playoff Round</h3>
      <p className="section-desc">
        Positions 9–24 compete in two-legged ties. Higher seed plays leg 2 at home.
      </p>
      <div className="playoff-grid">
        {matchups.map((m) => (
          <PlayoffTie key={m.matchup_index} matchup={m} onScoreChange={onScoreChange} />
        ))}
      </div>
    </div>
  );
}
