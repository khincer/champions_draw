import FixtureRow from './FixtureRow';

/* Draw-board fixture line: crest + short name + association code on each side. */
export default function BoardFixtureRows({ fixture }) {
  return (
    <FixtureRow
      badge
      home={fixture.home_team}
      away={fixture.away_team}
      center={<span className="versus">vs</span>}
    />
  );
}
