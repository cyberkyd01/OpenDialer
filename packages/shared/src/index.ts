export * from './types.js';
export * from './events.js';
export * from './schemas.js';
export * from './phone.js';
export * from './areacodes.js';
export * from './hours.js';
export * from './script.js';

export const AGENT_STATES = ['offline', 'ready', 'assigned', 'dialing', 'talking', 'wrapup', 'paused'] as const;

/** Dispositions seeded on first run. `system` ones cannot be deleted. */
export const DEFAULT_DISPOSITIONS = [
  { code: 'SALE', label: 'Sale / Converted', category: 'contact', retryMinutes: null, countsAsContact: true, isSale: true, color: '#16a34a', sortOrder: 10 },
  { code: 'INTERESTED', label: 'Interested – follow up', category: 'contact', retryMinutes: 1440, countsAsContact: true, isSale: false, color: '#2563eb', sortOrder: 20 },
  { code: 'NOT_INTERESTED', label: 'Not interested', category: 'contact', retryMinutes: null, countsAsContact: true, isSale: false, color: '#737373', sortOrder: 30 },
  { code: 'CALLBACK', label: 'Callback scheduled', category: 'callback', retryMinutes: null, countsAsContact: true, isSale: false, color: '#9333ea', sortOrder: 40 },
  { code: 'NO_ANSWER', label: 'No answer', category: 'no_contact', retryMinutes: 240, countsAsContact: false, isSale: false, color: '#f59e0b', sortOrder: 50 },
  { code: 'BUSY', label: 'Busy', category: 'no_contact', retryMinutes: 60, countsAsContact: false, isSale: false, color: '#f97316', sortOrder: 60 },
  { code: 'VOICEMAIL', label: 'Voicemail', category: 'no_contact', retryMinutes: 480, countsAsContact: false, isSale: false, color: '#eab308', sortOrder: 70 },
  { code: 'WRONG_NUMBER', label: 'Wrong number', category: 'invalid', retryMinutes: null, countsAsContact: false, isSale: false, color: '#78716c', sortOrder: 80 },
  { code: 'DISCONNECTED', label: 'Number disconnected', category: 'invalid', retryMinutes: null, countsAsContact: false, isSale: false, color: '#57534e', sortOrder: 90 },
  { code: 'DNC', label: 'Do not call', category: 'dnc', retryMinutes: null, countsAsContact: true, isSale: false, color: '#dc2626', sortOrder: 100 },
] as const;

export const DEFAULT_PAUSE_CODES = ['Break', 'Lunch', 'Meeting', 'Training', 'Admin work'];
