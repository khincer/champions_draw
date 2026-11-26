import FixtureRow from './FixtureRow';
import Button from './Button';
import ScoreInput from './ScoreInput';
import { groupBy } from '../lib/groupBy';
import { predictMatch } from '../lib/matchOdds';
import { useI18n } from '../i18n';

export default function MatchdayScoreBoard({
  matchups,
  matchPredictions,
  onScoreChange,
  currentMatchday,
  onMatchdayChange,
  onSave,
  isSaving,
  onRandomize,
  onPredict,
}) {
  const { t } = useI18n();
  const byMatchday = groupBy(matchups || [], 'matchday');
  const md = String(currentMatchday);
  const fixtures = byMatchday[md] || [];
  const totalFixtures = fixtures.length;

  const scored = fixtures.filter(
    (f) => {
      const p = matchPredictions[f.id];
      return p && p.home_goals != null && p.away_goals != null;
    },
  ).length;

  const isComplete = totalFixtures > 0 && scored === totalFixtures;

  return (
    <div className="single-matchday-view">
      <div className="matchday-nav">
        <Button
          disabled={currentMatchday <= 1}
          onClick={() => onMatchdayChange(currentMatchday - 1)}
        >
          {t('predict.previous')}
        </Button>

        <div className="matchday-dots">
          {Array.from({ length: 8 }, (_, i) => {
            const day = i + 1;
            const dayFixtures = byMatchday[String(day)] || [];
            const dayScored = dayFixtures.filter(
              (f) => {
                const p = matchPredictions[f.id];
                return p && p.home_goals != null && p.away_goals != null;
              },
            ).length;
            const isDayComplete = dayFixtures.length > 0 && dayScored === dayFixtures.length;
            return (
              <button
                key={day}
                className={`md-dot ${currentMatchday === day ? 'md-active' : ''} ${isDayComplete ? 'md-done' : ''}`}
                onClick={() => onMatchdayChange(day)}
                title={t('predict.matchdayTitle', { day, scored: dayScored, total: dayFixtures.length })}
                aria-label={t('predict.matchdayAria', { day, scored: dayScored, total: dayFixtures.length })}
              >
                {day}
              </button>
            );
          })}
        </div>

        <Button
          disabled={currentMatchday >= 8}
          onClick={() => onMatchdayChange(currentMatchday + 1)}
        >
          {t('predict.next')}
        </Button>
      </div>

      <div className="matchday-card-wrap">
        <article className="matchday-card">
          <div className="matchday-card-head">
            <div>
              <strong>{t('predict.matchday', { md })}</strong>
              <span className="muted">{t('predict.scoredCount', { n: scored, m: totalFixtures })}</span>
            </div>
            <div className="matchday-head-actions">
              <Button onClick={() => onPredict(currentMatchday)}>
                {t('predict.predict')}
              </Button>
              <Button onClick={() => onRandomize(currentMatchday)}>
                {t('predict.randomize')}
              </Button>
              {isComplete && (
                <Button variant="primary" disabled={isSaving} onClick={onSave}>
                  {isSaving ? t('predict.saving') : t('predict.saveMatchday')}
                </Button>
              )}
            </div>
          </div>

          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${totalFixtures ? (scored / totalFixtures) * 100 : 0}%` }} />
          </div>

          <div className="fixture-list">
            {fixtures.length ? (
              fixtures.map((fixture) => {
                const pred = matchPredictions[fixture.id] || {};
                const odds = predictMatch(fixture.home_team, fixture.away_team);
                return (
                  <div className="fixture-wrap" key={fixture.id}>
                    <FixtureRow
                      className="score-row"
                      home={fixture.home_team}
                      away={fixture.away_team}
                      nameMode="short"
                      center={
                        <div className="score-group">
                          <ScoreInput
                            value={pred.home_goals}
                            onChange={(v) => onScoreChange(fixture.id, 'home_goals', v, fixture)}
                            animateOnChange
                            label={`Home goals, ${fixture.home_team.name} versus ${fixture.away_team.name}, Matchday ${md}`}
                          />
                          <span className="score-sep">–</span>
                          <ScoreInput
                            value={pred.away_goals}
                            onChange={(v) => onScoreChange(fixture.id, 'away_goals', v, fixture)}
                            animateOnChange
                            label={`Away goals, ${fixture.home_team.name} versus ${fixture.away_team.name}, Matchday ${md}`}
                          />
                        </div>
                      }
                    />
                    <div className="match-odds">
                      <span><b>1</b> {Math.round(odds.pHome * 100)}%</span>
                      <span><b>X</b> {Math.round(odds.pDraw * 100)}%</span>
                      <span><b>2</b> {Math.round(odds.pAway * 100)}%</span>
                      <span className="muted">{t('predict.predicted')} {odds.modal_score[0]}–{odds.modal_score[1]}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <span className="empty-row">{t('predict.noFixtures')}</span>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
