import { useState } from 'preact/hooks';
import { Moon, Sun } from 'lucide-preact';
import { getTheme, setTheme } from '../../lib/theme';

// Theme switch: applies immediately and persists over `champions_draw_theme`.
// Local state only — toggling never touches `view`/`activeTab`, so no view
// remounts and no in-flight fetch is restarted.
export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="site-nav-link"
      aria-pressed={isDark}
      onClick={() => setThemeState(setTheme(isDark ? 'light' : 'dark'))}
    >
      {isDark ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
      Dark theme
    </button>
  );
}
