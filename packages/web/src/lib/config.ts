import { KEYS, storage } from './storage';

/** Strip trailing slashes; assume https when no scheme is given. */
export function normalizeServerUrl(raw: string): string {
  const s = raw.trim().replace(/\/+$/, '');
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) return 'https://' + s;
  return s;
}

export function currentOrigin(): string {
  return globalThis.location?.origin ?? '';
}

/**
 * Server base URL. Priority: ?server= query param (persisted) → localStorage → current origin.
 * An empty string means "same origin".
 */
export function getServerUrl(): string {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('server');
    if (q) {
      const n = normalizeServerUrl(q);
      storage.set(KEYS.serverUrl, n === currentOrigin() ? null : n);
      return n === currentOrigin() ? '' : n;
    }
  } catch {
    /* ignore */
  }
  const stored = storage.get(KEYS.serverUrl);
  if (stored && stored !== currentOrigin()) return stored;
  return '';
}

export function setServerUrl(url: string) {
  const n = normalizeServerUrl(url);
  storage.set(KEYS.serverUrl, !n || n === currentOrigin() ? null : n);
}

/** Absolute server URL for display (current origin when same-origin). */
export function displayServerUrl(): string {
  return getServerUrl() || currentOrigin();
}

export const getToken = () => storage.get(KEYS.token);
export const setToken = (t: string | null) => storage.set(KEYS.token, t);
