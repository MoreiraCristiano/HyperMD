import type { ResolvedTheme, ThemePreference } from './settingsTypes';

let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null;

function setResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.dataset.theme = theme;
}

export function disposeThemeObserver(): void {
  if (mediaQuery && mediaListener) mediaQuery.removeEventListener('change', mediaListener);
  mediaQuery = null;
  mediaListener = null;
}

export function applyThemePreference(preference: ThemePreference): void {
  disposeThemeObserver();
  document.documentElement.dataset.themePreference = preference;

  if (preference !== 'system') {
    setResolvedTheme(preference);
    return;
  }

  if (typeof window.matchMedia !== 'function') {
    setResolvedTheme('dark');
    return;
  }

  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  setResolvedTheme(mediaQuery.matches ? 'dark' : 'light');
  mediaListener = (event) => setResolvedTheme(event.matches ? 'dark' : 'light');
  mediaQuery.addEventListener('change', mediaListener);
}
