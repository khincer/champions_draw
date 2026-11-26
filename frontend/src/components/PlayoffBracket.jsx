import { Home, Plane } from 'lucide-preact';
import Crest from './Crest';
import { StateMessage } from './States';
import ScoreInput from './ScoreInput';
import { computeAgg } from '../lib/tieUtils';
import { useI18n } from '../i18n';

function LegRow({ label, homeTeam, awayTeam, homeGoals, awayGoals, homeField, awayField, matchupIdx, onScoreChange }) {
  return (
    <div className="playoff-leg-row">
      <span className="playoff-leg-label">{label}</span>
      <div className="playoff-side">
        <Home size={12} className="playoff-venue-icon" />
        <Crest team={homeTeam} size="sm" />
        <span className="playoff-name">{homeTeam?.short_name}</span>
        <ScoreInput
          value={homeGoals}
          onChange={(v) => onScoreChange(matchupIdx, homeField, v)}
          label={`${label}, home goals: ${homeTeam?.name} versus ${awayTeam?.name}`}
        />
      </div>
      <span className="score-sep">–</span>
      <div className="playoff-side">
        <Plane size={12} className="playoff-venue-icon" />
        <Crest team={awayTeam} size="sm" />
        <span className="playoff-name">{awayTeam?.short_name}</span>
        <ScoreInput
          value={awayGoals}
          onChange={(v) => onScoreChange(matchupIdx, awayField, v)}
          label={`${label}, away goals: ${awayTeam?.name} versus ${homeTeam?.name}`}
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
        <Crest team={homeTeam} size="sm" />
        <span className="playoff-name">{homeTeam?.short_name}</span>
        <ScoreInput
          value={homeGoals}
          onChange={(v) => onScoreChange(matchupIdx, homeField, v)}
          label={`${label}, home goals: ${homeTeam?.name} versus ${awayTeam?.name}`}
        />
      </div>
      <span className="score-sep">–</span>
      <div className="playoff-side">
        <Crest team={awayTeam} size="sm" />
        <span className="playoff-name">{awayTeam?.short_name}</span>
        <ScoreInput
          value={awayGoals}
          onChange={(v) => onScoreChange(matchupIdx, awayField, v)}
          label={`${label}, away goals: ${awayTeam?.name} versus ${homeTeam?.name}`}
        />
      </div>
    </div>
  );
}

function BracketMatch({ matchup, onScoreChange }) {
  const { t } = useI18n();
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
      tieDesc = t('bracket.pens', { home: pen_home_goals, away: pen_away_goals });
    } else if (extra_time && et_home_goals != null) {
      tieDesc = t('bracket.etAgg', { home: etTotal.home, away: etTotal.away });
    }
  }

  return (
    <div className={`playoff-match${winner ? ' playoff-decided' : ''}`}>
      <div className="playoff-head">
        <span className="playoff-num">#{matchup_index}</span>
        {winner ? (
          <span className="playoff-winner">
            <Crest team={winner} size="sm" />
            <span>{winner.short_name}</span>
            <span className="playoff-won-badge">{t('bracket.win')}</span>
          </span>
        ) : (
          <span className="playoff-winner playoff-pending">{t('bracket.winnerTbd')}</span>
        )}
        {agg != null && <span className="playoff-agg">{t('bracket.agg', { home: agg.home, away: agg.away })}</span>}
        {tieDesc && <span className="playoff-tie-desc">{tieDesc}</span>}
      </div>

      <LegRow
        label={t('bracket.leg1')}
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
        label={t('bracket.leg2')}
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
          label={t('bracket.et')}
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
          label={t('bracket.pensLabel')}
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
  const { t } = useI18n();
  if (!matchups || matchups.length === 0) {
    return (
      <StateMessage
        title={t('bracket.playoffsUnavailable')}
        text={t('bracket.playoffsUnavailableText')}
      />
    );
  }

  return (
    <div className="bracket-wrap">
      <h3 className="section-title">{t('bracket.playoffRound')}</h3>
      <p className="section-desc">
        {t('bracket.playoffRoundText')}
      </p>
      <div className="playoff-list">
        {matchups.map((m) => (
          <BracketMatch key={m.matchup_index} matchup={m} onScoreChange={onScoreChange} />
        ))}
      </div>
    </div>
  );
}
