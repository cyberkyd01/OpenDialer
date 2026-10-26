import { useSyncExternalStore } from 'react';
import { KEYS, storage } from './storage';

export type ThemeChoice = 'light' | 'dark' | 'system';

const listeners = new Set<() => void>();

export function getTheme(): ThemeChoice {
  const v = storage.get(KEYS.theme);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyTheme(choice: ThemeChoice = getTheme()) {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  const dark =
    choice === 'dark' || (choice === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#0f766e');
}

export function setTheme(choice: ThemeChoice) {
  storage.set(KEYS.theme, choice === 'system' ? null : choice);
  applyTheme(choice);
  listeners.forEach((l) => l());
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getTheme,
    getTheme,
  );
}
