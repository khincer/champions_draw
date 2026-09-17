import { useMemo } from 'preact/hooks';
import { Activity, CalendarDays, History, LayoutGrid, Swords, Trophy, UserRound } from 'lucide-preact';
import Crest from '../components/Crest';
import Button from '../components/Button';
import Metric from '../components/Metric';
import { StateMessage } from '../components/States';
import { getPlayerName } from '../predictionStorage';
import { inHomeRange, shortDay, shortTime } from '../lib/format';

/* Home composition (Design.md §7.2, task 3.3): greeting + metric cards + live
   hub + quick actions. No charts and no recent-draw section — the maintainer
   confirmed that scope. The hub content (today/yesterday plus the latest-results
   strip) was moved out of `main.jsx` verbatim; `HomeMatchCard` stays local
   because nothing else renders it.

   Every metric is derived from the matches feed `App` already fetches, so no
   endpoint or payload changed. The shortcuts mirror `SiteNav`; `App` owns the
   view state and passes its switch down as `onNavigate`, so this view never
   holds navigation state of its own. */

const QUICK_ACTIONS = [
  { key: 'real', label: 'Real draw', icon: Swords },
  { key: 'workspace', label: 'Draw simulator', icon: Trophy },
  { key: 'career', label: 'Career mode', icon: UserRound },
  { key: 'teams', label: 'Leagues', icon: LayoutGrid },
];

const isToday = (match) => Boolean(match.kickoff) && new Date(match.kickoff).toDateString() === new Date().toDateString();

function HomeMatchCard({ match, liveScore, onOpenMatch, seasonId, detailReturnFocusRef, focusable }) {
  const result = match.result;
  const eligible = result || (match.kickoff && new Date(match.kickoff) <= new Date());
  const status = result ? 'finished' : match.closed ? 'live' : 'upcoming';
  const statusLabel = result ? 'Final' : match.closed ? 'Live' : 'Kickoff';
  return (
    <article
      className="home-game-card"
      aria-label={`${match.home_team.name} versus ${match.away_team.name}`}
      tabIndex={focusable ? 0 : undefined}
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
            aria-label="View match details"
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

export default function Homepage({ matches, liveScores, onOpenMatch, onNavigate, playerName, seasonId, detailReturnFocusRef }) {
  const inRange = useMemo(
    () => matches.filter(inHomeRange).sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')),
    [matches],
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
      matches
        .filter((m) => m.result)
        .sort((a, b) => (b.kickoff || '').localeCompare(a.kickoff || ''))
        // ponytail: hardcoded cap of 6 cards; raise when the homepage routinely shows more fresh results
        .slice(0, 6),
    [matches],
  );

  /* Honest metric sources: the hub window is what this view renders, so its
     counts are the only numbers the feed can back without invention. */
  const todayMatches = useMemo(() => inRange.filter(isToday), [inRange]);
  const liveNow = useMemo(() => inRange.filter((m) => m.closed && !m.result), [inRange]);
  const finished = useMemo(() => inRange.filter((m) => m.result), [inRange]);
  const name = (playerName || getPlayerName() || '').trim();

  return (
    <div className="homepage">
      <header className="home-intro">
        <p className="home-greeting">{name ? `Welcome back, ${name}` : 'Welcome'}</p>
        <p className="home-intro-sub">Today's results, live scores and shortcuts in one place.</p>
      </header>

      <section className="home-metrics" aria-label="At a glance">
        <Metric
          icon={CalendarDays}
          label="Matches today"
          value={todayMatches.length}
          support={todayMatches.length ? shortDay(todayMatches[0].kickoff) : 'Nothing scheduled in the hub window'}
        />
        <Metric icon={Activity} label="Live now" value={liveNow.length} support="Scores poll every 30s" />
        <Metric icon={History} label="Results" value={finished.length} support="Finished today or yesterday" />
      </section>

      <section className="home-quick-actions" aria-label="Quick actions">
        {QUICK_ACTIONS.map(({ key, label, icon: Icon }) => (
          <Button key={key} variant="secondary" onClick={() => onNavigate(key)}>
            <Icon size={16} aria-hidden="true" />
            {label}
          </Button>
        ))}
      </section>

      <div className="homepage-matches">
        {inRange.length ? (
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
                      focusable
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
          <StateMessage
            icon={Trophy}
            title="No matches today"
            text="Today and yesterday games appear here with live results as they happen."
          />
        )}
      </div>
    </div>
  );
}
