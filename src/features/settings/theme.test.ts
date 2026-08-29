import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyThemePreference, disposeThemeObserver } from './theme';

describe('theme preference', () => {
  afterEach(() => disposeThemeObserver());

  it.each(['dark', 'light'] as const)('applies the %s theme directly', (theme) => {
    applyThemePreference(theme);
    expect(document.documentElement.dataset.themePreference).toBe(theme);
    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it('follows system changes and disposes the observer', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    const removeEventListener = vi.fn();
    vi.mocked(window.matchMedia).mockReturnValue({
      matches: true,
      addEventListener: vi.fn((_type, next) => {
        listener = next as (event: MediaQueryListEvent) => void;
      }),
      removeEventListener,
    } as unknown as MediaQueryList);

    applyThemePreference('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
    listener?.({ matches: false } as MediaQueryListEvent);
    expect(document.documentElement.dataset.theme).toBe('light');

    disposeThemeObserver();
    expect(removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
