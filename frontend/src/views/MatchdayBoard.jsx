import BoardFixtureRows from '../components/BoardFixtureRows';

export default function MatchdayBoard({ matchdays }) {
  const orderedMatchdays = Array.from({ length: 8 }, (_, index) => String(index + 1));
  return (
    <section className="board">
      {orderedMatchdays.map((matchday) => {
        const fixtures = matchdays[matchday] || [];
        return (
          <article className="matchday" key={matchday}>
            <div className="matchday-head">
              <strong>Matchday {matchday}</strong>
              <span>{fixtures.length} fixtures</span>
            </div>
            <div className="fixture-list">
              {fixtures.length ? (
                fixtures.slice(0, 9).map((fixture) => <BoardFixtureRows fixture={fixture} key={fixture.id} />)
              ) : (
                <span className="empty-row">Run a simulation to fill this matchday.</span>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
