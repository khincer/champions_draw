import { groupBy } from './main.jsx';
import ScoreInput from './ScoreInput';

export default function MatchdayScoreBoard({
  matchups,
  matchPredictions,
  onScoreChange,
  currentMatchday,
  onMatchdayChange,
  onSave,
  isSaving,
  onRandomize,
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
        <button
          className="button secondary"
          disabled={currentMatchday <= 1}
          onClick={() => onMatchdayChange(currentMatchday - 1)}
        >
          ← Previous
        </button>

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

        <button
          className="button secondary"
          disabled={currentMatchday >= 8}
          onClick={() => onMatchdayChange(currentMatchday + 1)}
        >
          Next →
        </button>
      </div>

      <div className="matchday-card-wrap">
        <article className="matchday-card">
          <div className="matchday-card-head">
            <div>
              <strong>Matchday {md}</strong>
              <span className="muted">{scored}/{totalFixtures} scored</span>
            </div>
            <div className="matchday-head-actions">
              <button className="button secondary" onClick={() => onRandomize(currentMatchday)}>
                Randomize
              </button>
              {isComplete && (
                <button className="button primary" disabled={isSaving} onClick={onSave}>
                  {isSaving ? 'Saving...' : 'Save Matchday'}
                </button>
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
                return (
                  <div className="fixture-row score-row" key={fixture.id}>
                    <div className="team-badge score-team">
                      <span className="team-logo sm">
                        {fixture.home_team.logo_url
                          ? <img src={fixture.home_team.logo_url} alt="" />
                          : fixture.home_team.short_name?.slice(0, 3)}
                      </span>
                      <b>{fixture.home_team.short_name}</b>
                    </div>
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
                    <div className="team-badge right score-team">
                      <b>{fixture.away_team.short_name}</b>
                      <span className="team-logo sm">
                        {fixture.away_team.logo_url
                          ? <img src={fixture.away_team.logo_url} alt="" />
                          : fixture.away_team.short_name?.slice(0, 3)}
                      </span>
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
