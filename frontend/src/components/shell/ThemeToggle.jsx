import { useState } from 'preact/hooks';
import { Moon, Sun } from 'lucide-preact';
import { useI18n } from '../../i18n';
import { getTheme, setTheme } from '../../lib/theme';

export default function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setThemeState] = useState(getTheme);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="site-nav-link"
      aria-label={t('settings.darkTheme')}
      title={t('settings.darkTheme')}
      aria-pressed={isDark}
      onClick={() => setThemeState(setTheme(isDark ? 'light' : 'dark'))}
    >
      {isDark ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    </button>
  );
}
