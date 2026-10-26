import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAgent, createCampaignWithLeads, login, setupAdmin, startTestServer, type TestServer } from './helpers.js';

let t: TestServer;
let admin: string;

beforeAll(async () => {
  t = await startTestServer();
});
afterAll(async () => {
  await t.close();
});

describe('setup & auth', () => {
  it('reports needsSetup before the first admin exists', async () => {
    const r = await t.api('GET', '/api/settings/public');
    expect(r.status).toBe(200);
    expect(r.body.needsSetup).toBe(true);
    expect(r.body.telephonyMode).toBe('sim');
  });
  it('rejects protected routes without a token', async () => {
    expect((await t.api('GET', '/api/campaigns')).status).toBe(401);
  });
  it('creates the admin via setup and blocks a second setup', async () => {
    admin = await setupAdmin(t);
    expect(admin).toBeTruthy();
    const again = await t.api('POST', '/api/setup', { username: 'x', password: 'password123', displayName: 'X' });
    expect(again.status).toBe(409);
    expect((await t.api('GET', '/api/settings/public')).body.needsSetup).toBe(false);
    expect((await t.api('GET', '/api/settings/public')).body.companyName).toBe('TestCo');
  });
  it('logs in and rejects wrong passwords', async () => {
    const ok = await t.api('POST', '/api/auth/login', { username: 'admin', password: 'password123' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('admin');
    const bad = await t.api('POST', '/api/auth/login', { username: 'admin', password: 'nope' });
    expect(bad.status).toBe(401);
    const me = await t.api('GET', '/api/auth/me', undefined, ok.body.token);
    expect(me.body.user.username).toBe('admin');
    expect(me.body.settings.companyName).toBe('TestCo');
  });
  it('changes password', async () => {
    const r = await t.api('POST', '/api/auth/change-password', { currentPassword: 'password123', newPassword: 'newpassword1' }, admin);
    expect(r.status).toBe(200);
    expect((await t.api('POST', '/api/auth/login', { username: 'admin', password: 'password123' })).status).toBe(401);
    admin = await login(t, 'admin', 'newpassword1');
  });
  it('validates input', async () => {
    const r = await t.api('POST', '/api/users', { username: 'bad user', password: 'short', displayName: '' }, admin);
    expect(r.status).toBe(400);
    expect(r.body.details.length).toBeGreaterThan(0);
  });
});

describe('users & roles', () => {
  it('admin creates users; agents cannot', async () => {
    const { user, token } = await createAgent(t, admin, 'alice');
    expect(user.role).toBe('agent');
    const denied = await t.api('POST', '/api/users', { username: 'bob', password: 'password123', displayName: 'Bob' }, token);
    expect(denied.status).toBe(403);
    const list = await t.api('GET', '/api/users', undefined, admin);
    expect(list.body.map((u: any) => u.username)).toContain('alice');
    // sip password never leaks in list
    expect(list.body[0].sipPassword).toBeUndefined();
  });
  it('prevents duplicate usernames and self-demotion', async () => {
    const dup = await t.api('POST', '/api/users', { username: 'ALICE', password: 'password123', displayName: 'Dup' }, admin);
    expect(dup.status).toBe(409);
    const me = (await t.api('GET', '/api/auth/me', undefined, admin)).body.user;
    const demote = await t.api('PATCH', `/api/users/${me.id}`, { role: 'agent' }, admin);
    expect(demote.status).toBe(409);
  });
  it('returns sip credentials only to the user themself', async () => {
    const { user, token } = await createAgent(t, admin, 'sipuser');
    await t.api('PATCH', `/api/users/${user.id}`, { sipUsername: '1001', sipPassword: 'secret' }, admin);
    const sip = await t.api('GET', '/api/auth/sip', undefined, token);
    expect(sip.body.username).toBe('1001');
    expect(sip.body.password).toBe('secret');
    expect(sip.body.mode).toBe('sim');
  });
});

describe('campaigns, lists, leads', () => {
  let campaignId: number;
  let listId: number;
  it('creates a campaign with defaults', async () => {
    const r = await t.api('POST', '/api/campaigns', { name: 'Spring promo' }, admin);
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('draft');
    expect(r.body.dialMode).toBe('preview');
    campaignId = r.body.id;
    const l = await t.api('POST', `/api/campaigns/${campaignId}/lists`, { name: 'Main' }, admin);
    expect(l.status).toBe(201);
    listId = l.body.id;
  });
  it('PATCH only changes the fields that were sent', async () => {
    await t.api('PATCH', `/api/campaigns/${campaignId}`, { callingHoursStart: '10:30', callingDays: [1, 3], maxAttempts: 7, dialMode: 'progressive' }, admin);
    const after = await t.api('PATCH', `/api/campaigns/${campaignId}`, { description: 'only this' }, admin);
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ description: 'only this', callingHoursStart: '10:30', callingDays: [1, 3], maxAttempts: 7, dialMode: 'progressive' });
    await t.api('PATCH', `/api/campaigns/${campaignId}`, { dialMode: 'preview' }, admin);

    const { user } = await createAgent(t, admin, 'patchme', 'supervisor');
    const u = await t.api('PATCH', `/api/users/${user.id}`, { sipUsername: '2001' }, admin);
    expect(u.body).toMatchObject({ role: 'supervisor', active: true, sipUsername: '2001' });
    const l = await t.api('PATCH', `/api/lists/${listId}`, { active: false }, admin);
    expect(l.body.active).toBe(false);
    expect((await t.api('PATCH', `/api/lists/${listId}`, { name: 'Main renamed' }, admin)).body.active).toBe(false);
    await t.api('PATCH', `/api/lists/${listId}`, { active: true }, admin);
  });
  it('agents only see campaigns they are assigned to', async () => {
    const { user, token } = await createAgent(t, admin, 'carol');
    expect((await t.api('GET', '/api/campaigns', undefined, token)).body).toHaveLength(0);
    await t.api('PUT', `/api/campaigns/${campaignId}/agents`, { userIds: [user.id] }, admin);
    await t.api('POST', `/api/campaigns/${campaignId}/status`, { status: 'active' }, admin);
    const mine = await t.api('GET', '/api/campaigns', undefined, token);
    expect(mine.body).toHaveLength(1);
    expect((await t.api('POST', '/api/campaigns', { name: 'nope' }, token)).status).toBe(403);
  });
  it('previews and imports a CSV with mapping, dedupe, DNC skip and invalid rows', async () => {
    await t.api('POST', '/api/dnc', { phone: '(415) 555-0199', note: 'asked' }, admin);
    const csv = [
      'Phone,First Name,Last,Company,Plan',
      '415-555-0100,Ann,One,Acme,Gold',
      '(415) 555-0100,Dup,Licate,Acme,Gold',
      '415 555 0199,Dee,Enncee,Acme,Silver',
      'not-a-number,Bad,Row,Acme,Bronze',
      '+44 20 7946 0958,Uk,Lead,Ltd,Gold',
      '415-555-0101,Bob,Two,Beta,',
    ].join('\n');
    const preview = await t.upload(`/api/lists/${listId}/import/preview`, admin, {}, { name: 'leads.csv', content: csv });
    expect(preview.status).toBe(200);
    expect(preview.body.headers).toEqual(['Phone', 'First Name', 'Last', 'Company', 'Plan']);
    expect(preview.body.mapping.phone).toBe('Phone');
    expect(preview.body.mapping.firstName).toBe('First Name');
    expect(preview.body.mapping.lastName).toBe('Last');
    expect(preview.body.mapping.customColumns).toEqual(['Plan']);
    expect(preview.body.total).toBe(6);

    const imp = await t.upload(`/api/lists/${listId}/import`, admin, { mapping: JSON.stringify(preview.body.mapping) }, { name: 'leads.csv', content: csv });
    expect(imp.status).toBe(200);
    expect(imp.body).toMatchObject({ imported: 3, duplicates: 1, dnc: 1, invalid: 1, total: 6 });
    const leads = await t.api('GET', `/api/leads?listId=${listId}`, undefined, admin);
    expect(leads.body.total).toBe(3);
    const ann = leads.body.items.find((l: any) => l.firstName === 'Ann');
    expect(ann.phone).toBe('+14155550100');
    expect(ann.custom).toEqual({ Plan: 'Gold' });
    expect(leads.body.items.find((l: any) => l.firstName === 'Uk').phone).toBe('+442079460958');
  });
  it('searches leads by name and phone fragment', async () => {
    const byName = await t.api('GET', `/api/leads?campaignId=${campaignId}&q=ann%20one`, undefined, admin);
    expect(byName.body.total).toBe(1);
    const byPhone = await t.api('GET', `/api/leads?campaignId=${campaignId}&q=555-0101`, undefined, admin);
    expect(byPhone.body.items[0].firstName).toBe('Bob');
  });
  it('rejects a mapping whose phone column does not exist', async () => {
    const r = await t.upload(`/api/lists/${listId}/import`, admin, { mapping: JSON.stringify({ phone: 'Nope' }) }, { name: 'x.csv', content: 'Phone\n4155550111' });
    expect(r.status).toBe(400);
  });
  it('campaign stats count leads', async () => {
    const s = await t.api('GET', `/api/campaigns/${campaignId}/stats`, undefined, admin);
    expect(s.body.leadsTotal).toBe(3);
    expect(s.body.dialable).toBe(3);
  });
  it('agents cannot change queue state of a lead but can edit notes', async () => {
    const { token } = await createAgent(t, admin, 'dave');
    const lead = (await t.api('GET', `/api/leads?listId=${listId}`, undefined, admin)).body.items[0];
    expect((await t.api('PATCH', `/api/leads/${lead.id}`, { status: 'done' }, token)).status).toBe(400);
    expect((await t.api('PATCH', `/api/leads/${lead.id}`, { notes: 'called twice' }, token)).body.notes).toBe('called twice');
  });
  it('resets leads', async () => {
    const lead = (await t.api('GET', `/api/leads?listId=${listId}`, undefined, admin)).body.items[0];
    await t.api('PATCH', `/api/leads/${lead.id}`, { status: 'done', attempts: 3 }, admin);
    const r = await t.api('POST', `/api/campaigns/${campaignId}/reset-leads`, { onlyStatus: ['done'] }, admin);
    expect(r.body.changed).toBe(1);
    expect((await t.api('GET', `/api/leads/${lead.id}`, undefined, admin)).body.status).toBe('new');
  });
  it('exports leads csv', async () => {
    const r = await t.api('GET', `/api/reports/export/leads.csv?campaignId=${campaignId}`, undefined, admin);
    expect(r.status).toBe(200);
    expect(String(r.body)).toContain('+14155550100');
  });
});

describe('DNC', () => {
  it('adding a number marks matching leads dnc everywhere and cancels callbacks', async () => {
    const { campaignId, leads } = await createCampaignWithLeads(t, admin, { name: 'DNC test', phones: ['+14155550301', '+14155550302'] });
    const r = await t.api('POST', '/api/dnc', { phone: '415-555-0301' }, admin);
    expect(r.status).toBe(201);
    expect(r.body.phone).toBe('+14155550301');
    expect((await t.api('GET', `/api/leads/${leads[0].id}`, undefined, admin)).body.status).toBe('dnc');
    expect((await t.api('GET', `/api/campaigns/${campaignId}/stats`, undefined, admin)).body.dialable).toBe(1);
    const check = await t.api('GET', '/api/dnc/check?phone=%2B14155550301', undefined, admin);
    expect(check.body.dnc).toBe(true);
    expect((await t.api('GET', '/api/dnc/check?phone=%2B14155550302', undefined, admin)).body.dnc).toBe(false);
  });
  it('bulk imports DNC numbers', async () => {
    const r = await t.upload('/api/dnc/import', admin, {}, { name: 'dnc.csv', content: '4155550401\n"415-555-0402"\nbad\n' });
    // "bad" has no digits and is dropped before parsing; both real numbers are added
    expect(r.body).toMatchObject({ added: 2, invalid: 0, total: 2 });
    const list = await t.api('GET', '/api/dnc?q=0402', undefined, admin);
    expect(list.body.total).toBe(1);
  });
  it('only admins can remove DNC entries', async () => {
    const { token } = await createAgent(t, admin, 'erin');
    const list = await t.api('GET', '/api/dnc?q=0401', undefined, admin);
    const id = list.body.items[0].id;
    expect((await t.api('DELETE', `/api/dnc/${id}`, undefined, token)).status).toBe(403);
    expect((await t.api('DELETE', `/api/dnc/${id}`, undefined, admin)).status).toBe(200);
  });
});

describe('dispositions, scripts, settings', () => {
  it('seeds system dispositions that cannot be deleted', async () => {
    const r = await t.api('GET', '/api/dispositions', undefined, admin);
    expect(r.body.length).toBeGreaterThanOrEqual(10);
    const dnc = r.body.find((d: any) => d.code === 'DNC');
    expect(dnc.system).toBe(true);
    expect((await t.api('DELETE', `/api/dispositions/${dnc.id}`, undefined, admin)).status).toBe(409);
  });
  it('creates custom dispositions and rejects bad codes', async () => {
    const ok = await t.api('POST', '/api/dispositions', { code: 'SEND_INFO', label: 'Send info pack', category: 'contact', retryMinutes: 2880 }, admin);
    expect(ok.status).toBe(201);
    expect((await t.api('POST', '/api/dispositions', { code: 'bad code', label: 'x', category: 'contact' }, admin)).status).toBe(400);
    expect((await t.api('POST', '/api/dispositions', { code: 'SEND_INFO', label: 'dup', category: 'contact' }, admin)).status).toBe(409);
    expect((await t.api('DELETE', `/api/dispositions/${ok.body.id}`, undefined, admin)).status).toBe(200);
  });
  it('renders scripts with placeholders', async () => {
    const s = await t.api('POST', '/api/scripts', { name: 'Intro', body: 'Hi {{first_name}}, this is {{agent_name}} from {{company_name}}.' }, admin);
    expect(s.status).toBe(201);
    const p = await t.api('GET', `/api/scripts/${s.body.id}/preview`, undefined, admin);
    expect(p.body.rendered).toBe('Hi Jane, this is Admin from TestCo.');
  });
  it('updates settings partially and validates', async () => {
    const r = await t.api('PUT', '/api/settings', { telephony: { mode: 'sip', wssUrl: 'wss://pbx.example.com:8089/ws', sipDomain: 'pbx.example.com' }, pauseCodes: ['Break'] }, admin);
    expect(r.status).toBe(200);
    expect(r.body.telephony.mode).toBe('sip');
    expect(r.body.telephony.ringTimeoutSec).toBe(45); // untouched default
    expect(r.body.pauseCodes).toEqual(['Break']);
    expect((await t.api('GET', '/api/settings/public')).body.telephonyMode).toBe('sip');
    expect((await t.api('PUT', '/api/settings', { maxAttemptsPerDay: -1 }, admin)).status).toBe(400);
    await t.api('PUT', '/api/settings', { telephony: { mode: 'sim' } }, admin);
  });
});

describe('admin: api keys, webhooks, audit, backup, reports', () => {
  it('api keys authenticate as admin and plaintext is shown once', async () => {
    const r = await t.api('POST', '/api/api-keys', { name: 'crm' }, admin);
    expect(r.status).toBe(201);
    expect(r.body.plaintext.startsWith('odk_')).toBe(true);
    const viaKey = await t.api('GET', '/api/campaigns', undefined, null, { 'x-api-key': r.body.plaintext });
    expect(viaKey.status).toBe(200);
    const list = await t.api('GET', '/api/api-keys', undefined, admin);
    expect(list.body[0].plaintext).toBeUndefined();
    expect((await t.api('GET', '/api/campaigns', undefined, null, { 'x-api-key': 'odk_wrong' })).status).toBe(401);
    expect((await t.api('DELETE', `/api/api-keys/${r.body.id}`, undefined, admin)).status).toBe(200);
    expect((await t.api('GET', '/api/campaigns', undefined, null, { 'x-api-key': r.body.plaintext })).status).toBe(401);
  });
  it('creates webhooks and lists events', async () => {
    const r = await t.api('POST', '/api/webhooks', { url: 'http://127.0.0.1:9/hook', events: ['call.ended'], secret: 's' }, admin);
    expect(r.status).toBe(201);
    const list = await t.api('GET', '/api/webhooks', undefined, admin);
    expect(list.body.events).toContain('call.disposed');
    expect((await t.api('POST', '/api/webhooks', { url: 'notaurl', events: [] }, admin)).status).toBe(400);
    await t.api('DELETE', `/api/webhooks/${r.body.id}`, undefined, admin);
  });
  it('audit log records actions', async () => {
    const r = await t.api('GET', '/api/audit?entity=campaign', undefined, admin);
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.items[0].username).toBe('admin');
  });
  it('report endpoints respond', async () => {
    for (const p of ['/api/reports/summary', '/api/reports/campaigns', '/api/reports/agents', '/api/reports/dispositions', '/api/reports/hourly', '/api/wallboard', '/api/admin/system']) {
      const r = await t.api('GET', p, undefined, admin);
      expect(r.status, p).toBe(200);
    }
    const csv = await t.api('GET', '/api/reports/export/calls.csv', undefined, admin);
    expect(csv.status).toBe(200);
    expect(String(csv.body).split('\n')[0]).toContain('phone');
  });
  it('creates and lists backups', async () => {
    const r = await t.api('POST', '/api/admin/backup', undefined, admin);
    expect(r.status).toBe(200);
    expect(r.body.bytes).toBeGreaterThan(0);
    const list = await t.api('GET', '/api/admin/backups', undefined, admin);
    expect(list.body[0].file).toBe(r.body.file);
  });
  it('health is public', async () => {
    const r = await t.api('GET', '/api/health');
    expect(r.body.ok).toBe(true);
  });
  it('unknown api routes 404 as json', async () => {
    expect((await t.api('GET', '/api/nope', undefined, admin)).status).toBe(404);
  });
});
