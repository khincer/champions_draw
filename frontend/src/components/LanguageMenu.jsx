import { useEffect, useRef, useState } from 'preact/hooks';

/* Flags are inline SVG, never emoji: Windows has no country-flag glyphs in its
   emoji font, so Chrome and Edge render regional-indicator pairs as the two
   letters (GB) on the platform this is built on. Four hand-written 3:2 flags
   stay recognisable at 18x12 and add no dependency. The European set is
   deliberate — this is a UEFA competition, so pt -> Portugal, not Brazil. */
const SVG_FLAG = {
  className: 'language-menu-flag',
  viewBox: '0 0 24 16',
  width: 18,
  height: 12,
  'aria-hidden': 'true',
  focusable: 'false',
};

function Flag({ locale }) {
  switch (locale) {
    case 'en':
      return (
        <svg {...SVG_FLAG}>
          <rect width="24" height="16" fill="#012169" />
          <path d="M0 0 24 16M24 0 0 16" stroke="#ffffff" strokeWidth="3.2" />
          <path d="M0 0 24 16M24 0 0 16" stroke="#c8102e" strokeWidth="1.6" />
          <path d="M12 0V16M0 8H24" stroke="#ffffff" strokeWidth="5.3" />
          <path d="M12 0V16M0 8H24" stroke="#c8102e" strokeWidth="3.2" />
        </svg>
      );
    case 'es':
      return (
        <svg {...SVG_FLAG}>
          <rect width="24" height="16" fill="#aa151b" />
          <rect y="4" width="24" height="8" fill="#f1bf00" />
        </svg>
      );
    case 'pt':
      return (
        <svg {...SVG_FLAG}>
          <rect width="24" height="16" fill="#da291c" />
          <rect width="9.6" height="16" fill="#046a38" />
          <circle cx="9.6" cy="8" r="3.4" fill="#ffe900" />
          <circle cx="9.6" cy="8" r="1.6" fill="#da291c" />
        </svg>
      );
    case 'fr':
      return (
        <svg {...SVG_FLAG}>
          <rect width="8" height="16" fill="#002395" />
          <rect x="8" width="8" height="16" fill="#ffffff" />
          <rect x="16" width="8" height="16" fill="#ed2939" />
        </svg>
      );
    default:
      return null;
  }
}

/* Listbox dropdown built here because the codebase has no popover/menu
   primitive. The trigger shows the flag alone, so its accessible name carries
   both the control's purpose and the current endonym — a screen reader can tell
   which language is selected without opening the list. Every option shows the
   flag AND its native endonym: the open list is the only place a flag is
   unambiguous.

   Keyboard: ArrowDown/ArrowUp open the list (Enter/Space open it through the
   trigger's native button activation); once open, Arrow/Home/End move the
   active option, Enter/Space select and close, Escape closes and returns focus
   to the trigger, and Tab closes cleanly (focus is put back on the trigger
   before the default Tab action runs, so the browser tabs on from there). */
export default function LanguageMenu({ items, value, onChange, label }) {
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.key === value),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const optionRefs = useRef([]);

  const current = items[selectedIndex];

  // Focus follows the active option while the list is open.
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  // Dismiss on pointer-down outside. Focus is restored to the trigger; if the
  // click landed on a focusable element the browser then focuses that instead.
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (!rootRef.current?.contains(event.target)) close(true);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function close(restoreFocus) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function openMenu() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function choose(key) {
    onChange(key);
    close(true);
  }

  function onKeyDown(event) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((activeIndex + 1) % items.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((activeIndex - 1 + items.length) % items.length);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(items.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(items[activeIndex].key);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(true);
        break;
      default:
        break;
    }
  }

  return (
    <div className="language-menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="language-menu-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current ? current.label : value}`}
        onClick={() => (open ? close(true) : openMenu())}
      >
        <Flag locale={value} />
      </button>
      {open && (
        <ul className="language-menu-list" role="listbox" aria-label={label}>
          {items.map((item, index) => (
            <li
              key={item.key}
              role="option"
              aria-selected={item.key === value}
              tabIndex={-1}
              ref={(el) => { optionRefs.current[index] = el; }}
              className={`language-menu-option${index === activeIndex ? ' active' : ''}`}
              onClick={() => choose(item.key)}
            >
              <Flag locale={item.key} />
              <span className="language-menu-option-label">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
