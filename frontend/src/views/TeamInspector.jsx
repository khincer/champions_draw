import { Home, Plane, Users } from 'lucide-preact';
import Crest from '../components/Crest';
import { StateMessage } from '../components/States';
import { useI18n } from '../i18n';

export default function TeamInspector({ team, teams, selectedTeamId, setSelectedTeamId, matchups, interactive = false, revealedOpponentIds = new Set() }) {
  const { t } = useI18n();
  if (!team) {
    return <aside className="inspector"><StateMessage icon={Users} title={t('draw.noTeamSelected')} text={t('draw.chooseTeam')} /></aside>;
  }
  const visibleMatchups =
    interactive && revealedOpponentIds.size
      ? matchups.filter((matchup) => {
          const opponentId =
            matchup.home_team.id === team.id ? matchup.away_team.id : matchup.home_team.id;
          return revealedOpponentIds.has(opponentId);
        })
      : matchups;
  return (
    <aside className="inspector">
      <label className="team-picker">
        <span>{t('draw.inspectTeam')}</span>
        <select value={selectedTeamId || ''} onChange={(event) => setSelectedTeamId(Number(event.currentTarget.value))}>
          {teams.map((entry) => (
            <option value={entry.id} key={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="inspector-head">
        <Crest team={team} size="lg" />
        <span>{team.association.name}</span>
        <h2>{team.name}</h2>
        <p>{t('draw.inspectorMeta', { pot: team.pot, seed: team.seeding_position, coeff: team.uefa_club_coefficient })}</p>
      </div>
      <div className="opponent-list">
        <strong>{t('draw.opponents')}</strong>
        {visibleMatchups.length ? (
          visibleMatchups
            .sort((a, b) => a.matchday - b.matchday)
            .map((matchup) => {
              const isHome = matchup.home_team.id === team.id;
              const opponent = isHome ? matchup.away_team : matchup.home_team;
              return (
                <div className="opponent-row" key={matchup.id}>
                  <span>MD{matchup.matchday}</span>
                  <Crest team={opponent} size="sm" />
                  <strong>{opponent.name}</strong>
                  <em className="home-away">
                    {isHome ? <Home size={12} /> : <Plane size={12} />}
                    <span>{t('draw.pot', { pot: opponent.pot })}</span>
                  </em>
                </div>
              );
            })
        ) : (
          <p className="muted">
            {interactive
              ? t('draw.pickToLock')
              : t('draw.runToInspect')}
          </p>
        )}
      </div>
    </aside>
  );
}
