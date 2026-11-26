import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import Crest from '../components/Crest';
import { ErrorState } from '../components/States';
import errorText from '../lib/errorText';
import { useI18n } from '../i18n';

export default function InteractiveDraft({ seasonId, state, setState, apiFetch, selectedTeamId, setSelectedTeamId, onComplete, onReveal }) {
  const { t } = useI18n();
  const { teams, matchups, picks, current_pot, auto_finalized } = state;
  const pickedIds = new Set((picks || []).map((pick) => pick.season_team_id));
  const pickedTeams = (picks || [])
    .slice()
    .sort((a, b) => a.pick_order - b.pick_order)
    .map((pick) => teams.find((team) => team.id === pick.season_team_id))
    .filter(Boolean);
  const [pickingId, setPickingId] = useState(null);
  
  const [error, setError] = useState(null);
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

  useEffect(() => {
    onReveal?.(new Set(revealedIds));
  }, [revealSession, revealCount, activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pendingFinalize && activeOpponents.length && revealCount >= activeOpponents.length) {
      const timer = window.setTimeout(() => onComplete(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [pendingFinalize, revealCount, activeOpponents.length]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setError({ message: err.code || 'unknown', team });
    } finally {
      pickingRef.current = false;
      setPickingId(null);
    }
  }

  async function handlePick(team) {
    setSelectedTeamId(team.id);
    const knownCount = (matchups || []).filter(
      (m) => m.home_team.id === team.id || m.away_team.id === team.id,
    ).length;
    if (pickedIds.has(team.id) || String(team.pot) !== String(current_pot)) {
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
          <h2>{auto_finalized ? t('draw.complete') : t('draw.interactivePot', { pot: current_pot || '?' })}</h2>
          <p>
            {t('draw.pickedProgress', { picked: pickedTeams.length })}
          </p>
        </div>
        {!auto_finalized && (
          <span className={pickingId ? 'draw-pulse draw-pulse-active' : 'draw-pulse'} aria-hidden="true" />
        )}
      </div>

      {error && (
        <ErrorState
          title={t('draw.pickFailed')}
          detail={t('draw.pickErrorText', { error: errorText(t, error.message), team: error.team.name })}
          onRetry={() => commitPick(error.team)}
          retryLabel={t('draw.retryPick')}
        />
      )}

      <div className="interactive-head">
        <strong>{current_pot ? t('draw.potOnClock', { pot: current_pot }) : t('draw.allPicked')}</strong>
        <span role="status">
          {pickingId
            ? t('draw.lockingPick')
            : activeTeam
              ? t('draw.teamSelected', { name: activeTeam.name })
              : ''}
        </span>
      </div>

      <div className="interactive-pots" aria-busy={Boolean(pickingId)}>
        {pots.map((pot) => (
          <article className="pot-panel" key={pot}>
            <div className="pot-head">
              <strong>{t('draw.pot', { pot })}</strong>
              <span>{onClock === pot ? t('draw.onClock') : ''}</span>
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
        <strong>{t('draw.picked')}</strong>
        {pickedTeams.length ? (
          pickedTeams.map((team) => (
            <button
              className={`picked-chip ${activeId === team.id ? 'active' : ''}`}
              key={team.id}
              onClick={() => handlePick(team)}
              title={t('draw.clickToReveal')}
            >
              <Crest team={team} size="sm" />
              <b>{team.short_name}</b>
            </button>
          ))
        ) : (
          <span className="muted">{t('draw.pickedAppear')}</span>
        )}
      </div>

      <div className="reveal-box">
        <h3>
          {activeTeam ? t('draw.teamOpponents', { name: activeTeam.name }) : t('draw.selectTeam')}
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
                ? t('draw.pickToReveal')
                : t('draw.opponentsAppear')}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
