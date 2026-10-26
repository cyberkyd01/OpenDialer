import { describe, expect, it } from 'vitest';
import { normalizePhone, formatPhone, phoneDigits } from './phone.js';
import { timezoneForPhone } from './areacodes.js';
import { isWithinCallingHours, localTimeIn, resolveLeadTimezone, isValidTimezone } from './hours.js';
import { renderScript } from './script.js';
import { campaignCreateSchema, campaignUpdateSchema, importMappingSchema, partialUpdate, settingsUpdateSchema, setupSchema, userUpdateSchema } from './schemas.js';
import { z } from 'zod';

describe('normalizePhone', () => {
  it('parses US national numbers with default country', () => {
    const r = normalizePhone('(415) 555-2671', 'US');
    expect(r.e164).toBe('+14155552671');
    expect(r.valid).toBe(true);
    expect(r.country).toBe('US');
  });
  it('parses international numbers regardless of default country', () => {
    expect(normalizePhone('+44 20 7946 0958', 'US').e164).toBe('+442079460958');
    expect(normalizePhone('0049 30 1234567', 'DE').e164).toBe('+49301234567');
  });
  it('rejects garbage', () => {
    expect(normalizePhone('hello', 'US').e164).toBeNull();
    expect(normalizePhone('', 'US').valid).toBe(false);
    expect(normalizePhone('123', 'US').valid).toBe(false);
  });
  it('strips tel: prefixes and odd punctuation', () => {
    expect(normalizePhone('tel:415.555.2671', 'US').e164).toBe('+14155552671');
  });
  it('formats for display', () => {
    expect(formatPhone('+14155552671')).toBe('(415) 555-2671');
    expect(formatPhone('+442079460958')).toBe('+44 20 7946 0958');
    expect(formatPhone(null)).toBe('');
    expect(phoneDigits('+1 (415) 555-2671')).toBe('14155552671');
  });
});

describe('timezoneForPhone', () => {
  it('maps NANP area codes', () => {
    expect(timezoneForPhone('+14155552671')).toBe('America/Los_Angeles');
    expect(timezoneForPhone('+12125551234')).toBe('America/New_York');
    expect(timezoneForPhone('+13125551234')).toBe('America/Chicago');
    expect(timezoneForPhone('+14165551234')).toBe('America/Toronto');
    expect(timezoneForPhone('+18005551234')).toBeNull();
    expect(timezoneForPhone('+442079460958')).toBeNull();
    expect(timezoneForPhone(null)).toBeNull();
  });
});

describe('calling hours', () => {
  const window = { callingHoursStart: '09:00', callingHoursEnd: '20:00', callingDays: [1, 2, 3, 4, 5] };
  it('respects the lead time zone', () => {
    // 2026-03-04 is a Wednesday. 17:30 UTC = 12:30 New York, 09:30 Los Angeles, 02:30 Tokyo (Thu)
    const at = new Date('2026-03-04T17:30:00Z');
    expect(isWithinCallingHours(window, 'America/New_York', at)).toBe(true);
    expect(isWithinCallingHours(window, 'America/Los_Angeles', at)).toBe(true);
    expect(isWithinCallingHours(window, 'Asia/Tokyo', at)).toBe(false);
  });
  it('excludes weekends', () => {
    const sat = new Date('2026-03-07T17:30:00Z');
    expect(isWithinCallingHours(window, 'America/New_York', sat)).toBe(false);
  });
  it('end is exclusive, start inclusive', () => {
    const w = { ...window, callingHoursStart: '09:00', callingHoursEnd: '12:30' };
    expect(isWithinCallingHours(w, 'UTC', new Date('2026-03-04T09:00:00Z'))).toBe(true);
    expect(isWithinCallingHours(w, 'UTC', new Date('2026-03-04T12:30:00Z'))).toBe(false);
    expect(isWithinCallingHours(w, 'UTC', new Date('2026-03-04T12:29:00Z'))).toBe(true);
  });
  it('supports overnight windows and 24h windows', () => {
    const night = { ...window, callingHoursStart: '20:00', callingHoursEnd: '02:00', callingDays: [0, 1, 2, 3, 4, 5, 6] };
    expect(isWithinCallingHours(night, 'UTC', new Date('2026-03-04T23:00:00Z'))).toBe(true);
    expect(isWithinCallingHours(night, 'UTC', new Date('2026-03-04T01:00:00Z'))).toBe(true);
    expect(isWithinCallingHours(night, 'UTC', new Date('2026-03-04T12:00:00Z'))).toBe(false);
    const all = { ...night, callingHoursStart: '00:00', callingHoursEnd: '00:00' };
    expect(isWithinCallingHours(all, 'UTC', new Date('2026-03-04T12:00:00Z'))).toBe(true);
  });
  it('handles midnight hour (h23) correctly', () => {
    const t = localTimeIn('UTC', new Date('2026-03-04T00:05:00Z'));
    expect(t.hour).toBe(0);
    expect(t.minute).toBe(5);
    expect(t.weekday).toBe(3);
  });
  it('falls back for invalid zones', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(localTimeIn('Mars/Olympus', new Date('2026-03-04T10:00:00Z')).hour).toBe(10);
  });
  it('resolves lead tz by precedence', () => {
    const base = { timezoneMode: 'lead' as const, fixedTimezone: 'Europe/London', defaultTimezone: 'UTC' };
    expect(resolveLeadTimezone({ ...base, leadTimezone: 'Asia/Tokyo', phoneTimezone: 'America/Chicago' })).toBe('Asia/Tokyo');
    expect(resolveLeadTimezone({ ...base, leadTimezone: null, phoneTimezone: 'America/Chicago' })).toBe('America/Chicago');
    expect(resolveLeadTimezone({ ...base, leadTimezone: 'Bad/Zone', phoneTimezone: null })).toBe('Europe/London');
    expect(resolveLeadTimezone({ ...base, timezoneMode: 'fixed', leadTimezone: 'Asia/Tokyo', phoneTimezone: null })).toBe('Europe/London');
  });
});

describe('renderScript', () => {
  it('substitutes placeholders in any casing', () => {
    const out = renderScript('Hi {{first_name}} {{ LastName }} from {{company}}, I am {{agent_name}} at {{company_name}}. {{custom.plan}} {{unknown}}', {
      lead: { firstName: 'Ada', lastName: 'Lovelace', company: 'Analytical', custom: { plan: 'Gold' } },
      agentName: 'Sam',
      companyName: 'OpenDialer',
    });
    expect(out).toBe('Hi Ada Lovelace from Analytical, I am Sam at OpenDialer. Gold ');
  });
});

describe('schemas', () => {
  it('applies campaign defaults', () => {
    const c = campaignCreateSchema.parse({ name: 'Test' });
    expect(c.dialMode).toBe('preview');
    expect(c.callingDays).toEqual([1, 2, 3, 4, 5]);
    expect(c.maxAttempts).toBe(3);
  });
  it('rejects bad hours', () => {
    expect(() => campaignCreateSchema.parse({ name: 'x', callingHoursStart: '25:00' })).toThrow();
  });
  it('validates setup', () => {
    expect(() => setupSchema.parse({ username: 'ad min', password: 'password123', displayName: 'A' })).toThrow();
    expect(setupSchema.parse({ username: 'admin', password: 'password123', displayName: 'A' }).companyName).toBe('OpenDialer');
  });
  it('update schemas never re-apply create defaults (omitted = unchanged)', () => {
    expect(campaignUpdateSchema.parse({ scriptId: 3 })).toEqual({ scriptId: 3 });
    expect(userUpdateSchema.parse({ sipUsername: '1001' })).toEqual({ sipUsername: '1001' });
    expect(settingsUpdateSchema.parse({ telephony: { wssUrl: 'wss://x' } })).toEqual({ telephony: { wssUrl: 'wss://x' } });
    // validation still applies to the fields that are sent
    expect(() => campaignUpdateSchema.parse({ callingHoursStart: '99:00' })).toThrow();
    expect(() => userUpdateSchema.parse({ password: 'short' })).toThrow();
    const s = partialUpdate(z.object({ a: z.string().default('x'), b: z.number().nullable().default(null), c: z.string() }));
    expect(s.parse({})).toEqual({});
    expect(s.parse({ b: null, c: 'y' })).toEqual({ b: null, c: 'y' });
  });
  it('import mapping requires phone', () => {
    expect(() => importMappingSchema.parse({})).toThrow();
    expect(importMappingSchema.parse({ phone: 'Phone' }).dedupeAgainst).toBe('campaign');
  });
});
