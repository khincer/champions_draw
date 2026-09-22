import FixtureRow from './FixtureRow';

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
