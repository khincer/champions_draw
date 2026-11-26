import { useEffect, useRef, useState } from 'preact/hooks';
import { ClipboardList, Home, LayoutGrid, Menu, Swords, Target, Trophy, X } from 'lucide-preact';
import LanguageMenu from './LanguageMenu';
import ThemeToggle from './shell/ThemeToggle';
import { LOCALE_OPTIONS, useI18n } from '../i18n';

const VIEWS = [
  { key: 'home', labelKey: 'nav.home', shortcutKey: 'nav.home', Icon: Home },
  { key: 'real', labelKey: 'nav.realDraw', shortcutKey: 'nav.realDraw', Icon: Swords },
  { key: 'picks', labelKey: 'nav.matchPicks', shortcutKey: 'nav.picks', Icon: Target },
  { key: 'workspace', labelKey: 'nav.drawSimulator', Icon: Trophy },
  { key: 'teams', labelKey: 'nav.leagues', Icon: LayoutGrid },
];
const SHORTCUTS = VIEWS.filter((item) => item.shortcutKey);

export default function MobileNav({ view, onSelectView, overlayOpen, tabs, theme, onToggleTheme }) {
  const { t, locale, setLocale } = useI18n();
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  function close() {
    dialogRef.current?.close();
  }

  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      const rail = document.querySelector('.site-nav');
      if (rail && window.getComputedStyle(rail).display !== 'none') close();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    if (overlayOpen && dialogRef.current?.open) close();
  }, [overlayOpen]);

  function handleClose() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function renderItem({ key, labelKey, Icon }, shortcutKey) {
    const current = view === key;
    return (
      <button
        key={key}
        type="button"
        className={`mobile-nav-item${current ? ' active' : ''}`}
        aria-current={current ? 'page' : undefined}
        aria-label={shortcutKey ? t(labelKey) : undefined}
        onClick={() => {
          onSelectView(key);
          close();
        }}
      >
        <Icon size={20} aria-hidden="true" />
        <span className="mobile-nav-label">{t(shortcutKey || labelKey)}</span>
      </button>
    );
  }

  return (
    <>
      <div className="mobile-nav">
        <nav className="mobile-nav-bar" aria-label={t('a11y.primaryNav')}>
          {SHORTCUTS.map((item) => renderItem(item, item.shortcutKey))}
        </nav>
        <button
          ref={triggerRef}
          type="button"
          className={`mobile-nav-item mobile-nav-menu${SHORTCUTS.some(({ key }) => key === view) ? '' : ' active'}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={overlayOpen || undefined}
          onClick={() => {
            dialogRef.current?.showModal();
            setOpen(true);
          }}
        >
          <Menu size={20} aria-hidden="true" />
          <span className="mobile-nav-label">{t('nav.menu')}</span>
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="mobile-nav-drawer"
        aria-label={t('nav.navigation')}
        onClose={handleClose}
      >
        <div className="mobile-nav-drawer-head">
          <p className="mobile-nav-drawer-title">{t('nav.navigation')}</p>
          <button
            type="button"
            className="mobile-nav-close"
            aria-label={t('nav.closeNavigation')}
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="mobile-nav-drawer-views" role="group" aria-label={t('nav.views')}>
          {VIEWS.map((item) => renderItem(item))}
          <a className="mobile-nav-item league-manager-nav-link" href="/league-manager/">
            <ClipboardList size={20} aria-hidden="true" />
            <span className="mobile-nav-label">{t('nav.leagueManager')}</span>
          </a>
        </div>
        <div className="mobile-nav-drawer-section mobile-nav-preferences">
          <LanguageMenu
            items={LOCALE_OPTIONS}
            value={locale}
            onChange={setLocale}
            label={t('settings.language')}
          />
          <ThemeToggle theme={theme} onToggle={onToggleTheme} className="mobile-nav-item" showLabel />
        </div>
        {tabs && (
          <div className="mobile-nav-drawer-section">
            <p className="mobile-nav-drawer-title">{t('nav.workspace')}</p>
            {tabs}
          </div>
        )}
      </dialog>
    </>
  );
}
