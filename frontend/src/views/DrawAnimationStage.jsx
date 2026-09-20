import Crest from '../components/Crest';
import BoardFixtureRows from '../components/BoardFixtureRows';
import { groupBy } from '../lib/groupBy';

export default function DrawAnimationStage({ phase, pots, matchups, revealedCount }) {
  const revealedMatchups = matchups.slice(0, revealedCount);
  const revealedByMatchday = groupBy(revealedMatchups, 'matchday');

  return (
    <section className="draw-animation-stage">
      <div className="draw-animation-head">
        <div>
          <h2>{phase === 'pots' ? 'Loading the four pots' : 'Building the league-phase fixtures'}</h2>
          <p>{phase === 'pots' ? 'The draw starts from the seeded pots.' : `${revealedMatchups.length} of ${matchups.length} fixtures placed.`}</p>
        </div>
        <span className="draw-pulse" />
      </div>

      <div className="animated-pot-grid">
        {['1', '2', '3', '4'].map((pot, index) => (
          <article className="animated-pot" style={{ '--delay': `${index * 90}ms` }} key={pot}>
            <div className="pot-head">
              <strong>Pot {pot}</strong>
              <span>{pots[pot]?.length || 0} teams</span>
            </div>
            <div className="animated-team-list">
              {(pots[pot] || []).map((team) => (
                <span className="animated-team" key={team.id}>
                  <Crest team={team} size="sm" />
                  <strong>{team.short_name}</strong>
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>

      {phase === 'fixtures' && (
        <div className="animated-fixtures">
          {Array.from({ length: 8 }, (_, index) => String(index + 1)).map((matchday) => {
            const fixtures = revealedByMatchday[matchday] || [];
            return (
              <article className="animated-matchday" key={matchday}>
                <div className="matchday-head">
                  <strong>Matchday {matchday}</strong>
                  <span>{fixtures.length} fixtures</span>
                </div>
                <div className="fixture-list">
                  {fixtures.slice(0, 5).map((fixture) => (
                    <BoardFixtureRows fixture={fixture} key={fixture.id} />
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
