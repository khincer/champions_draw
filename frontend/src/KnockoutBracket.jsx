import { useMemo } from 'preact/hooks';
import ScoreInput from './ScoreInput';

const ROUND_LABELS = { R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const ROUND_ORDER = ['R16', 'QF', 'SF', 'F'];

function KnockoutMatch({ match, onScoreChange, disabled }) {
  const homeTeam = match.home_team;
  const awayTeam = match.away_team;

  const showInputs = homeTeam && awayTeam;

  return (
    <div className={`ko-match ${match.winner ? 'ko-decided' : ''}`}>
      <div className="ko-teams">
        <div className={`ko-team ${match.winner?.team_id === homeTeam?.id ? 'ko-advancing' : ''}`}>
          {homeTeam ? (
            <>
              <span className="team-logo xs">
                {homeTeam.logo_url ? <img src={homeTeam.logo_url} alt="" /> : homeTeam.short_name?.slice(0, 3)}
              </span>
              <span className="ko-name">{homeTeam.short_name}</span>
            </>
          ) : (
            <span className="ko-name ko-tbd">TBD</span>
          )}
        </div>
        <span className="ko-vs">vs</span>
        <div className={`ko-team right ${match.winner?.team_id === awayTeam?.id ? 'ko-advancing' : ''}`}>
          {awayTeam ? (
            <>
              <span className="ko-name">{awayTeam.short_name}</span>
              <span className="team-logo xs">
                {awayTeam.logo_url ? <img src={awayTeam.logo_url} alt="" /> : awayTeam.short_name?.slice(0, 3)}
              </span>
            </>
          ) : (
            <span className="ko-name ko-tbd">TBD</span>
          )}
        </div>
      </div>

      {showInputs && (
        <div className="ko-score-row">
          <ScoreInput
            value={match.home_goals}
            onChange={(v) => onScoreChange?.(match.round, match.bracket_position, 'home_goals', v)}
            disabled={disabled}
            animateOnChange
          />
          <span className="score-sep">–</span>
          <ScoreInput
            value={match.away_goals}
            onChange={(v) => onScoreChange?.(match.round, match.bracket_position, 'away_goals', v)}
            disabled={disabled}
            animateOnChange
          />
        </div>
      )}

      {match.winner && (
        <div className="ko-winner-line">
          <span className="ko-adv-arrow">→</span>
          <span className="team-logo xs">
            {match.winner.logo_url ? <img src={match.winner.logo_url} alt="" /> : match.winner.short_name?.slice(0, 3)}
          </span>
          <strong>{match.winner.short_name}</strong>
          <span className="bracket-won-badge" style="background:none;padding:0;margin-left:4px">Advances</span>
        </div>
      )}
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
    <div className="knockout-bracket">
      <h3 className="section-title">Knockout Phase</h3>
      <div className="ko-rounds">
        {ROUND_ORDER.map((roundKey) => {
          const matches = bracket[roundKey] || [];
          const hasTeams = matches.some(m => m.home_team && m.away_team);
          if (!matches.length) return null;
          return (
            <div className="ko-round" key={roundKey}>
              <h4 className="ko-round-title">{ROUND_LABELS[roundKey]}</h4>
              <div className="ko-matches">
                {matches.map((m, i) => (
                  <KnockoutMatch
                    key={`${m.round}-${m.bracket_position}`}
                    match={m}
                    onScoreChange={onScoreChange}
                    disabled={!hasTeams}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
