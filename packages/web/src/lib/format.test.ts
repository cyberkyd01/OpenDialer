import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtPct, fromLocalInput, leadName, secondsSince, toLocalInput, zodIssues } from './format';

describe('format helpers', () => {
  it('fmtDuration', () => {
    expect(fmtDuration(0)).toBe('0:00');
    expect(fmtDuration(65)).toBe('1:05');
    expect(fmtDuration(3600 + 61)).toBe('1:01:01');
    expect(fmtDuration(-5)).toBe('0:00');
  });
  it('secondsSince', () => {
    expect(secondsSince('2026-01-01T00:00:00.000Z', Date.parse('2026-01-01T00:01:30.000Z'))).toBe(90);
    expect(secondsSince(null)).toBe(0);
    expect(secondsSince('2026-01-01T00:00:10Z', Date.parse('2026-01-01T00:00:00Z'))).toBe(0);
  });
  it('fmtPct / leadName', () => {
    expect(fmtPct(0.1234)).toBe('12.3%');
    expect(leadName({ firstName: 'Ann', lastName: '' })).toBe('Ann');
    expect(leadName(null)).toBe('');
  });
  it('toLocalInput round-trips through Date', () => {
    const d = new Date(2026, 4, 7, 9, 5);
    expect(toLocalInput(d)).toBe('2026-05-07T09:05');
    expect(fromLocalInput(toLocalInput(d))).toBe(d.toISOString());
  });
  it('zodIssues keeps the first message per path', () => {
    expect(zodIssues({ issues: [{ path: ['name'], message: 'A' }, { path: ['name'], message: 'B' }, { path: [], message: 'C' }] })).toEqual({ name: 'A', _: 'C' });
  });
});
