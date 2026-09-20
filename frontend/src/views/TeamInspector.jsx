import { Home, Plane, Users } from 'lucide-preact';
import Crest from '../components/Crest';
import { StateMessage } from '../components/States';

export default function TeamInspector({ team, teams, selectedTeamId, setSelectedTeamId, matchups, interactive = false, revealedOpponentIds = new Set() }) {
  if (!team) {
    return <aside className="inspector"><StateMessage icon={Users} title="No team selected" text="Choose a team from a pot." /></aside>;
  }
  // During an interactive reveal, show exactly the opponents revealed so far
  // (same pace as the badges below the pots); outside a reveal, show them all.
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
        <span>Inspect team</span>
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
        <p>Pot {team.pot} - Seed {team.seeding_position} - Coeff. {team.uefa_club_coefficient}</p>
      </div>
      <div className="opponent-list">
        <strong>Opponents</strong>
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
                    <span>Pot {opponent.pot}</span>
                  </em>
                </div>
              );
            })
        ) : (
          <p className="muted">
            {interactive
              ? 'Pick this team in the interactive draw to lock its opponents.'
              : 'Run a simulation to inspect this team\'s eight fixtures.'}
          </p>
        )}
      </div>
    </aside>
  );
}
