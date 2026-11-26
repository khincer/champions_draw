import Crest from '../components/Crest';
import { useI18n } from '../i18n';

export default function PotBoard({ pots, selectedTeamId, setSelectedTeamId, onTeamClick }) {
  const { t } = useI18n();
  return (
    <section className="pot-grid">
      {['1', '2', '3', '4'].map((pot) => (
        <article className="pot-panel" key={pot}>
          <div className="pot-head">
            <strong>{t('draw.pot', { pot })}</strong>
            <span>{t('draw.teamCount', { count: pots[pot]?.length || 0 })}</span>
          </div>
          {(pots[pot] || []).map((team) => (
            <button
              className={`team-row ${selectedTeamId === team.id ? 'selected' : ''}`}
              key={team.id}
              onClick={() => {
                setSelectedTeamId(team.id);
                if (onTeamClick) onTeamClick(team.id);
              }}
            >
              <span>{team.seeding_position}</span>
              <Crest team={team} size="sm" />
              <strong>{team.name}</strong>
              <em>{team.association.code}</em>
            </button>
          ))}
        </article>
      ))}
    </section>
  );
}
