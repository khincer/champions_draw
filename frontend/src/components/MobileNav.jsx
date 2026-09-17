import { useEffect, useRef, useState } from 'preact/hooks';
import { Home, LayoutGrid, Menu, Swords, Trophy, UserRound, X } from 'lucide-preact';

/* Mobile navigation (Design.md §5.2): a fixed bottom bar carrying the five
   top-level views plus a `<dialog>` drawer that adds the six workspace
   sections. Which mode is active is decided by the single 920px media query in
   styles.css — this component never reads a media query to decide what to
   render, so crossing the threshold cannot remount a view. */
const VIEWS = [
  { key: 'home', label: 'Home', Icon: Home },
  { key: 'teams', label: 'Leagues', Icon: LayoutGrid },
  { key: 'career', label: 'Career', Icon: UserRound },
  { key: 'real', label: 'Real', Icon: Swords },
  { key: 'workspace', label: 'Simulator', Icon: Trophy },
];

export default function MobileNav({ view, onSelectView, overlayOpen, tabs }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);

  function close() {
    dialogRef.current?.close();
  }

  /* Crossing up over the shell threshold force-closes the drawer. The threshold
     lives in CSS only: ask the desktop rail whether mobile mode already ended
     instead of hardcoding 920 here — and touch no view/tab state. */
  useEffect(() => {
    if (!open) return undefined;
    const onResize = () => {
      const rail = document.querySelector('.site-nav');
      if (rail && window.getComputedStyle(rail).display !== 'none') close();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  /* The match-detail overlay owns focus while it is open, so the drawer must
     never sit in front of it. */
  useEffect(() => {
    if (overlayOpen && dialogRef.current?.open) close();
  }, [overlayOpen]);

  function handleClose() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function renderItem({ key, label, Icon }) {
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
        <span className="mobile-nav-label">{label}</span>
      </button>
    );
  }

  return (
    <>
      <div className="mobile-nav">
        <nav className="mobile-nav-bar" aria-label="Primary">
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
          <span className="mobile-nav-label">Menu</span>
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="mobile-nav-drawer"
        aria-label="Navigation"
        onClose={handleClose}
      >
        <div className="mobile-nav-drawer-head">
          <p className="mobile-nav-drawer-title">Navigation</p>
          <button
            type="button"
            className="mobile-nav-close"
            aria-label="Close navigation"
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="mobile-nav-drawer-views" role="group" aria-label="Views">
          {VIEWS.map(renderItem)}
        </div>
        {tabs && (
          <div className="mobile-nav-drawer-section">
            <p className="mobile-nav-drawer-title">Workspace</p>
            {tabs}
          </div>
        )}
      </dialog>
    </>
  );
}
