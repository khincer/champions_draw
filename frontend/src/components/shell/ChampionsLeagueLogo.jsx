import championsLeagueLogoUrl from '../../assets/uefa-champions-league-logo.svg';

export default function ChampionsLeagueLogo() {
  return (
    <div className="champions-logo" aria-label="Champions League">
      <img src={championsLeagueLogoUrl} alt="UEFA Champions League logo" />
    </div>
  );
}
