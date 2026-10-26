export function fmtDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function secondsSince(iso: string | number | null | undefined, now = Date.now()): number {
  if (iso == null) return 0;
  const t = typeof iso === 'number' ? iso : new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 1000));
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtTimeIn(tz: string | null | undefined, now = new Date()): string {
  if (!tz) return '';
  try {
    return now.toLocaleTimeString(undefined, { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function fmtPct(x: number): string {
  return `${Math.round((x || 0) * 1000) / 10}%`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO string / Date → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="date"> value for a Date (local). */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromLocalInput(v: string): string {
  return new Date(v).toISOString();
}

export function leadName(l: { firstName?: string; lastName?: string } | null | undefined): string {
  if (!l) return '';
  return [l.firstName, l.lastName].filter(Boolean).join(' ');
}

/** zod issues → { "field.path": "message" } for inline form errors. */
export function zodIssues(err: { issues: { path: PropertyKey[]; message: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.map(String).join('.') || '_';
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export const COUNTRIES: [string, string][] = [
  ['US', 'United States'], ['CA', 'Canada'], ['GB', 'United Kingdom'], ['IE', 'Ireland'], ['AU', 'Australia'],
  ['NZ', 'New Zealand'], ['DE', 'Germany'], ['FR', 'France'], ['ES', 'Spain'], ['IT', 'Italy'], ['NL', 'Netherlands'],
  ['BE', 'Belgium'], ['CH', 'Switzerland'], ['AT', 'Austria'], ['SE', 'Sweden'], ['NO', 'Norway'], ['DK', 'Denmark'],
  ['FI', 'Finland'], ['PL', 'Poland'], ['PT', 'Portugal'], ['GR', 'Greece'], ['RO', 'Romania'], ['CZ', 'Czechia'],
  ['TR', 'Türkiye'], ['IL', 'Israel'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['EG', 'Egypt'],
  ['ZA', 'South Africa'], ['NG', 'Nigeria'], ['KE', 'Kenya'], ['GH', 'Ghana'], ['IN', 'India'], ['PK', 'Pakistan'],
  ['BD', 'Bangladesh'], ['PH', 'Philippines'], ['ID', 'Indonesia'], ['MY', 'Malaysia'], ['SG', 'Singapore'],
  ['TH', 'Thailand'], ['VN', 'Vietnam'], ['CN', 'China'], ['HK', 'Hong Kong'], ['JP', 'Japan'], ['KR', 'South Korea'],
  ['MX', 'Mexico'], ['BR', 'Brazil'], ['AR', 'Argentina'], ['CO', 'Colombia'], ['CL', 'Chile'], ['PE', 'Peru'],
];

export function timeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const list = fn ? fn('timeZone') : [];
    return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    return ['UTC'];
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
