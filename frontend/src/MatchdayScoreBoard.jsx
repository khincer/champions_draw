import FixtureRow from './components/FixtureRow';
import Button from './components/Button';
import ScoreInput from './ScoreInput';
import { groupBy } from './lib/groupBy';
import { predictMatch } from './matchOdds';

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
          ← Previous
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
                title={`Matchday ${day} (${dayScored}/${dayFixtures.length})`}
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
          Next →
        </Button>
      </div>

      <div className="matchday-card-wrap">
        <article className="matchday-card">
          <div className="matchday-card-head">
            <div>
              <strong>Matchday {md}</strong>
              <span className="muted">{scored}/{totalFixtures} scored</span>
            </div>
            <div className="matchday-head-actions">
              <Button onClick={() => onPredict(currentMatchday)}>
                Predict
              </Button>
              <Button onClick={() => onRandomize(currentMatchday)}>
                Randomize
              </Button>
              {isComplete && (
                <Button variant="primary" disabled={isSaving} onClick={onSave}>
                  {isSaving ? 'Saving...' : 'Save Matchday'}
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
                          />
                          <span className="score-sep">–</span>
                          <ScoreInput
                            value={pred.away_goals}
                            onChange={(v) => onScoreChange(fixture.id, 'away_goals', v, fixture)}
                            animateOnChange
                          />
                        </div>
                      }
                    />
                    <div className="match-odds">
                      <span><b>1</b> {Math.round(odds.pHome * 100)}%</span>
                      <span><b>X</b> {Math.round(odds.pDraw * 100)}%</span>
                      <span><b>2</b> {Math.round(odds.pAway * 100)}%</span>
                      <span className="muted">pred. {odds.modal_score[0]}–{odds.modal_score[1]}</span>
                    </div>
                  </div>
                );
              })
            ) : (
              <span className="empty-row">No fixtures yet. Run a simulation first.</span>
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
