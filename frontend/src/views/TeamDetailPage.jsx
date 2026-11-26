import { ArrowLeft, Users } from 'lucide-preact';
import Badge from '../components/Badge';
import Crest from '../components/Crest';
import FixtureRow from '../components/FixtureRow';
import { StateMessage } from '../components/States';
import { useI18n } from '../i18n';

export default function TeamDetailPage({ teams, teamId, setTeamId, matchups, predictions = {}, onBack }) {
  const { t } = useI18n();
  const team = teams.find((t) => t.id === teamId) || teams[0];
  const teamMatchups = matchups.filter(
    (m) => m.home_team.id === team?.id || m.away_team.id === team?.id,
  ).sort((a, b) => a.matchday - b.matchday);

  if (!team) {
    return <StateMessage icon={Users} title={t('draw.noTeams')} text={t('draw.noTeamsText')} />;
  }

  return (
    <section className="team-detail-page">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        {t('draw.back')}
      </button>

      <div className="team-detail-header">
        <Crest team={team} size="lg" />
        <div>
          <h2>{team.name}</h2>
          <p className="team-detail-meta">
            {t('draw.teamMeta', { association: team.association.name, pot: team.pot, seed: team.seeding_position })}
          </p>
          <p className="team-detail-coeff">{t('draw.coefficient', { n: team.uefa_club_coefficient })}</p>
          {team.is_title_holder && <Badge tone="gold">{t('draw.titleHolder')}</Badge>}
          {team.qualified_via !== 'LEAGUE_POSITION' && (
            <Badge tone="blue">{team.qualified_via.replace(/_/g, ' ').toLowerCase()}</Badge>
          )}
        </div>
      </div>

      <div className="team-detail-select">
        <label>
          <span>{t('draw.viewTeam')}</span>
          <select value={team.id} onChange={(e) => setTeamId(Number(e.target.value))}>
            {teams.map((t) => (
              <option value={t.id} key={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
      </div>

      <h2>{t('teams.fixtures')}</h2>
      {teamMatchups.length ? (
        <div className="team-fixtures">
          {teamMatchups.map((m) => {
            const isHome = m.home_team.id === team.id;
            const opponent = isHome ? m.away_team : m.home_team;
            const pred = predictions[String(m.id)];
            const hasScore = pred && (pred.home_goals != null || pred.away_goals != null);
            return (
              <FixtureRow
                key={m.id}
                layout="team"
                badge
                leading={<span className="matchday-chip">MD{m.matchday}</span>}
                home={isHome ? m.home_team : m.away_team}
                away={opponent}
                center={<span className="versus">{t('fixtures.versus')}</span>}
                trailing={
                  <>
                    {hasScore && (
                      <span className="team-fixture-score">
                        {pred.home_goals}&ndash;{pred.away_goals}
                      </span>
                    )}
                    <span className={`venue-chip ${isHome ? 'home' : 'away'}`}>{isHome ? 'H' : 'A'}</span>
                  </>
                }
              />
            );
          })}
        </div>
      ) : (
        <p className="muted">{t('draw.runForFixtures')}</p>
      )}
    </section>
  );
}
