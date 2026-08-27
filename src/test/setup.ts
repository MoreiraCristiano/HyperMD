import '@testing-library/jest-dom/vitest';
import '@testing-library/svelte/vitest';
import { afterEach, vi } from 'vitest';
import { resetTauriMocks } from './tauriMocks';

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  value: ResizeObserverStub,
});

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [],
});

Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }),
});

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

resetTauriMocks();

afterEach(() => {
  resetTauriMocks();
  localStorage.clear();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-editor-word-wrap');
  vi.useRealTimers();
});
