import { Home, LayoutGrid, Swords, Target, Trophy, UserRound } from 'lucide-preact';
import championsLeagueLogoUrl from '../../assets/uefa-champions-league-logo.svg';
import LanguageMenu from '../LanguageMenu';
import { LOCALE_OPTIONS, useI18n } from '../../i18n';
import ThemeToggle from './ThemeToggle';

export default function SiteNav({ view, setView, setActiveTab }) {
  const { t, locale, setLocale } = useI18n();

  return (
    <nav className="site-nav" aria-label={t('a11y.primaryNav')}>
      <div className="site-nav-logo">
        <img src={championsLeagueLogoUrl} alt="Champions League" />
      </div>
      <div className="site-nav-links">
        <button
          className={`site-nav-link ${view === 'home' ? 'active' : ''}`}
          aria-current={view === 'home' ? 'page' : undefined}
          onClick={() => setView('home')}
        >
          <Home size={18} />
          {t('nav.home')}
        </button>

        <div className="site-nav-section">{t('nav.official')}</div>
        <button
          className={`site-nav-link ${view === 'real' ? 'active' : ''}`}
          aria-current={view === 'real' ? 'page' : undefined}
          onClick={() => setView('real')}
        >
          <Swords size={18} />
          {t('nav.realDraw')}
        </button>
        <button
          className={`site-nav-link ${view === 'picks' ? 'active' : ''}`}
          aria-current={view === 'picks' ? 'page' : undefined}
          onClick={() => setView('picks')}
        >
          <Target size={18} />
          {t('nav.matchPicks')}
        </button>

        <div className="site-nav-section">{t('nav.simulators')}</div>
        <button
          className={`site-nav-link ${view === 'workspace' ? 'active' : ''}`}
          aria-current={view === 'workspace' ? 'page' : undefined}
          onClick={() => { setView('workspace'); setActiveTab('simulate'); }}
        >
          <Trophy size={18} />
          {t('nav.drawSimulator')}
        </button>

        <div className="site-nav-section">{t('nav.browse')}</div>
        <button
          className={`site-nav-link ${view === 'teams' ? 'active' : ''}`}
          aria-current={view === 'teams' ? 'page' : undefined}
          onClick={() => setView('teams')}
        >
          <LayoutGrid size={18} />
          {t('nav.leagues')}
        </button>
      </div>
      <div className="site-nav-footer">
        <LanguageMenu
          items={LOCALE_OPTIONS}
          value={locale}
          onChange={setLocale}
          label={t('settings.language')}
        />
        <ThemeToggle />
      </div>
    </nav>
  );
}
