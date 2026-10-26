import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SipCredentials } from '@opendialer/shared';
import { SimPhone } from './SimPhone';
import { causeFromSipCode } from './types';

const creds: SipCredentials = {
  mode: 'sim',
  wssUrl: '',
  sipDomain: '',
  username: '',
  authUsername: '',
  password: '',
  displayName: 'Test',
  iceServers: [],
  register: false,
  ringTimeoutSec: 30,
};

function record(phone: SimPhone) {
  const events: string[] = [];
  phone.on('ringing', () => events.push('ringing'));
  phone.on('answered', () => events.push('answered'));
  phone.on('ended', (p) => events.push(`ended:${p.cause}`));
  return events;
}

describe('SimPhone', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    SimPhone.setOutcomes([]);
  });
  afterEach(() => vi.useRealTimers());

  it('reports Simulated status on connect', async () => {
    const p = new SimPhone();
    const reg = vi.fn();
    p.on('registered', reg);
    await p.connect(creds);
    expect(p.status).toBe('simulated');
    expect(reg).toHaveBeenCalledOnce();
  });

  it('rings immediately, answers after the delay and stays up until hangup', async () => {
    const p = new SimPhone();
    p.ringback = false;
    await p.connect(creds);
    const events = record(p);
    SimPhone.setOutcomes([{ outcome: 'answer', delayMs: 1500 }]);
    await p.dial('+14155550101');
    expect(events).toEqual(['ringing']);
    expect(p.callState).toBe('ringing');
    vi.advanceTimersByTime(1499);
    expect(events).toEqual(['ringing']);
    vi.advanceTimersByTime(1);
    expect(events).toEqual(['ringing', 'answered']);
    expect(p.callState).toBe('talking');
    vi.advanceTimersByTime(60_000);
    expect(p.callState).toBe('talking');
    p.hangup();
    expect(events).toEqual(['ringing', 'answered', 'ended:normal']);
    expect(p.callState).toBe('idle');
  });

  it('busy and no-answer outcomes end with the right cause', async () => {
    const p = new SimPhone();
    p.ringback = false;
    await p.connect(creds);
    const events = record(p);
    SimPhone.setOutcomes(['busy', 'no-answer']);
    await p.dial('1');
    vi.advanceTimersByTime(3000);
    expect(events).toEqual(['ringing', 'ended:busy']);
    await p.dial('2');
    // no-answer waits the ring timeout capped at 6 s
    vi.advanceTimersByTime(5999);
    expect(events.at(-1)).toBe('ringing');
    vi.advanceTimersByTime(1);
    expect(events.at(-1)).toBe('ended:no-answer');
  });

  it('hangup while ringing is "cancelled" and no late answer follows', async () => {
    const p = new SimPhone();
    p.ringback = false;
    await p.connect(creds);
    const events = record(p);
    SimPhone.setOutcomes([{ outcome: 'answer', delayMs: 1000 }]);
    await p.dial('1');
    p.hangup();
    vi.advanceTimersByTime(5000);
    expect(events).toEqual(['ringing', 'ended:cancelled']);
  });

  it('reads queued outcomes from localStorage (e2e hook) and consumes them', async () => {
    const p = new SimPhone();
    p.ringback = false;
    await p.connect(creds);
    const events = record(p);
    localStorage.setItem('opendialer.simOutcomes', JSON.stringify([{ outcome: 'failed', delayMs: 10 }, 'answer']));
    await p.dial('1');
    vi.advanceTimersByTime(10);
    expect(events).toEqual(['ringing', 'ended:failed']);
    expect(JSON.parse(localStorage.getItem('opendialer.simOutcomes')!)).toEqual(['answer']);
  });

  it('random outcome distribution uses the injected RNG', async () => {
    const p = new SimPhone();
    p.ringback = false;
    await p.connect(creds);
    const events = record(p);
    p.random = () => 0.75; // busy band (0.7–0.8)
    await p.dial('1');
    vi.advanceTimersByTime(4000);
    expect(events).toEqual(['ringing', 'ended:busy']);
  });

  it('refuses a second dial while a call is up; mute/hold/dtmf/transfer work while talking', async () => {
    const p = new SimPhone();
    p.ringback = false;
    await p.connect(creds);
    const events = record(p);
    SimPhone.setOutcomes([{ outcome: 'answer', delayMs: 0 }]);
    await p.dial('1');
    await expect(p.dial('2')).rejects.toThrow(/already/);
    vi.advanceTimersByTime(0);
    p.mute(true);
    expect(p.muted).toBe(true);
    await p.hold(true);
    expect(p.held).toBe(true);
    p.sendDtmf('12#');
    expect(p.dtmfSent).toBe('12#');
    await p.transfer('2001');
    expect(events.at(-1)).toBe('ended:normal');
    expect(p.muted).toBe(false);
  });
});

describe('causeFromSipCode', () => {
  it('maps SIP response codes to server causes', () => {
    expect(causeFromSipCode(486)).toBe('busy');
    expect(causeFromSipCode(600)).toBe('busy');
    expect(causeFromSipCode(480)).toBe('no-answer');
    expect(causeFromSipCode(408)).toBe('no-answer');
    expect(causeFromSipCode(487)).toBe('cancelled');
    expect(causeFromSipCode(404)).toBe('failed');
    expect(causeFromSipCode(503)).toBe('failed');
    expect(causeFromSipCode(603)).toBe('failed');
    expect(causeFromSipCode(null)).toBe('failed');
  });
});
