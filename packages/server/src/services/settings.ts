import { DEFAULT_PAUSE_CODES, settingsSchema, type Settings } from '@opendialer/shared';
import type { DB } from '../db.js';

export const DEFAULT_SETTINGS: Settings = {
  companyName: 'OpenDialer',
  telephony: {
    mode: 'sim',
    wssUrl: '',
    sipDomain: '',
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    register: true,
    ringTimeoutSec: 45,
  },
  defaultCountry: 'US',
  defaultTimezone: 'UTC',
  recordingConsentNotice: 'This call may be recorded for quality and training purposes.',
  pauseCodes: [...DEFAULT_PAUSE_CODES],
  maxAttemptsPerDay: 3,
  requireConsentFlag: false,
};

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = cur && typeof cur === 'object' && !Array.isArray(cur) && v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

export function getSettings(db: DB): Settings {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined;
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try {
    const parsed = settingsSchema.safeParse(deepMerge(DEFAULT_SETTINGS, JSON.parse(row.value)));
    return parsed.success ? parsed.data : structuredClone(DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function updateSettings(db: DB, patch: unknown): Settings {
  const merged = settingsSchema.parse(deepMerge(getSettings(db), patch));
  db.prepare(`INSERT INTO settings (key, value) VALUES ('app', @v) ON CONFLICT(key) DO UPDATE SET value = @v`).run({
    v: JSON.stringify(merged),
  });
  return merged;
}
