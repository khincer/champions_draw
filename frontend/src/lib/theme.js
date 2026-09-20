// Theme preference, persisted over a key that collides with no prediction or
// career key. The same rule is inlined in frontend/index.html so the theme
// applies before first paint.
export const THEME_KEY = 'champions_draw_theme';

const LIGHT = 'light';
const DARK = 'dark';

export function getTheme() {
  try {
    return window.localStorage.getItem(THEME_KEY) === DARK ? DARK : LIGHT;
  } catch {
    return LIGHT;
  }
}

export function applyTheme(theme) {
  const next = theme === DARK ? DARK : LIGHT;
  document.documentElement.dataset.theme = next;
  document.documentElement.style.colorScheme = next;
  return next;
}

export function setTheme(theme) {
  const next = applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_KEY, next);
  } catch {
    // Storage unavailable (private mode) — the theme still applies for this session.
  }
  return next;
}
