import { Moon, Sun } from 'lucide-preact';
import { useI18n } from '../../i18n';

export default function ThemeToggle({ theme, onToggle, className = 'site-nav-link', showLabel = false }) {
  const { t } = useI18n();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className={className}
      aria-label={showLabel ? undefined : t('settings.darkTheme')}
      title={t('settings.darkTheme')}
      aria-pressed={isDark}
      onClick={onToggle}
    >
      {isDark ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
      {showLabel ? t('settings.darkTheme') : null}
    </button>
  );
}
