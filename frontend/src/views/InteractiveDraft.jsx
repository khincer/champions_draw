import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Crest from '../components/Crest';
import { ErrorState } from '../components/States';

export default function InteractiveDraft({ seasonId, state, setState, apiFetch, selectedTeamId, setSelectedTeamId, onComplete, onReveal }) {
  const { teams, matchups, picks, current_pot, auto_finalized } = state;
  const pickedIds = new Set((picks || []).map((pick) => pick.season_team_id));
  const pickedTeams = (picks || [])
    .slice()
    .sort((a, b) => a.pick_order - b.pick_order)
    .map((pick) => teams.find((team) => team.id === pick.season_team_id))
    .filter(Boolean);
  const [pickingId, setPickingId] = useState(null);
  /* `{ message, team }` — the team is what the retry re-issues, so a retry can
     only ever repeat the pick that failed (US:no-silent-failure). */
  const [error, setError] = useState(null);
  /* One pick at a time: a second POST while the first is in flight would
     double-advance the draw (same rule as the matchday save, task 4.3). */
  const pickingRef = useRef(false);
  const [revealCount, setRevealCount] = useState(0);
  const [revealStart, setRevealStart] = useState(0);
  const [revealSession, setRevealSession] = useState(0);
  const [pendingFinalize, setPendingFinalize] = useState(false);

  const activeId = selectedTeamId;
  const activeTeam = teams.find((team) => team.id === activeId) || null;
  const activeMatchups = useMemo(() => {
    if (!activeTeam) return [];
    return (matchups || []).filter(
      (m) => m.home_team.id === activeTeam.id || m.away_team.id === activeTeam.id,
    );
  }, [activeTeam, matchups]);
  const activeOpponents = activeMatchups
    .map((m) => (m.home_team.id === activeTeam.id ? m.away_team : m.home_team))
    .sort((a, b) => a.pot - b.pot || a.name.localeCompare(b.name));

  // Reveal the selected team's opponents one by one, 1s apart. Opponents whose
  // matchup already existed (knownCount = revealStart) appear instantly; only
  // freshly-created matchups animate. Restarts on every selection via
  // revealSession.
  useEffect(() => {
    setRevealCount(revealStart);
    if (revealStart >= activeOpponents.length) return undefined;
    const timer = window.setInterval(() => {
      setRevealCount((count) => {
        if (count >= activeOpponents.length) {
          window.clearInterval(timer);
          return count;
        }
        return count + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [revealSession, revealStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the parent (TeamInspector) in sync with the reveal: it should show
  // the same opponents, at the same pace, as the pots panel below.
  useEffect(() => {
    onReveal?.(new Set(revealedIds));
  }, [revealSession, revealCount, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pick that ended the draw still plays its full one-by-one reveal before
  // switching away to matchdays ("even if the simulator already finished").
  useEffect(() => {
    if (pendingFinalize && activeOpponents.length && revealCount >= activeOpponents.length) {
      const timer = window.setTimeout(() => onComplete(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pendingFinalize, revealCount, activeOpponents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The pick write: pending, failed and succeeded all show here, and the retry
     re-issues only this POST. */
  async function commitPick(team) {
    if (pickingRef.current) return;
    pickingRef.current = true;
    setPickingId(team.id);
    setError(null);
    try {
      const payload = await apiFetch(`/seasons/${seasonId}/interactive/pick/`, {
        method: 'POST',
        body: JSON.stringify({ season_team_id: team.id }),
      });
      setState(payload);
      setRevealSession((session) => session + 1); // start reveal once the pick's matchups are loaded
      if (payload.auto_finalized) {
        setPendingFinalize(true); // keep showing the reveal, then complete
        return;
      }
    } catch (err) {
      setError({ message: err.message, team });
    } finally {
      pickingRef.current = false;
      setPickingId(null);
    }
  }

  async function handlePick(team) {
    setSelectedTeamId(team.id);
    // Opponents whose matchup already exists are "known": reveal them instantly
    // instead of replaying the one-by-one animation for them too.
    const knownCount = (matchups || []).filter(
      (m) => m.home_team.id === team.id || m.away_team.id === team.id,
    ).length;
    if (pickedIds.has(team.id) || String(team.pot) !== String(current_pot)) {
      // Re-click or inspect-only: existing matchups are all known, so show the
      // whole list at once and leave the draw untouched.
      setRevealStart(knownCount);
      setRevealSession((session) => session + 1);
      return;
    }
    setRevealStart(knownCount);
    setRevealSession((session) => session + 1);
    await commitPick(team);
  }

  const pots = ['1', '2', '3', '4'];
  const potTeams = (pot) =>
    (teams || []).filter((team) => String(team.pot) === pot).sort((a, b) => a.seeding_position - b.seeding_position);
  const revealedOpponents = activeOpponents.slice(0, revealCount);
  const revealedIds = new Set(revealedOpponents.map((opponent) => opponent.id));
  const onClock = String(current_pot);

  return (
    <section className="interactive-stage">
      <div className="draw-animation-head">
        <div>
          <h2>{auto_finalized ? 'Draw complete!' : `Interactive draw — Pot ${current_pot || '?'}`}</h2>
          <p>
            {pickedTeams.length} of 36 teams picked. Choose one team; all of its matchups are locked in immediately.
          </p>
        </div>
        <span className="draw-pulse" />
      </div>

      {error && (
        <ErrorState
          title="That pick could not be locked in"
          detail={`${error.message}. The draw is unchanged — retry to pick ${error.team.name}.`}
          onRetry={() => commitPick(error.team)}
          retryLabel="Retry pick"
        />
      )}

      <div className="interactive-head">
        <strong>{current_pot ? `Pot ${current_pot} on the clock` : 'All teams picked'}</strong>
        {/* One stable node: the in-flight state swaps its text, so the row never
            shifts and the pick is announced once. */}
        <span role="status">
          {pickingId
            ? 'Locking in your pick…'
            : activeTeam
              ? `${activeTeam.name} selected`
              : ''}
        </span>
      </div>

      <div className="interactive-pots" aria-busy={Boolean(pickingId)}>
        {pots.map((pot) => (
          <article className="pot-panel" key={pot}>
            <div className="pot-head">
              <strong>Pot {pot}</strong>
              <span>{onClock === pot ? 'on the clock' : ''}</span>
            </div>
            {potTeams(pot).map((team) => {
              const isPicked = pickedIds.has(team.id);
              const isActive = activeId === team.id;
              const isRevealed = revealedIds.has(team.id);
              return (
                <button
                  className={`team-row ${isActive ? 'selected' : ''} ${
                    isRevealed && !isActive ? 'opponent' : ''
                  } ${isPicked ? 'picked' : ''}`}
                  key={team.id}
                  disabled={Boolean(pickingId)}
                  onClick={() => handlePick(team)}
                >
                  <span>{team.seeding_position}</span>
                  <Crest team={team} size="sm" />
                  <strong>{team.name}</strong>
                  <em>{team.association.code}</em>
                </button>
              );
            })}
          </article>
        ))}
      </div>

      <div className="picked-row">
        <strong>Picked</strong>
        {pickedTeams.length ? (
          pickedTeams.map((team) => (
            <button
              className={`picked-chip ${activeId === team.id ? 'active' : ''}`}
              key={team.id}
              onClick={() => handlePick(team)}
              title="Click to reveal opponents"
            >
              <Crest team={team} size="sm" />
              <b>{team.short_name}</b>
            </button>
          ))
        ) : (
          <span className="muted">Teams you pick will appear here, one by one.</span>
        )}
      </div>

      <div className="reveal-box">
        <h3>
          {activeTeam ? `${activeTeam.name} — opponents` : 'Select a team'}
        </h3>
        <div className="reveal-badges">
          {activeTeam && revealedOpponents.length ? (
            revealedOpponents.map((opponent, index) => (
              <Crest
                team={opponent}
                size="md"
                key={opponent.id}
                className={index < revealStart ? 'known' : ''}
              />
            ))
          ) : (
            <span className="muted">
              {activeTeam && !pickedIds.has(activeTeam.id)
                ? 'Pick this team to reveal its opponents.'
                : 'Opponents will appear here, one by one.'}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
