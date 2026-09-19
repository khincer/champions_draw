import { render } from 'preact';
import { useState } from 'preact/hooks';
import { Activity, AlertCircle, Trophy } from 'lucide-preact';
import '../src/styles.css';
import Crest, { TeamBadge } from '../src/components/Crest';
import Button from '../src/components/Button';
import Badge from '../src/components/Badge';
import Metric from '../src/components/Metric';
import SegmentControl from '../src/components/SegmentControl';
import StandingsTable from '../src/components/StandingsTable';
import FixtureRow from '../src/components/FixtureRow';
import { StateMessage, Skeleton, EmptyState, ErrorState, LiveRegion } from '../src/components/States';
import { flatRows, leagueRows, fixtureTeams, standingsOnly } from './fixtures';
import {
  LegacyLeagueTable,
  LegacyRealLeagueTable,
  LegacyTeamPageTable,
  LegacyGroupTable,
  LegacyLeaguePageTable,
  LegacySidebarTable,
  LegacyLeagueFixtureRow,
  LegacyScoreRow,
} from './legacy';

const norm = (name) => (name || '').trim().toLowerCase();
const groupRows = flatRows.map((row, index) => ({ ...row, group: index < 18 ? 'A' : 'B' }));
const apiRows = flatRows.map((row) => ({
  position: row.position,
  team_name: row.name,
  team_crest: row.logo_url,
  played: row.played,
  won: row.wins,
  draw: row.draws,
  lost: row.losses,
  goals_for: row.goals_for,
  goals_against: row.goals_against,
  goal_difference: row.goal_diff,
  points: row.points,
}));

const Section = ({ id, title, children }) => (
  <section data-harness={id}>
    <h2>{title}</h2>
    {children}
  </section>
);

function SegmentProbe() {
  const [value, setValue] = useState('one');
  return (
    <SegmentControl
      label="Probe sections"
      value={value}
      onChange={setValue}
      items={[
        { key: 'one', label: 'One' },
        { key: 'two', label: 'Two' },
        { key: 'three', label: 'Three' },
      ]}
    />
  );
}

/* Two independent retryable failures: clicking one retry must move only its own
   request counter. `failed` stands for the fixtures request, `other` for a
   different in-flight request that must not be re-issued. */
function RetryProbe() {
  const [counts, setCounts] = useState({ failed: 0, other: 0 });
  return (
    <div id="states-retry">
      <div id="states-retry-a">
        <ErrorState
          title="Fixtures could not load"
          detail="The fixtures request returned 500."
          onRetry={() => setCounts((c) => ({ ...c, failed: c.failed + 1 }))}
        />
      </div>
      <div id="states-retry-b">
        <ErrorState
          title="Standings could not load"
          detail="A different request failed."
          onRetry={() => setCounts((c) => ({ ...c, other: c.other + 1 }))}
        />
      </div>
      <output id="states-retry-counts">{counts.failed}:{counts.other}</output>
    </div>
  );
}

/* Two successive poll ticks write new text into the same region. If the region
   were remounted per tick the tagged DOM node would be replaced. */
function LivePollProbe() {
  const [tick, setTick] = useState(0);
  const MESSAGES = ['Standings updated', 'Standings updated · 2 changes', 'Live scores unavailable'];
  return (
    <div id="states-live-poll">
      <LiveRegion message={MESSAGES[tick]} tone={tick === 2 ? 'error' : 'info'} />
      <button id="states-poll-tick" onClick={() => setTick((t) => Math.min(t + 1, 2))}>
        poll tick {tick}
      </button>
      <output id="states-poll-tick-out">{tick}</output>
    </div>
  );
}

/* Loading → settled: the same fixed-width slot renders the skeleton first and
   the real rows after the toggle, so the block size can be compared. One probe
   per surface the skeleton stands in for (`US:loading-preserves-layout`). */
function LayoutProbe({ id, variant, settled, width = 640 }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div id={id} style={`width: ${width}px`}>
      <div id={`${id}-box`}>
        {loaded ? settled() : <Skeleton rows={3} variant={variant} />}
      </div>
      <button id={`${id}-toggle`} onClick={() => setLoaded((v) => !v)}>
        {loaded ? 'show skeleton' : 'show rows'}
      </button>
    </div>
  );
}

const probeFixtures = [
  <FixtureRow key="a" className="score-row" status="Final" statusTitle="12:00" home={fixtureTeams.home} away={fixtureTeams.away} nameMode="full" center={<div className="score-group real-result"><span className="real-score">2–1</span><span className="fx-verdict exact">Exact</span></div>} />,
  <FixtureRow key="b" className="score-row" status="LIVE 2H" statusTone="live" statusTitle="12:00" home={fixtureTeams.away} away={fixtureTeams.home} nameMode="full" center={<div className="score-group real-result"><span className="real-score">1–1</span><span className="fx-verdict live">Live</span></div>} />,
  <FixtureRow key="c" className="score-row" home={fixtureTeams.shortOnly} away={fixtureTeams.crestless} nameMode="full" center={<span className="versus">vs</span>} />,
];

function App() {
  return (
    <main>
      <Section id="league" title="League dialect (LeagueTable / RealDrawView)">
        <div id="league-new">
          <StandingsTable rows={leagueRows} variant="league" nameMode="short" playedHeader="Pld" legend="league" scrollClassName="league-table-scroll" />
        </div>
        <div id="league-legacy"><LegacyLeagueTable rows={leagueRows} /></div>
        <div id="real-new">
          <StandingsTable rows={leagueRows} variant="league" nameMode="full" playedHeader="P" className="real-league-table" />
        </div>
        <div id="real-legacy"><LegacyRealLeagueTable rows={leagueRows} /></div>
      </Section>

      <Section id="standings" title="Standings dialect (TeamPage / group tables / league page)">
        <div id="teampage-new">
          <StandingsTable rows={flatRows} variant="standings" nameMode="full" highlight={(row) => norm(row.name) === norm('Napoli')} />
        </div>
        <div id="teampage-legacy">
          <LegacyTeamPageTable rows={flatRows} norm={norm} highlightName="Napoli" />
        </div>
        <div id="group-new">
          <StandingsTable rows={groupRows.filter((r) => r.group === 'A')} variant="standings" nameMode="full" onTeamClick={() => {}} />
        </div>
        <div id="group-legacy">
          <LegacyGroupTable rows={groupRows} group="A" onOpenTeam={() => {}} />
        </div>
        <div id="leaguepage-new">
          <StandingsTable rows={apiRows} variant="standings" nameMode="full" onTeamClick={() => {}} />
        </div>
        <div id="leaguepage-legacy"><LegacyLeaguePageTable rows={apiRows} onOpenTeam={() => {}} /></div>
      </Section>

      <Section id="sidebar" title="Sidebar dialect (prediction sidebar)">
        <div id="sidebar-new">
          <StandingsTable rows={leagueRows} variant="sidebar" nameMode="short" legend="sidebar" scrollClassName="sidebar-standings-scroll" />
        </div>
        <div id="sidebar-legacy"><LegacySidebarTable rows={leagueRows} /></div>
      </Section>

      <Section id="fixtures" title="Fixture rows">
        <div id="fx-final">
          <FixtureRow className="score-row" status="Final" statusTitle="12:00" home={fixtureTeams.home} away={fixtureTeams.away} nameMode="full" center={<div className="score-group real-result"><span className="real-score">2–1</span><span className="fx-verdict exact">Exact</span></div>} />
        </div>
        <div id="fx-live">
          <FixtureRow className="score-row" status="LIVE 2H" statusTone="live" statusTitle="12:00" home={fixtureTeams.away} away={fixtureTeams.home} nameMode="full" center={<div className="score-group real-result"><span className="real-score">1–1</span><span className="fx-verdict live">Live</span></div>} />
        </div>
        <div id="fx-scheduled">
          <FixtureRow className="score-row" status="Awaiting result" statusTone="waiting" statusTitle="12:00" home={fixtureTeams.crestless} away={fixtureTeams.shortOnly} nameMode="full" center={<div className="score-group"><span className="score-sep">–</span></div>} />
        </div>
        <div id="fx-plain">
          <FixtureRow className="score-row" home={fixtureTeams.shortOnly} away={fixtureTeams.crestless} nameMode="full" center={<span className="versus">vs</span>} />
        </div>
        <div id="fx-legacy-final">
          <LegacyScoreRow status="Final" statusTitle="12:00" home={fixtureTeams.home} away={fixtureTeams.away} center={<div className="score-group real-result"><span className="real-score">2–1</span><span className="fx-verdict exact">Exact</span></div>} />
        </div>
        <div id="fx-legacy-live">
          <LegacyScoreRow status="LIVE 2H" statusTone="live" statusTitle="12:00" home={fixtureTeams.away} away={fixtureTeams.home} center={<div className="score-group real-result"><span className="real-score">1–1</span><span className="fx-verdict live">Live</span></div>} />
        </div>
        <div id="fx-legacy-scheduled">
          <LegacyScoreRow status="Awaiting result" statusTone="waiting" statusTitle="12:00" home={fixtureTeams.crestless} away={fixtureTeams.shortOnly} center={<div className="score-group"><span className="score-sep">–</span></div>} />
        </div>
        <div id="fx-mini-new">
          <FixtureRow layout="mini" date="Sat, Sep 20" time="FT" scoreText="3–0" home={{ name: 'Real Madrid', short_name: 'Real Madrid', logo_url: '' }} away={{ name: 'Bayern Munich', short_name: 'Bayern Munich', logo_url: 'https://example.invalid/x.png' }} nameMode="full" />
        </div>
        <div id="fx-mini-legacy">
          <LegacyLeagueFixtureRow m={{ status: 'FINISHED', result: { home_goals: 3, away_goals: 0 }, dateLabel: 'Sat, Sep 20', timeLabel: '15:00', home_name: 'Real Madrid', home_crest: '', away_name: 'Bayern Munich', away_crest: 'https://example.invalid/x.png' }} />
        </div>
        <div id="fx-team-new">
          <FixtureRow layout="team" badge leading={<span className="matchday-chip">MD3</span>} home={fixtureTeams.home} away={fixtureTeams.away} center={<span className="versus">vs</span>} trailing={<><span className="team-fixture-score">2–1</span><span className="venue-chip home">H</span></>} />
        </div>
        <div id="fx-badge-new">
          <FixtureRow badge home={fixtureTeams.home} away={fixtureTeams.away} center={<span className="versus">vs</span>} />
        </div>
        <div id="fx-empty">
          <div className="fixture-list"><span className="empty-row">No fixtures this matchday.</span></div>
        </div>
      </Section>

      <Section id="primitives" title="Button / Badge / Metric / SegmentControl">
        <div id="buttons">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" disabled>Disabled primary</Button>
          <Button variant="secondary" disabled>Saving...</Button>
        </div>
        <div id="badges">
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="green">Valid</Badge>
          <Badge tone="warning">Processing</Badge>
          <Badge tone="red">Invalid</Badge>
          <Badge tone="gold">Title Holder</Badge>
          <Badge tone="blue">league position</Badge>
          <Badge tone="neutral" icon={Trophy}>Finished</Badge>
        </div>
        <div id="metrics">
          <Metric label="Matches played" value="144" support="All six competition days" icon={Activity} />
          <Metric label="Prediction accuracy" value="62%" trend={{ tone: 'green', label: '+4 pts', icon: Activity }} />
        </div>
        <div id="segments"><SegmentProbe /></div>
        <div id="crests">
          <Crest team={fixtureTeams.home} size="xs" />
          <Crest team={fixtureTeams.crestless} size="xs" />
          <Crest team={fixtureTeams.shortOnly} size="sm" />
          <Crest team={{ name: 'No Short Name' }} size="md" />
          <TeamBadge team={fixtureTeams.home} />
          <TeamBadge team={fixtureTeams.away} align="right" />
        </div>
      </Section>

      <Section id="states" title="States">
        <div id="states-loading"><Skeleton rows={3} label="Loading fixtures" /></div>
        <div id="states-empty"><EmptyState title="No leagues imported" text="Import a league to see standings." action={<Button>Import league</Button>} /></div>
        <div id="states-error"><ErrorState title="Fixtures could not load" detail="The fixtures request returned 500." reference="Retry re-issues only this request." onRetry={() => {}} /></div>
        <div id="states-live"><LiveRegion message="Standings updated" /></div>
        <div id="states-live-error"><LiveRegion message="Live scores unavailable" tone="error" /></div>
        <div id="states-message"><StateMessage icon={AlertCircle} title="No matches today" text="Today and yesterday games appear here." /></div>
        <div id="states-standings-only"><StandingsTable rows={[standingsOnly]} variant="standings" nameMode="full" /></div>
        <div id="states-retry-probe"><RetryProbe /></div>
        <div id="states-poll-probe"><LivePollProbe /></div>
        <div id="states-layout-probe">
          <LayoutProbe
            id="states-layout"
            variant="table"
            settled={() => <StandingsTable rows={leagueRows.slice(0, 3)} variant="standings" nameMode="full" />}
          />
          <LayoutProbe
            id="states-layout-fixture"
            variant="fixture"
            width={900}
            settled={() => <div className="fixture-list">{probeFixtures}</div>}
          />
          <LayoutProbe
            id="states-layout-real-league"
            variant="real-league"
            settled={() => <StandingsTable rows={leagueRows.slice(0, 3)} variant="league" nameMode="full" className="real-league-table" />}
          />
        </div>
      </Section>
    </main>
  );
}

render(<App />, document.getElementById('app'));
