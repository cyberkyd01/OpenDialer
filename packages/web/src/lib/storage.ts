/** localStorage wrapper that never throws (private mode, blocked storage). */
export const storage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  set(key: string, value: string | null) {
    try {
      if (value == null) globalThis.localStorage?.removeItem(key);
      else globalThis.localStorage?.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

export const KEYS = {
  token: 'opendialer.token',
  serverUrl: 'opendialer.serverUrl',
  theme: 'opendialer.theme',
  campaignId: 'opendialer.campaignId',
  simOutcomes: 'opendialer.simOutcomes',
  ringback: 'opendialer.ringback',
} as const;
