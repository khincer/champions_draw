import { useMemo, useState } from 'preact/hooks';
import { CalendarDays, History, LayoutGrid, Swords, Trophy, UserRound } from 'lucide-preact';
import Crest from '../components/Crest';
import Button from '../components/Button';
import SegmentControl from '../components/SegmentControl';
import { EmptyState, ErrorState, LiveRegion, Skeleton } from '../components/States';
import { getPlayerName } from '../predictionStorage';
import { inHomeRange, shortDay, shortTime } from '../lib/format';

/* Home composition (Design.md §7.2, task 3.3): greeting + live hub + quick
   actions. No charts and no recent-draw section — the maintainer confirmed that
   scope. The hub content (today/yesterday plus the latest-results strip) was
   moved out of `main.jsx` verbatim; `HomeMatchCard` stays local because nothing
   else renders it.

   The competition filter narrows the feed `App` already fetches; no endpoint or
   payload changed. The shortcuts mirror `SiteNav`; `App` owns the view state and
   passes its switch down as `onNavigate`, so this view never holds navigation
   state of its own. */

const QUICK_ACTIONS = [
  { key: 'real', label: 'Real draw', icon: Swords },
  { key: 'workspace', label: 'Draw simulator', icon: Trophy },
  { key: 'career', label: 'Career mode', icon: UserRound },
  { key: 'teams', label: 'Leagues', icon: LayoutGrid },
];

/* The card itself is not a control: its opener is the real button inside the
   footer, so the card carries no `tabIndex`. The opener names the fixture it
   opens instead of a bare "View match details". */
function HomeMatchCard({ match, liveScore, onOpenMatch, seasonId, detailReturnFocusRef }) {
  const result = match.result;
  const eligible = result || (match.kickoff && new Date(match.kickoff) <= new Date());
  const status = result ? 'finished' : match.closed ? 'live' : 'upcoming';
  const statusLabel = result ? 'Final' : match.closed ? 'Live' : 'Kickoff';
  return (
    <article
      className="home-game-card"
      aria-label={`${match.home_team.name} versus ${match.away_team.name}`}
    >
      <header className="home-game-card-header">
        <div>
          <p className="hub-eyebrow">{match.competition || 'Champions League'}</p>
          <p className="hub-date">{shortDay(match.kickoff)}</p>
        </div>
        <span className={`hub-status ${status === 'finished' ? 'hub-final' : status === 'live' ? 'hub-live' : 'hub-upcoming'}`}>
          {status === 'live' && <span className="live-dot" aria-hidden="true" />}
          {statusLabel}
        </span>
      </header>
      <div className="hub-matchup">
        <div className="hub-team">
          <Crest team={match.home_team} size="md" />
          <p className="hub-team-name">{match.home_team.name}</p>
          {match.home_team.short_name && <p className="hub-team-short">{match.home_team.short_name}</p>}
        </div>
        <div className="hub-score-area">
          {result ? (
            <p className="hub-score">
              <span>{result.home_goals}</span>
              <b>:</b>
              <span>{result.away_goals}</span>
            </p>
          ) : liveScore ? (
            <p className="hub-score hub-score-live">
              <span>{liveScore.home_goals}</span>
              <b>:</b>
              <span>{liveScore.away_goals}</span>
            </p>
          ) : (
            <p className="hub-kickoff">{shortTime(match.kickoff)}</p>
          )}
          <p className="hub-score-caption">{status === 'finished' ? 'Result' : status === 'live' ? 'Live' : 'Kickoff'}</p>
        </div>
        <div className="hub-team">
          <Crest team={match.away_team} size="md" />
          <p className="hub-team-name">{match.away_team.name}</p>
          {match.away_team.short_name && <p className="hub-team-short">{match.away_team.short_name}</p>}
        </div>
      </div>
      <footer className="home-game-card-footer">
        <span>Matchday {match.matchday}</span>
        {match.openable && eligible ? (
          <button
            className="hub-open-match"
            type="button"
            aria-label={`View match details: ${match.home_team.name} versus ${match.away_team.name}`}
            ref={detailReturnFocusRef}
            onClick={() => onOpenMatch(match.id, match.season_id || seasonId)}
          >
            <span aria-hidden="true">↗</span>
          </button>
        ) : (
          <span aria-hidden="true">↗</span>
        )}
      </footer>
    </article>
  );
}

export default function Homepage({ matches, matchesStatus, matchesError, onRetryMatches, liveScores, liveScoresError, onOpenMatch, onNavigate, playerName, seasonId, detailReturnFocusRef }) {
  const [competition, setCompetition] = useState('all');

  /* One pill per competition in the feed, remembering the first emblem a row
     carries so a mix of null and set emblems still yields an icon. */
  const competitions = useMemo(() => {
    const byName = new Map();
    for (const match of matches) {
      const name = match.competition || 'Champions League';
      if (!byName.has(name)) byName.set(name, match.competition_emblem || null);
      else if (!byName.get(name) && match.competition_emblem) byName.set(name, match.competition_emblem);
    }
    return [...byName.entries()];
  }, [matches]);

  const visibleMatches = useMemo(
    () =>
      competition === 'all'
        ? matches
        : matches.filter((match) => (match.competition || 'Champions League') === competition),
    [matches, competition],
  );

  const filterItems = useMemo(
    () => [
      { key: 'all', label: 'All' },
      ...competitions.map(([name, emblem]) => ({
        key: name,
        label: (
          <span className="homepage-filter-label">
            {emblem ? <img className="homepage-filter-emblem" src={emblem} alt="" /> : null}
            {name}
          </span>
        ),
      })),
    ],
    [competitions],
  );

  const inRange = useMemo(
    () => visibleMatches.filter(inHomeRange).sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')),
    [visibleMatches],
  );

  const groups = useMemo(() => {
    const today = new Date().toDateString();
    return inRange.reduce(
      (acc, m) => {
        const key = new Date(m.kickoff).toDateString() === today ? 'Today' : 'Yesterday';
        acc[key].push(m);
        return acc;
      },
      { Today: [], Yesterday: [] },
    );
  }, [inRange]);

  const latestResults = useMemo(
    () =>
      visibleMatches
        .filter((m) => m.result)
        .sort((a, b) => (b.kickoff || '').localeCompare(a.kickoff || ''))
        // ponytail: hardcoded cap of 6 cards; raise when the homepage routinely shows more fresh results
        .slice(0, 6),
    [visibleMatches],
  );

  const name = (playerName || getPlayerName() || '').trim();

  return (
    <div className="homepage">
      <header className="home-intro">
        <p className="home-greeting">{name ? `Welcome back, ${name}` : 'Welcome'}</p>
        <p className="home-intro-sub">Today's results, live scores and shortcuts in one place.</p>
      </header>

      {/* The hub's live region (task 4.2). Mounted once for the life of the view:
          a poll tick rewrites its text and nothing else, so there is no
          per-tick announcement and no node churn. The slot reserves a line so a
          failure appearing or clearing never shifts the page under a scrolled
          reader, and a failure lands here instead of the page error bar. */}
      <div className="home-live-slot">
        <LiveRegion message={liveScoresError} tone={liveScoresError ? 'error' : 'info'} />
      </div>

      {/* A refresh failure is not the live poll (task 4.1): the cards already on
          screen stay, and this names what failed with a retry that re-issues
          only the matches feed. The page never enters its page-error state. */}
      {matchesStatus === 'success' && matchesError ? (
        <ErrorState
          title="Matches could not refresh"
          detail={matchesError}
          onRetry={onRetryMatches}
          retryLabel="Retry refresh"
        />
      ) : null}

      <section className="home-quick-actions" aria-label="Quick actions">
        {QUICK_ACTIONS.map(({ key, label, icon: Icon }) => (
          <Button key={key} variant="secondary" onClick={() => onNavigate(key)}>
            <Icon size={16} aria-hidden="true" />
            {label}
          </Button>
        ))}
      </section>

      <div className="homepage-matches">
        {/* Competition filter (above the results strip). It narrows the results
            and today/yesterday sections; "All" restores the whole feed. */}
        {matchesStatus === 'success' && filterItems.length > 1 ? (
          <SegmentControl
            items={filterItems}
            value={competition}
            onChange={setCompetition}
            className="segment-control homepage-filter"
            label="Filter by competition"
          />
        ) : null}
        {matchesStatus === 'loading' || matchesStatus === 'idle' ? (
          <Skeleton rows={1} label="Loading matches" variant="card" />
        ) : matchesStatus === 'error' ? (
          <ErrorState
            title="Today's matches could not load"
            detail={matchesError}
            onRetry={onRetryMatches}
          />
        ) : inRange.length ? (
          <>
            {latestResults.length > 0 && (
              <section role="region" aria-label="Latest results" className="homepage-results">
                <div className="match-section-title">
                  <History size={16} />
                  Latest results
                </div>
                <div className="homepage-carousel">
                  {latestResults.map((m) => (
                    <HomeMatchCard
                      key={m.id}
                      match={m}
                      liveScore={liveScores[m.id]}
                      onOpenMatch={onOpenMatch}
                      seasonId={seasonId}
                      detailReturnFocusRef={detailReturnFocusRef}
                    />
                  ))}
                </div>
              </section>
            )}
            {Object.entries(groups).map(([label, dayMatches]) =>
              dayMatches.length ? (
                <div key={label} className="homepage-day-section">
                  <div className="match-section-title">
                    <CalendarDays size={16} />
                    {label} &middot; {shortDay(dayMatches[0].kickoff)}
                  </div>
                  {dayMatches.map((m) => <HomeMatchCard key={m.id} match={m} liveScore={liveScores[m.id]} onOpenMatch={onOpenMatch} seasonId={seasonId} detailReturnFocusRef={detailReturnFocusRef} />)}
                </div>
              ) : null,
            )}
          </>
        ) : (
          <EmptyState
            title="No matches today"
            text="Today and yesterday games appear here with live results as they happen. Refresh to check again."
            action={<Button variant="secondary" onClick={onRetryMatches}>Refresh</Button>}
          />
        )}
      </div>
    </div>
  );
}
