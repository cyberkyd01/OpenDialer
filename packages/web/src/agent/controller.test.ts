import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { Ack, AgentStatePayload, Campaign, Lead, LeadAssignedPayload, SipCredentials } from '@opendialer/shared';
import { SimPhone } from '../phone/SimPhone';
import { AgentController } from './controller';
import { useAgent, type JoinedCampaign } from './store';

type Responder = (event: string, payload: any) => Ack<any>;

class FakeSocket {
  connected = true;
  handlers = new Map<string, ((...a: any[]) => void)[]>();
  emitted: { event: string; payload: any }[] = [];
  constructor(public respond: Responder) {}
  off(ev: string, fn: (...a: any[]) => void) {
    this.handlers.set(ev, (this.handlers.get(ev) ?? []).filter((f) => f !== fn));
    return this;
  }
  on(ev: string, fn: (...a: any[]) => void) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this;
  }
  timeout() {
    return {
      emit: (event: string, payload: any, cb: (err: Error | null, r: Ack<any>) => void) => {
        this.emitted.push({ event, payload });
        const r = this.respond(event, payload);
        queueMicrotask(() => cb(null, r));
      },
    };
  }
  fire(ev: string, payload?: any) {
    for (const fn of this.handlers.get(ev) ?? []) fn(payload);
  }
  disconnect() {
    this.connected = false;
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  events(name: string) {
    return this.emitted.filter((e) => e.event === name).map((e) => e.payload);
  }
}

const creds: SipCredentials = { mode: 'sim', wssUrl: '', sipDomain: '', username: '', authUsername: '', password: '', displayName: 'A', iceServers: [], register: false, ringTimeoutSec: 30 };

const campaign = {
  id: 1,
  name: 'C1',
  status: 'active',
  dialMode: 'preview',
  recording: 'off',
  previewTimeoutSec: 0,
  wrapupTimeoutSec: 0,
  dialPrefix: '',
  script: null,
} as unknown as JoinedCampaign;

const lead = { id: 7, phone: '+14155550101', firstName: 'Ann', lastName: 'Lee', custom: {}, notes: '', attempts: 0, status: 'in_progress' } as unknown as Lead;

const state = (s: AgentStatePayload['state'], extra: Partial<AgentStatePayload> = {}): AgentStatePayload => ({
  state: s,
  pauseCode: null,
  campaignId: 1,
  since: new Date().toISOString(),
  leadId: null,
  callId: null,
  wrapupTimeoutSec: 0,
  ...extra,
});

const assigned = (extra: Partial<LeadAssignedPayload> = {}): LeadAssignedPayload => ({
  lead,
  campaign: campaign as Campaign,
  script: null,
  autoDial: false,
  callback: null,
  dialString: '9' + lead.phone,
  previewTimeoutSec: 0,
  ...extra,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function setup(respond?: Responder) {
  const phone = new SimPhone();
  phone.ringback = false;
  const notify = vi.fn();
  let sock!: FakeSocket;
  let sockets = 0;
  const ctrl = new AgentController({
    socketFactory: () => {
      sock = new FakeSocket(
        respond ??
          ((ev) => {
            if (ev === 'agent:join') return { ok: true, data: state('paused') };
            if (ev === 'agent:ready') return { ok: true, data: state('ready') };
            if (ev === 'lead:dial') return { ok: true, data: { callId: 99 } };
            return { ok: true };
          }),
      );
      sockets += 1;
      setTimeout(() => sock.fire('connect'), 0); // the real socket connects asynchronously
      return sock as unknown as Socket;
    },
    phoneFactory: async () => phone,
    loadCredentials: async () => creds,
    loadCampaign: async () => campaign,
    notify,
  });
  await ctrl.start();
  await flush();
  return {
    ctrl,
    get sock() {
      return sock;
    },
    phone,
    notify,
    sockets: () => sockets,
  };
}

describe('AgentController', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    SimPhone.setOutcomes([]);
  });
  afterEach(() => vi.useRealTimers());

  it('joins, goes ready and shows the assigned preview lead', async () => {
    const s = await setup();
    expect(useAgent.getState().phoneStatus).toBe('simulated');
    expect(s.sockets()).toBe(0); // no socket until the agent joins
    expect(await s.ctrl.join(1)).toBe(true);
    expect(s.sockets()).toBe(1);
    expect(useAgent.getState().joined).toBe(true);
    expect(useAgent.getState().agent?.state).toBe('paused');
    expect(useAgent.getState().campaign?.name).toBe('C1');
    expect(sessionStorage.getItem('opendialer.joinedCampaign')).toBe('1');

    await s.ctrl.ready();
    s.sock.fire('agent:state', state('assigned', { leadId: 7 }));
    s.sock.fire('lead:assigned', assigned());
    expect(useAgent.getState().lead?.id).toBe(7);
    expect(s.sock.events('lead:dial')).toHaveLength(0); // preview: waits for the agent
    s.ctrl.stop();
  });

  it('runs a full call: lead:dial → ringing → answered → hangup → ended(normal) → dispose', async () => {
    const s = await setup();
    await s.ctrl.join(1);
    s.sock.fire('agent:state', state('assigned', { leadId: 7 }));
    s.sock.fire('lead:assigned', assigned());
    SimPhone.setOutcomes([{ outcome: 'answer', delayMs: 5 }]);

    await s.ctrl.dialAssigned();
    expect(s.sock.events('lead:dial')).toEqual([{ leadId: 7 }]);
    expect(s.phone.lastDialed).toBe('9+14155550101');
    expect(useAgent.getState().call?.phase).toBe('ringing');
    s.sock.fire('agent:state', state('dialing', { leadId: 7, callId: 99 }));

    await new Promise((r) => setTimeout(r, 20));
    expect(useAgent.getState().call?.phase).toBe('talking');
    s.sock.fire('agent:state', state('talking', { leadId: 7, callId: 99 }));

    s.ctrl.hangup();
    expect(useAgent.getState().call?.phase).toBe('ended');
    expect(s.sock.events('call:update')).toEqual([
      { callId: 99, state: 'ringing' },
      { callId: 99, state: 'answered', providerCallId: expect.stringMatching(/^sim-/) },
      { callId: 99, state: 'ended', cause: 'normal', providerCallId: expect.stringMatching(/^sim-/) },
    ]);
    s.sock.fire('agent:state', state('wrapup', { leadId: 7, callId: 99 }));

    expect(await s.ctrl.dispose({ dispositionId: 2, notes: 'great', pauseAfter: null })).toBe(true);
    expect(s.sock.events('call:dispose')).toEqual([{ callId: 99, dispositionId: 2, notes: 'great', pauseAfter: null }]);
    s.sock.fire('agent:state', state('ready'));
    expect(useAgent.getState().call).toBeNull();
    expect(useAgent.getState().lead).toBeNull();
    s.ctrl.stop();
  });

  it('progressive mode dials automatically once, even when the assignment is re-sent', async () => {
    const s = await setup();
    await s.ctrl.join(1);
    SimPhone.setOutcomes([{ outcome: 'answer', delayMs: 1000 }]);
    s.sock.fire('agent:state', state('assigned', { leadId: 7 }));
    s.sock.fire('lead:assigned', assigned({ autoDial: true }));
    s.sock.fire('lead:assigned', assigned({ autoDial: true }));
    await flush();
    await flush();
    expect(s.sock.events('lead:dial')).toHaveLength(1);
    s.ctrl.hangup();
    s.ctrl.stop();
  });

  it('busy outcome ends the call with cause "busy"', async () => {
    const s = await setup();
    await s.ctrl.join(1);
    s.sock.fire('agent:state', state('assigned', { leadId: 7 }));
    s.sock.fire('lead:assigned', assigned());
    SimPhone.setOutcomes([{ outcome: 'busy', delayMs: 1 }]);
    await s.ctrl.dialAssigned();
    await new Promise((r) => setTimeout(r, 15));
    expect(s.sock.events('call:update').at(-1)).toMatchObject({ state: 'ended', cause: 'busy' });
    expect(useAgent.getState().call?.cause).toBe('busy');
    s.ctrl.stop();
  });

  it('manual dial returns the server refusal message (e.g. DNC)', async () => {
    const s = await setup((ev) => {
      if (ev === 'agent:join') return { ok: true, data: state('paused') };
      if (ev === 'manual:dial') return { ok: false, error: 'Number is on the do-not-call list' };
      return { ok: true };
    });
    await s.ctrl.join(1);
    expect(await s.ctrl.manualDial('+14155550199')).toBe('Number is on the do-not-call list');
    expect(useAgent.getState().call).toBeNull();
    s.ctrl.stop();
  });

  it('pause while busy is remembered as pending until the server pauses', async () => {
    const s = await setup((ev) => {
      if (ev === 'agent:join') return { ok: true, data: state('paused') };
      if (ev === 'agent:pause') return { ok: true, data: state('talking', { callId: 99 }) };
      return { ok: true };
    });
    await s.ctrl.join(1);
    await s.ctrl.pause('Lunch');
    expect(useAgent.getState().pendingPause).toBe('Lunch');
    s.sock.fire('agent:state', state('paused', { pauseCode: 'Lunch' }));
    expect(useAgent.getState().pendingPause).toBeNull();
    s.ctrl.stop();
  });

  it('session:replaced stops the phone and marks the console', async () => {
    const s = await setup();
    await s.ctrl.join(1);
    s.sock.fire('session:replaced');
    expect(useAgent.getState().connection).toBe('replaced');
    expect(s.phone.status).toBe('disconnected');
    expect(s.sock.connected).toBe(false);
    s.ctrl.stop();
  });

  it('an ack saying this tab is no longer the agent console shows the replaced state', async () => {
    const s = await setup((ev) => {
      if (ev === 'agent:join') return { ok: true, data: state('paused') };
      if (ev === 'agent:ready') return { ok: false, error: 'This tab is no longer the active agent console – join again' };
      return { ok: true };
    });
    await s.ctrl.join(1);
    await s.ctrl.ready();
    expect(useAgent.getState().connection).toBe('replaced');
    expect(s.phone.status).toBe('disconnected');
    s.ctrl.stop();
  });

  it('leaving closes the socket; joining again opens a new one', async () => {
    const s = await setup();
    await s.ctrl.join(1);
    await s.ctrl.leave();
    expect(s.sock.connected).toBe(false);
    expect(useAgent.getState().connection).toBe('idle');
    await s.ctrl.join(1);
    expect(s.sockets()).toBe(2);
    s.ctrl.stop();
  });

  it('re-joins the stored campaign after a reconnect and restores Ready', async () => {
    const s = await setup((ev) => {
      if (ev === 'agent:join') return { ok: true, data: state('paused') };
      if (ev === 'agent:ready') return { ok: true, data: state('ready') };
      return { ok: true };
    });
    await s.ctrl.join(1);
    await s.ctrl.ready();
    expect(useAgent.getState().agent?.state).toBe('ready');
    s.sock.fire('disconnect', 'transport close');
    expect(useAgent.getState().connection).toBe('reconnecting');
    s.sock.fire('connect');
    await flush();
    await flush();
    expect(s.sock.events('agent:join')).toEqual([{ campaignId: 1 }, { campaignId: 1 }]);
    expect(s.sock.events('agent:ready')).toHaveLength(2);
    s.ctrl.stop();
  });
});
