import FixtureRow from './FixtureRow';
import { useI18n } from '../i18n';

export default function LeagueFixtureRow({ m }) {
  const { formatDay, formatTime, t } = useI18n();
  const done = m.status === 'FINISHED' && m.result;
  return (
    <FixtureRow
      layout="mini"
      date={formatDay(m.kickoff)}
      time={done ? t('fixtures.fullTime') : formatTime(m.kickoff)}
      scoreText={done ? `${m.result.home_goals}–${m.result.away_goals}` : t('fixtures.versus')}
      home={{ name: m.home_name, short_name: m.home_name, logo_url: m.home_crest }}
      away={{ name: m.away_name, short_name: m.away_name, logo_url: m.away_crest }}
      nameMode="full"
    />
  );
}
