import { useMemo, useState } from 'preact/hooks';
import { CalendarDays, History, LayoutGrid, Swords, Trophy, UserRound } from 'lucide-preact';
import Crest from '../components/Crest';
import Button from '../components/Button';
import SegmentControl from '../components/SegmentControl';
import { EmptyState, ErrorState, LiveRegion, Skeleton } from '../components/States';
import { getPlayerName } from '../lib/predictionStorage';
import { inHomeRange } from '../lib/format';
import { useI18n } from '../i18n';



/* Module-level config holds KEYS, never translated copy: a t() call here would
   be frozen at module load and could never react to a locale change. */
const QUICK_ACTIONS = [
  { key: 'real', labelKey: 'home.realDraw', icon: Swords },
  { key: 'workspace', labelKey: 'home.drawSimulator', icon: Trophy },
  { key: 'teams', labelKey: 'home.leagues', icon: LayoutGrid },
];

/* The bucket keys are literal object keys; only the rendered label is
   translated. Translating the key itself would break the lookup. */
const BUCKET_LABELS = { Tomorrow: 'home.tomorrow', Today: 'home.today', Yesterday: 'home.yesterday' };

function HomeMatchCard({ match, liveScore, onOpenMatch, seasonId, detailReturnFocusRef }) {
  const { t, formatDay, formatTime } = useI18n();
  const result = match.result;
  const eligible = result || (match.kickoff && new Date(match.kickoff) <= new Date());
  const status = result ? 'finished' : match.closed ? 'live' : 'upcoming';
  const statusLabel = t(result ? 'home.final' : match.closed ? 'home.live' : 'home.kickoff');
  return (
    <article
      className="home-game-card"
      aria-label={t('home.versus', { home: match.home_team.name, away: match.away_team.name })}
    >
      <header className="home-game-card-header">
        <div>
          <p className="hub-eyebrow">{match.competition || 'Champions League'}</p>
          <p className="hub-date">{formatDay(match.kickoff)}</p>
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
            <p className="hub-kickoff">{formatTime(match.kickoff)}</p>
          )}
          <p className="hub-score-caption">{t(status === 'finished' ? 'home.result' : status === 'live' ? 'home.live' : 'home.kickoff')}</p>
        </div>
        <div className="hub-team">
          <Crest team={match.away_team} size="md" />
          <p className="hub-team-name">{match.away_team.name}</p>
          {match.away_team.short_name && <p className="hub-team-short">{match.away_team.short_name}</p>}
        </div>
      </div>
      <footer className="home-game-card-footer">
        <span>{t('home.matchday', { number: match.matchday })}</span>
        {match.openable && eligible ? (
          <button
            className="hub-open-match"
            type="button"
            aria-label={t('home.viewMatchDetails', { home: match.home_team.name, away: match.away_team.name })}
            ref={detailReturnFocusRef}
            onClick={() => onOpenMatch(match.id, match.season_id || seasonId, match.league_id)}
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
  const { t, formatDay } = useI18n();
  const [competition, setCompetition] = useState('all');

  
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
      { key: 'all', label: t('home.all') },
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
    [competitions, t],
  );

  const inRange = useMemo(
    () => visibleMatches.filter(inHomeRange).sort((a, b) => (a.kickoff || '').localeCompare(b.kickoff || '')),
    [visibleMatches],
  );

  /* Render order is Tomorrow, Today, Yesterday — deliberate, do not "fix" it.
     Object.entries preserves this insertion order. */
  const groups = useMemo(() => {
    const now = new Date();
    const today = now.toDateString();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toDateString();
    return inRange.reduce(
      (acc, m) => {
        const day = new Date(m.kickoff).toDateString();
        const key = day === tomorrow ? 'Tomorrow' : day === today ? 'Today' : 'Yesterday';
        acc[key].push(m);
        return acc;
      },
      { Tomorrow: [], Today: [], Yesterday: [] },
    );
  }, [inRange]);

  const latestResults = useMemo(
    () =>
      visibleMatches
        .filter((m) => m.result)
        .sort((a, b) => (b.kickoff || '').localeCompare(a.kickoff || ''))
        .slice(0, 6),
    [visibleMatches],
  );

  const name = (playerName || getPlayerName() || '').trim();

  return (
    <div className="homepage">
      <header className="home-intro">
        <p className="home-greeting">{name ? t('home.welcomeBack', { name }) : t('home.welcome')}</p>
        <section className="home-quick-actions" aria-label={t('a11y.quickActions')}>
        {QUICK_ACTIONS.map(({ key, labelKey, icon: Icon }) => (
          <Button key={key} variant="secondary" onClick={() => onNavigate(key)}>
            <Icon size={16} aria-hidden="true" />
            {t(labelKey)}
          </Button>
        ))}
      </section>
      </header>

      <div className="home-live-slot">
        <LiveRegion message={liveScoresError} tone={liveScoresError ? 'error' : 'info'} />
      </div>

      {matchesStatus === 'success' && matchesError ? (
        <ErrorState
          title={t('home.matchesRefreshFailed')}
          detail={matchesError}
          onRetry={onRetryMatches}
          retryLabel={t('home.retryRefresh')}
        />
      ) : null}

      

      <div className="homepage-matches">
        {matchesStatus === 'success' && filterItems.length > 1 ? (
          <SegmentControl
            items={filterItems}
            value={competition}
            onChange={setCompetition}
            className="segment-control homepage-filter"
            label={t('home.filterByCompetition')}
          />
        ) : null}
        {matchesStatus === 'loading' || matchesStatus === 'idle' ? (
          <Skeleton rows={1} label={t('a11y.loadingMatches')} variant="card" />
        ) : matchesStatus === 'error' ? (
          <ErrorState
            title={t('home.todayLoadFailed')}
            detail={matchesError}
            onRetry={onRetryMatches}
          />
        ) : inRange.length ? (
          <>
            {latestResults.length > 0 && (
              <section role="region" aria-label={t('a11y.latestResults')} className="homepage-results">
                <div className="match-section-title">
                  <History size={16} />
                  {t('home.latestResults')}
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
                    {t(BUCKET_LABELS[label])} &middot; {formatDay(dayMatches[0].kickoff)}
                  </div>
                  {dayMatches.map((m) => <HomeMatchCard key={m.id} match={m} liveScore={liveScores[m.id]} onOpenMatch={onOpenMatch} seasonId={seasonId} detailReturnFocusRef={detailReturnFocusRef} />)}
                </div>
              ) : null,
            )}
          </>
        ) : (
          <EmptyState
            title={t('home.noMatchesTitle')}
            text={t('home.noMatchesText')}
            action={<Button variant="secondary" onClick={onRetryMatches}>{t('states.refresh')}</Button>}
          />
        )}
      </div>
    </div>
  );
}
