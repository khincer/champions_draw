import { Home, Plane } from 'lucide-preact';
import ScoreInput from './ScoreInput';

function computeAgg(l1h, l1a, l2h, l2a) {
  if ([l1h, l1a, l2h, l2a].some(v => v == null)) return null;
  return { home: l1h + l2h, away: l1a + l2a };
}

function LegRow({ label, homeTeam, awayTeam, homeGoals, awayGoals, homeField, awayField, matchupIdx, onScoreChange }) {
  return (
    <div className="playoff-leg-row">
      <span className="playoff-leg-label">{label}</span>
      <div className="playoff-side">
        <Home size={12} className="playoff-venue-icon" />
        <span className="team-logo sm">
          {homeTeam?.logo_url
            ? <img src={homeTeam.logo_url} alt="" />
            : homeTeam?.short_name?.slice(0, 3)}
        </span>
        <span className="playoff-name">{homeTeam?.short_name}</span>
        <ScoreInput
          value={homeGoals}
          onChange={(v) => onScoreChange(matchupIdx, homeField, v)}
        />
      </div>
      <span className="score-sep">–</span>
      <div className="playoff-side">
        <Plane size={12} className="playoff-venue-icon" />
        <span className="team-logo sm">
          {awayTeam?.logo_url
            ? <img src={awayTeam.logo_url} alt="" />
            : awayTeam?.short_name?.slice(0, 3)}
        </span>
        <span className="playoff-name">{awayTeam?.short_name}</span>
        <ScoreInput
          value={awayGoals}
          onChange={(v) => onScoreChange(matchupIdx, awayField, v)}
        />
      </div>
    </div>
  );
}

function TiebreakerRow({ label, homeTeam, awayTeam, homeGoals, awayGoals, homeField, awayField, matchupIdx, onScoreChange }) {
  return (
    <div className="playoff-leg-row playoff-tiebreaker">
      <span className="playoff-leg-label">{label}</span>
      <div className="playoff-side">
        <span className="team-logo sm">
          {homeTeam?.logo_url
            ? <img src={homeTeam.logo_url} alt="" />
            : homeTeam?.short_name?.slice(0, 3)}
        </span>
        <span className="playoff-name">{homeTeam?.short_name}</span>
        <ScoreInput
          value={homeGoals}
          onChange={(v) => onScoreChange(matchupIdx, homeField, v)}
        />
      </div>
      <span className="score-sep">–</span>
      <div className="playoff-side">
        <span className="team-logo sm">
          {awayTeam?.logo_url
            ? <img src={awayTeam.logo_url} alt="" />
            : awayTeam?.short_name?.slice(0, 3)}
        </span>
        <span className="playoff-name">{awayTeam?.short_name}</span>
        <ScoreInput
          value={awayGoals}
          onChange={(v) => onScoreChange(matchupIdx, awayField, v)}
        />
      </div>
    </div>
  );
}

function BracketMatch({ matchup, onScoreChange }) {
  const {
    matchup_index, home_team, away_team,
    leg1_home_goals, leg1_away_goals,
    leg2_home_goals, leg2_away_goals,
    extra_time, penalties,
    et_home_goals, et_away_goals,
    pen_home_goals, pen_away_goals,
    winner,
  } = matchup;

  const agg = computeAgg(leg1_home_goals, leg1_away_goals, leg2_home_goals, leg2_away_goals);
  const aggTied = agg && agg.home === agg.away;

  // After ET, re-check: agg + ET goals
  let etTotal = null;
  let etTied = false;
  if (aggTied && et_home_goals != null && et_away_goals != null) {
    const eth = agg.home + et_home_goals;
    const eta = agg.away + et_away_goals;
    etTotal = { home: eth, away: eta };
    etTied = eth === eta;
  }

  // Tiebreaker description
  let tieDesc = null;
  if (winner && aggTied) {
    if (penalties && pen_home_goals != null) {
      tieDesc = `Pens ${pen_home_goals}–${pen_away_goals}`;
    } else if (extra_time && et_home_goals != null) {
      tieDesc = `ET agg ${etTotal.home}–${etTotal.away}`;
    }
  }

  return (
    <div className={`playoff-match${winner ? ' playoff-decided' : ''}`}>
      <div className="playoff-head">
        <span className="playoff-num">#{matchup_index}</span>
        {winner ? (
          <span className="playoff-winner">
            <span className="team-logo sm">
              {winner.logo_url
                ? <img src={winner.logo_url} alt="" />
                : winner.short_name?.slice(0, 3)}
            </span>
            <span>{winner.short_name}</span>
            <span className="playoff-won-badge">W</span>
          </span>
        ) : (
          <span className="playoff-winner playoff-pending">Winner TBD</span>
        )}
        {agg != null && <span className="playoff-agg">Agg {agg.home}–{agg.away}</span>}
        {tieDesc && <span className="playoff-tie-desc">{tieDesc}</span>}
      </div>

      <LegRow
        label="Leg 1"
        homeTeam={away_team}
        awayTeam={home_team}
        homeGoals={leg1_away_goals}
        awayGoals={leg1_home_goals}
        homeField="leg1_away_goals"
        awayField="leg1_home_goals"
        matchupIdx={matchup_index}
        onScoreChange={onScoreChange}
      />
      <LegRow
        label="Leg 2"
        homeTeam={home_team}
        awayTeam={away_team}
        homeGoals={leg2_home_goals}
        awayGoals={leg2_away_goals}
        homeField="leg2_home_goals"
        awayField="leg2_away_goals"
        matchupIdx={matchup_index}
        onScoreChange={onScoreChange}
      />

      {/* Extra time row — shown when aggregate tied after both legs */}
      {aggTied && (
        <TiebreakerRow
          label="ET"
          homeTeam={home_team}
          awayTeam={away_team}
          homeGoals={et_home_goals}
          awayGoals={et_away_goals}
          homeField="et_home_goals"
          awayField="et_away_goals"
          matchupIdx={matchup_index}
          onScoreChange={onScoreChange}
        />
      )}

      {/* Penalties row — shown when ET is played and still tied */}
      {etTied && (
        <TiebreakerRow
          label="Pens"
          homeTeam={home_team}
          awayTeam={away_team}
          homeGoals={pen_home_goals}
          awayGoals={pen_away_goals}
          homeField="pen_home_goals"
          awayField="pen_away_goals"
          matchupIdx={matchup_index}
          onScoreChange={onScoreChange}
        />
      )}
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
        If the aggregate is tied, extra time is played in leg 2; if still tied, penalties.
      </p>
      <div className="playoff-list">
        {matchups.map((m) => (
          <BracketMatch key={m.matchup_index} matchup={m} onScoreChange={onScoreChange} />
        ))}
      </div>
    </div>
  );
}
