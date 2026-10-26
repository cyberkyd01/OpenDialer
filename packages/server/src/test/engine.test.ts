import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DISCONNECT_GRACE_MS } from '../engine.js';
import { connectAgent, createAgent, createCampaignWithLeads, runCall, setupAdmin, sleep, startTestServer, type AgentClient, type TestServer } from './helpers.js';

let t: TestServer;
let admin: string;
let dispositions: Record<string, number>;
const clients: AgentClient[] = [];

beforeAll(async () => {
  t = await startTestServer();
  admin = await setupAdmin(t);
  const d = await t.api('GET', '/api/dispositions', undefined, admin);
  dispositions = Object.fromEntries(d.body.map((x: any) => [x.code, x.id]));
});
afterEach(() => {
  for (const c of clients.splice(0)) c.close();
});
afterAll(async () => {
  await t.close();
});

async function agentOn(campaignId: number | null, username: string) {
  const { user, token } = await createAgent(t, admin, username);
  if (campaignId) await t.api('PUT', `/api/campaigns/${campaignId}/agents`, { userIds: [user.id] }, admin);
  const client = await connectAgent(t, token);
  clients.push(client);
  const join = await client.call('agent:join', { campaignId });
  expect(join.ok, join.error).toBe(true);
  expect(join.data.state).toBe('paused');
  return { user, token, client };
}

describe('preview dialing flow', () => {
  it('assigns leads in order, records calls and dispositions, then moves on', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { dialMode: 'preview' });
    const { client } = await agentOn(campaignId, 'pv1');

    const ready = await client.call('agent:ready');
    expect(ready.ok).toBe(true);
    expect(ready.data.state).toBe('assigned');
    const assigned = await client.next('lead:assigned');
    expect(assigned.lead.id).toBe(leads[0].id);
    expect(assigned.autoDial).toBe(false);
    expect(assigned.dialString).toBe('+14155550101');
    expect(assigned.campaign.id).toBe(campaignId);

    const dial = await client.call('lead:dial', { leadId: leads[0].id });
    expect(dial.ok).toBe(true);
    const callId = dial.data.callId as number;
    const started = await client.next('call:started');
    expect(started.call.id).toBe(callId);

    const end = await runCall(client, callId, { answer: true });
    expect(end.data.state).toBe('wrapup');
    const ended = await client.next('call:ended');
    expect(ended.call.result).toBe('answered');

    const disp = await client.call('call:dispose', { callId, dispositionId: dispositions.INTERESTED, notes: 'wants a demo' });
    expect(disp.ok).toBe(true);
    expect(disp.data.state).toBe('assigned'); // next lead handed out immediately
    const second = await client.next('lead:assigned');
    expect(second.lead.id).toBe(leads[1].id);

    const call = await t.api('GET', `/api/calls/${callId}`, undefined, admin);
    expect(call.body.dispositionCode).toBe('INTERESTED');
    expect(call.body.notes).toBe('wants a demo');
    expect(call.body.talkSec).toBeGreaterThanOrEqual(0);
    const lead = await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin);
    expect(lead.body.attempts).toBe(1);
    expect(lead.body.status).toBe('in_progress');
    expect(lead.body.nextAttemptAt).not.toBeNull(); // INTERESTED retries after 1440 min
    expect(lead.body.lockedBy).toBeNull();
  });

  it('skip re-queues the lead with a delay and hands out the next one', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { dialMode: 'preview', phones: ['+14155550111', '+14155550112'] });
    const { client } = await agentOn(campaignId, 'pv2');
    await client.call('agent:ready');
    const first = await client.next('lead:assigned');
    const skip = await client.call('lead:skip', { leadId: first.lead.id, requeue: true });
    expect(skip.ok).toBe(true);
    const second = await client.next('lead:assigned');
    expect(second.lead.id).toBe(leads[1].id);
    const l = await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin);
    expect(l.body.lockedBy).toBeNull();
    expect(l.body.nextAttemptAt).not.toBeNull();
  });

  it('unanswered calls are dispositioned and retried after the disposition delay; max attempts finishes the lead', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, {
      dialMode: 'preview',
      phones: ['+14155550121'],
      extra: { maxAttempts: 2 },
    });
    const { client } = await agentOn(campaignId, 'pv3');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d1 = await client.call('lead:dial', { leadId: a.lead.id });
    await runCall(client, d1.data.callId, { answer: false, cause: 'no-answer' });
    const r1 = await client.call('call:dispose', { callId: d1.data.callId, dispositionId: dispositions.NO_ANSWER });
    expect(r1.data.state).toBe('ready'); // retry is 240 min away -> nothing to dial
    let lead = (await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body;
    expect(lead.status).toBe('in_progress');
    expect(lead.attempts).toBe(1);
    const call1 = (await t.api('GET', `/api/calls/${d1.data.callId}`, undefined, admin)).body;
    expect(call1.result).toBe('no_answer');

    // make it due now and tick -> assigned again
    await t.api('PATCH', `/api/leads/${leads[0].id}`, { nextAttemptAt: new Date(Date.now() - 1000).toISOString() }, admin);
    t.app.engine.tick();
    const b = await client.next('lead:assigned');
    expect(b.lead.id).toBe(leads[0].id);
    const d2 = await client.call('lead:dial', { leadId: b.lead.id });
    await runCall(client, d2.data.callId, { answer: false, cause: 'busy' });
    await client.call('call:dispose', { callId: d2.data.callId, dispositionId: dispositions.BUSY });
    lead = (await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body;
    expect(lead.attempts).toBe(2);
    expect(lead.status).toBe('done'); // maxAttempts reached
  });
});

describe('progressive dialing', () => {
  it('flags autoDial and keeps the agent busy until paused; pause applies after wrap-up', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { dialMode: 'progressive', phones: ['+14155550131', '+14155550132'] });
    const { client } = await agentOn(campaignId, 'pg1');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    expect(a.autoDial).toBe(true);
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await client.call('call:update', { callId: d.data.callId, state: 'answered' });
    const p = await client.call('agent:pause', { code: 'Break' });
    expect(p.data.state).toBe('talking'); // pending until wrap-up done
    await client.call('call:update', { callId: d.data.callId, state: 'ended', cause: 'normal' });
    const r = await client.call('call:dispose', { callId: d.data.callId, dispositionId: dispositions.SALE });
    expect(r.data.state).toBe('paused');
    expect(r.data.pauseCode).toBe('Break');
    // no second lead was handed out
    expect(client.received('lead:assigned')).toHaveLength(0);
    const stats = await t.api('GET', `/api/campaigns/${campaignId}/stats`, undefined, admin);
    expect(stats.body.sales).toBe(1);
    expect(stats.body.callsAnswered).toBe(1);
  });

  it('disposition chosen while still talking finishes wrap-up automatically on hangup', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { dialMode: 'progressive', phones: ['+14155550141', '+14155550142'] });
    const { client } = await agentOn(campaignId, 'pg2');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await client.call('call:update', { callId: d.data.callId, state: 'answered' });
    const disp = await client.call('call:dispose', { callId: d.data.callId, dispositionId: dispositions.NOT_INTERESTED });
    expect(disp.data.state).toBe('talking');
    const end = await client.call('call:update', { callId: d.data.callId, state: 'ended', cause: 'normal' });
    expect(end.data.state).toBe('assigned');
    const b = await client.next('lead:assigned');
    expect(b.lead.phone).toBe('+14155550142');
  });
});

describe('compliance gate', () => {
  it('DNC disposition adds the number to the list and blocks manual re-dial', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { phones: ['+14155550151'] });
    const { client } = await agentOn(campaignId, 'cp1');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await runCall(client, d.data.callId);
    await client.call('call:dispose', { callId: d.data.callId, dispositionId: dispositions.DNC, notes: 'asked to stop' });
    const dnc = await t.api('GET', '/api/dnc/check?phone=%2B14155550151', undefined, admin);
    expect(dnc.body.dnc).toBe(true);
    expect((await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body.status).toBe('dnc');
    const manual = await client.call('manual:dial', { phone: '415-555-0151' });
    expect(manual.ok).toBe(false);
    expect(manual.error).toMatch(/do-not-call/);
  });

  it('leads outside calling hours are not handed out', async () => {
    const h = new Date().getUTCHours();
    const start = `${String((h + 2) % 24).padStart(2, '0')}:00`;
    const end = `${String((h + 3) % 24).padStart(2, '0')}:00`;
    const { campaignId } = await createCampaignWithLeads(t, admin, {
      phones: ['+14155550161'],
      extra: { callingHoursStart: start, callingHoursEnd: end, timezoneMode: 'fixed', fixedTimezone: 'UTC' },
    });
    const { client } = await agentOn(campaignId, 'cp2');
    const r = await client.call('agent:ready');
    expect(r.data.state).toBe('ready');
    const notice = await client.next('notice');
    expect(notice.message).toMatch(/No leads/);
    const manual = await client.call('manual:dial', { phone: '+14155550161', campaignId });
    expect(manual.ok).toBe(false);
    expect(manual.error).toMatch(/calling hours/);
  });

  it('daily attempt cap per number is enforced', async () => {
    await t.api('PUT', '/api/settings', { maxAttemptsPerDay: 1 }, admin);
    const { campaignId } = await createCampaignWithLeads(t, admin, { phones: ['+14155550171'] });
    const { client } = await agentOn(campaignId, 'cp3');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await runCall(client, d.data.callId, { answer: false });
    await client.call('call:dispose', { callId: d.data.callId, dispositionId: dispositions.NO_ANSWER });
    const manual = await client.call('manual:dial', { phone: '+14155550171' });
    expect(manual.ok).toBe(false);
    expect(manual.error).toMatch(/Daily attempt limit/);
    await t.api('PUT', '/api/settings', { maxAttemptsPerDay: 0 }, admin);
  });

  it('manual campaigns never auto-assign; manual dial checks DNC and logs the call', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { dialMode: 'manual', phones: ['+14155550181'] });
    const { client } = await agentOn(campaignId, 'cp4');
    const r = await client.call('agent:ready');
    expect(r.data.state).toBe('ready');
    await sleep(100);
    expect(client.received('lead:assigned')).toHaveLength(0);
    const m = await client.call('manual:dial', { phone: '(415) 555-0199' });
    expect(m.ok, m.error).toBe(true);
    expect(m.data.dialString).toBe('+14155550199');
    await runCall(client, m.data.callId);
    const r2 = await client.call('call:dispose', { callId: m.data.callId, dispositionId: dispositions.NOT_INTERESTED });
    expect(r2.data.state).toBe('ready');
  });
});

describe('manual dial', () => {
  it('dials an arbitrary number and an existing lead', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { dialMode: 'manual', phones: ['+14155550191'] });
    const { client } = await agentOn(campaignId, 'md1');
    await client.call('agent:ready');
    const m = await client.call('manual:dial', { phone: '415 555 0192' });
    expect(m.ok, m.error).toBe(true);
    expect(m.data.dialString).toBe('+14155550192');
    expect(m.data.lead).toBeNull();
    await runCall(client, m.data.callId);
    const r = await client.call('call:dispose', { callId: m.data.callId, dispositionId: dispositions.NOT_INTERESTED });
    expect(r.data.state).toBe('ready');

    const m2 = await client.call('manual:dial', { phone: leads[0].phone, leadId: leads[0].id });
    expect(m2.ok).toBe(true);
    expect(m2.data.lead.id).toBe(leads[0].id);
    await runCall(client, m2.data.callId);
    await client.call('call:dispose', { callId: m2.data.callId, dispositionId: dispositions.SALE });
    const lead = (await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body;
    expect(lead.status).toBe('done');
    expect(lead.attempts).toBe(1);
    const calls = await t.api('GET', `/api/calls?campaignId=${campaignId}`, undefined, admin);
    expect(calls.body.total).toBe(2);
  });

  it('rejects invalid numbers and dialing while busy', async () => {
    const { client } = await agentOn(null, 'md2');
    expect((await client.call('manual:dial', { phone: 'abc' })).error).toMatch(/Invalid/);
    const m = await client.call('manual:dial', { phone: '+14155550193' });
    expect(m.ok).toBe(true);
    expect((await client.call('manual:dial', { phone: '+14155550194' })).error).toMatch(/Cannot dial/);
  });
});

describe('callbacks', () => {
  it('schedules a callback, hands it out when due (ignoring hours) and marks it done', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { phones: ['+14155550201', '+14155550202'] });
    const { user, client } = await agentOn(campaignId, 'cb1');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await runCall(client, d.data.callId);
    const when = new Date(Date.now() + 60_000).toISOString();
    const r = await client.call('call:dispose', {
      callId: d.data.callId,
      dispositionId: dispositions.CALLBACK,
      callback: { scheduledAt: when, note: 'call after lunch', personal: true },
    });
    expect(r.ok).toBe(true);
    const mine = await t.api('GET', '/api/callbacks', undefined, (await createAgent(t, admin, 'cb1b')).token);
    expect(mine.body).toHaveLength(0); // personal callback of another agent
    const cbs = await t.api('GET', '/api/callbacks?scope=all', undefined, admin);
    const cb = cbs.body.find((c: any) => c.leadId === leads[0].id);
    expect(cb.userId).toBe(user.id);
    expect(cb.lead.status).toBe('callback');

    // second lead is handed out meanwhile
    const b = await client.next('lead:assigned');
    expect(b.lead.id).toBe(leads[1].id);
    await client.call('lead:skip', { leadId: b.lead.id, requeue: false });

    // make the callback due
    await t.api('PATCH', `/api/callbacks/${cb.id}`, { scheduledAt: new Date(Date.now() - 1000).toISOString() }, admin);
    t.app.engine.tick();
    const c = await client.next('lead:assigned');
    expect(c.lead.id).toBe(leads[0].id);
    expect(c.callback.id).toBe(cb.id);
    const d2 = await client.call('lead:dial', { leadId: c.lead.id });
    expect(d2.ok, d2.error).toBe(true);
    await runCall(client, d2.data.callId);
    await client.call('call:dispose', { callId: d2.data.callId, dispositionId: dispositions.SALE });
    const done = await t.api('GET', `/api/callbacks/${cb.id}`, undefined, admin);
    expect(done.body.status).toBe('done');
    expect((await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body.status).toBe('done');
  });

  it('reminds the agent about upcoming personal callbacks', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { phones: ['+14155550211'] });
    const { user, client } = await agentOn(campaignId, 'cb2');
    const cb = t.app.ctx.db
      .prepare(`INSERT INTO callbacks (lead_id, campaign_id, user_id, scheduled_at, note, created_by) VALUES (?, ?, ?, ?, 'x', ?)`)
      .run(leads[0].id, campaignId, user.id, new Date(Date.now() + 2 * 60_000).toISOString(), user.id);
    t.app.engine.tick();
    const due = await client.next('callback:due');
    expect(due.callback.id).toBe(Number(cb.lastInsertRowid));
  });
});

describe('sessions & resilience', () => {
  it('a second login replaces the first socket and keeps the lead', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { phones: ['+14155550221'] });
    const { token, client } = await agentOn(campaignId, 'rs1');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const second = await connectAgent(t, token);
    clients.push(second);
    await client.next('session:replaced');
    const join = await second.call('agent:join', { campaignId });
    expect(join.data.state).toBe('assigned');
    expect(join.data.leadId).toBe(a.lead.id);
    const re = await second.next('lead:assigned');
    expect(re.lead.id).toBe(a.lead.id);
  });

  it('disconnect during a call keeps the session for the grace period, then releases everything', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { phones: ['+14155550231'] });
    const { user, client } = await agentOn(campaignId, 'rs2');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await client.call('call:update', { callId: d.data.callId, state: 'answered' });
    client.close();
    await sleep(150);
    expect(t.app.engine.getSession(user.id)?.state).toBe('talking');
    t.app.engine.tick(Date.now() + DISCONNECT_GRACE_MS + 1000);
    expect(t.app.engine.getSession(user.id)).toBeUndefined();
    const lead = (await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body;
    expect(lead.lockedBy).toBeNull();
    const call = (await t.api('GET', `/api/calls/${d.data.callId}`, undefined, admin)).body;
    expect(call.endedAt).not.toBeNull();
    expect(call.result).toBe('answered');
  });

  it('idle disconnect logs the agent out immediately and releases a preview lead', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { phones: ['+14155550241'] });
    const { user, client } = await agentOn(campaignId, 'rs3');
    await client.call('agent:ready');
    await client.next('lead:assigned');
    client.close();
    await sleep(150);
    // assigned (preview, no call) counts as busy -> grace period applies
    expect(t.app.engine.getSession(user.id)?.disconnectedAt).toBeTruthy();
    t.app.engine.tick(Date.now() + DISCONNECT_GRACE_MS + 1000);
    expect(t.app.engine.getSession(user.id)).toBeUndefined();
    expect((await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body.lockedBy).toBeNull();
  });

  it('wrap-up timeout auto-dispositions unanswered calls only', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { phones: ['+14155550251', '+14155550252'], extra: { wrapupTimeoutSec: 5 } });
    const { client } = await agentOn(campaignId, 'rs4');
    await client.call('agent:ready');
    const a = await client.next('lead:assigned');
    const d = await client.call('lead:dial', { leadId: a.lead.id });
    await runCall(client, d.data.callId, { answer: false, cause: 'no-answer' });
    t.app.engine.tick(Date.now() + 6000);
    const b = await client.next('lead:assigned');
    expect(b.lead.phone).toBe('+14155550252');
    expect((await t.api('GET', `/api/calls/${d.data.callId}`, undefined, admin)).body.dispositionCode).toBe('NO_ANSWER');
    // answered call: must stay in wrapup
    const d2 = await client.call('lead:dial', { leadId: b.lead.id });
    await runCall(client, d2.data.callId, { answer: true });
    t.app.engine.tick(Date.now() + 6000);
    const sess = [...t.app.engine.sessions.values()].find((s) => s.username === 'rs4')!;
    expect(sess.state).toBe('wrapup');
  });

  it('pausing a campaign pulls agents off it and resuming hands leads out again', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { phones: ['+14155550261'] });
    const { user, client } = await agentOn(campaignId, 'rs5');
    await client.call('agent:ready');
    await client.next('lead:assigned');
    await t.api('POST', `/api/campaigns/${campaignId}/status`, { status: 'paused' }, admin);
    await client.next('campaign:changed');
    const released = await client.next('lead:released');
    expect(released.reason).toMatch(/paused/);
    expect(t.app.engine.getSession(user.id)?.state).toBe('paused');
    await t.api('POST', `/api/campaigns/${campaignId}/status`, { status: 'active' }, admin);
    const r = await client.call('agent:ready');
    expect(r.data.state).toBe('assigned');
  });

  it('supervisor wallboard shows live agent states and can force logout', async () => {
    const { campaignId } = await createCampaignWithLeads(t, admin, { phones: ['+14155550271'] });
    const { user, client } = await agentOn(campaignId, 'rs6');
    const sup = await createAgent(t, admin, 'sup1', 'supervisor');
    const supClient = await connectAgent(t, sup.token);
    clients.push(supClient);
    const sub = await supClient.call('wallboard:subscribe');
    expect(sub.ok).toBe(true);
    expect(sub.data.agents.map((a: any) => a.username)).toContain('rs6');
    await client.call('agent:ready');
    const update = await supClient.next('wallboard:update', 4000);
    const me = update.agents.find((a: any) => a.userId === user.id);
    expect(['ready', 'assigned']).toContain(me.state);
    expect(update.campaigns.find((c: any) => c.campaignId === campaignId).agentsOnline).toBe(1);
    const agentDenied = await client.call('wallboard:subscribe');
    expect(agentDenied.ok).toBe(false);
    const kick = await t.api('POST', `/api/agents/${user.id}/logout`, undefined, sup.token);
    expect(kick.status).toBe(200);
    expect(t.app.engine.getSession(user.id)).toBeUndefined();
  });

  it('rejects unauthenticated sockets and joining a campaign the agent is not on', async () => {
    await expect(connectAgent(t, 'bad.token.value')).rejects.toBeTruthy();
    const { campaignId } = await createCampaignWithLeads(t, admin, { phones: ['+14155550281'] });
    const { token } = await createAgent(t, admin, 'rs7');
    const c = await connectAgent(t, token);
    clients.push(c);
    const join = await c.call('agent:join', { campaignId });
    expect(join.ok).toBe(false);
    expect(join.error).toMatch(/not assigned/);
  });
});
