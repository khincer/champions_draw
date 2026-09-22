import { useEffect, useRef, useState } from 'preact/hooks';
import { Home, LayoutGrid, Menu, Swords, Target, Trophy, UserRound, X } from 'lucide-preact';
import LanguageMenu from './LanguageMenu';
import { LOCALE_OPTIONS, useI18n } from '../i18n';

/* Module-level config holds KEYS, never translated copy: a t() call here would
   be frozen at module load. 'Career' has no key on purpose — career mode is
   omitted from the catalogues, so its label stays literal. */
const VIEWS = [
  { key: 'home', labelKey: 'nav.home', Icon: Home },
  { key: 'teams', labelKey: 'nav.leagues', Icon: LayoutGrid },
  { key: 'career', label: 'Career', Icon: UserRound },
  { key: 'real', labelKey: 'nav.real', Icon: Swords },
  { key: 'picks', labelKey: 'nav.picks', Icon: Target },
  { key: 'workspace', labelKey: 'nav.simulator', Icon: Trophy },
];

export default function MobileNav({ view, onSelectView, overlayOpen, tabs }) {
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

  function renderItem({ key, labelKey, label, Icon }) {
    const current = view === key;
    return (
      <button
        key={key}
        type="button"
        className={`mobile-nav-item${current ? ' active' : ''}`}
        aria-current={current ? 'page' : undefined}
        onClick={() => {
          onSelectView(key);
          close();
        }}
      >
        <Icon size={20} aria-hidden="true" />
        <span className="mobile-nav-label">{labelKey ? t(labelKey) : label}</span>
      </button>
    );
  }

  return (
    <>
      <div className="mobile-nav">
        <nav className="mobile-nav-bar" aria-label={t('a11y.primaryNav')}>
          {VIEWS.map(renderItem)}
        </nav>
        <button
          ref={triggerRef}
          type="button"
          className="mobile-nav-item mobile-nav-menu"
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
          {VIEWS.map(renderItem)}
        </div>
        <div className="mobile-nav-drawer-section">
          <LanguageMenu
            items={LOCALE_OPTIONS}
            value={locale}
            onChange={setLocale}
            label={t('settings.language')}
          />
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
