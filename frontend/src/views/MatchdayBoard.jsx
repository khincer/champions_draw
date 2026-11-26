import BoardFixtureRows from '../components/BoardFixtureRows';
import { useI18n } from '../i18n';

export default function MatchdayBoard({ matchdays }) {
  const { t } = useI18n();
  const orderedMatchdays = Array.from({ length: 8 }, (_, index) => String(index + 1));
  return (
    <section className="board">
      {orderedMatchdays.map((matchday) => {
        const fixtures = matchdays[matchday] || [];
        return (
          <article className="matchday" key={matchday}>
            <div className="matchday-head">
              <strong>{t('draw.matchday', { number: matchday })}</strong>
              <span>{t('draw.fixtureCount', { count: fixtures.length })}</span>
            </div>
            <div className="fixture-list">
              {fixtures.length ? (
                fixtures.slice(0, 9).map((fixture) => <BoardFixtureRows fixture={fixture} key={fixture.id} />)
              ) : (
                <span className="empty-row">{t('draw.fillMatchday')}</span>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
