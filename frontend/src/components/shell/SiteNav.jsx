import { Home, LayoutGrid, Swords, Trophy, UserRound } from 'lucide-preact';
import championsLeagueLogoUrl from '../../assets/uefa-champions-league-logo.svg';
import ThemeToggle from './ThemeToggle';

export default function SiteNav({ view, setView, setActiveTab }) {
  return (
    <nav className="site-nav" aria-label="Primary">
      <div className="site-nav-logo">
        <img src={championsLeagueLogoUrl} alt="Champions League" />
      </div>
      <div className="site-nav-links">
        <button
          className={`site-nav-link ${view === 'home' ? 'active' : ''}`}
          onClick={() => setView('home')}
        >
          <Home size={18} />
          Home
        </button>

        <div className="site-nav-section">Official</div>
        <button
          className={`site-nav-link ${view === 'real' ? 'active' : ''}`}
          onClick={() => setView('real')}
        >
          <Swords size={18} />
          Real Draw
        </button>

        <div className="site-nav-section">Simulators</div>
        <button
          className={`site-nav-link ${view === 'workspace' ? 'active' : ''}`}
          onClick={() => { setView('workspace'); setActiveTab('simulate'); }}
        >
          <Trophy size={18} />
          Draw Simulator
        </button>
        <button
          className={`site-nav-link ${view === 'career' ? 'active' : ''}`}
          onClick={() => setView('career')}
        >
          <UserRound size={18} />
          Career Mode
        </button>

        <div className="site-nav-section">Browse</div>
        <button
          className={`site-nav-link ${view === 'teams' ? 'active' : ''}`}
          onClick={() => setView('teams')}
        >
          <LayoutGrid size={18} />
          Leagues
        </button>
      </div>
      <div className="site-nav-footer">
        <ThemeToggle />
      </div>
    </nav>
  );
}
