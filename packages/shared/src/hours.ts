/**
 * Calling-hours compliance helpers. Everything is evaluated in the lead's
 * local time zone so a 9:00–20:00 window means 9–20 *for the person called*.
 */

export interface CallingWindow {
  callingHoursStart: string; // HH:MM
  callingHoursEnd: string; // HH:MM
  callingDays: number[]; // 0..6
}

export interface LocalTime {
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimezone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local wall-clock time of `date` in `tz`. Falls back to UTC for invalid zones. */
export function localTimeIn(tz: string, date: Date = new Date()): LocalTime {
  const zone = isValidTimezone(tz) ? tz : 'UTC';
  let fmt = fmtCache.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    });
    fmtCache.set(zone, fmt);
  }
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const hour = Number(get('hour')) % 24;
  return {
    hour,
    minute: Number(get('minute')),
    weekday: Math.max(0, weekdays.indexOf(get('weekday'))),
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * True when `date` falls inside the campaign's calling window in `tz`.
 * Supports overnight windows (e.g. 20:00 → 02:00).
 */
export function isWithinCallingHours(window: CallingWindow, tz: string, date: Date = new Date()): boolean {
  const local = localTimeIn(tz, date);
  if (!window.callingDays.includes(local.weekday)) return false;
  const now = local.hour * 60 + local.minute;
  const start = toMinutes(window.callingHoursStart);
  const end = toMinutes(window.callingHoursEnd);
  if (start === end) return true; // 24h
  if (start < end) return now >= start && now < end;
  return now >= start || now < end; // overnight
}

/** Resolve the zone used for a lead: explicit > derived from phone > campaign fixed > server default. */
export function resolveLeadTimezone(opts: {
  leadTimezone: string | null | undefined;
  phoneTimezone: string | null | undefined;
  timezoneMode: 'lead' | 'fixed';
  fixedTimezone: string;
  defaultTimezone: string;
}): string {
  if (opts.timezoneMode === 'fixed' && isValidTimezone(opts.fixedTimezone)) return opts.fixedTimezone;
  if (isValidTimezone(opts.leadTimezone)) return opts.leadTimezone as string;
  if (isValidTimezone(opts.phoneTimezone)) return opts.phoneTimezone as string;
  if (isValidTimezone(opts.fixedTimezone)) return opts.fixedTimezone;
  return isValidTimezone(opts.defaultTimezone) ? opts.defaultTimezone : 'UTC';
}
