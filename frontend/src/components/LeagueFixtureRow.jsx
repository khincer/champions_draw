import FixtureRow from './FixtureRow';
import { shortDay, shortTime } from '../lib/format';

/* Compact finished/upcoming fixture row used by the league page and the team
   page. Moved out of `main.jsx` so the extracted TeamPage view does not have to
   import from the shell. Markup unchanged. */
export default function LeagueFixtureRow({ m }) {
  const done = m.status === 'FINISHED' && m.result;
  return (
    <FixtureRow
      layout="mini"
      date={shortDay(m.kickoff)}
      time={done ? 'FT' : shortTime(m.kickoff)}
      scoreText={done ? `${m.result.home_goals}–${m.result.away_goals}` : 'vs'}
      home={{ name: m.home_name, short_name: m.home_name, logo_url: m.home_crest }}
      away={{ name: m.away_name, short_name: m.away_name, logo_url: m.away_crest }}
      nameMode="full"
    />
  );
}
