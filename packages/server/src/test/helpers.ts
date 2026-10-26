import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import pino from 'pino';
import { io as ioClient, type Socket } from 'socket.io-client';
import { RT_NAMESPACE, type Ack } from '@opendialer/shared';
import { createApp, type App } from '../app.js';
import { loadConfig } from '../config.js';
import { createRealtime } from '../realtime.js';

export interface TestServer {
  app: App;
  url: string;
  port: number;
  close: () => Promise<void>;
  /** JSON fetch helper */
  api: (method: string, p: string, body?: unknown, token?: string | null, extraHeaders?: Record<string, string>) => Promise<{ status: number; body: any }>;
  /** multipart upload helper */
  upload: (p: string, token: string, fields: Record<string, string>, file?: { name: string; content: string; type?: string }) => Promise<{ status: number; body: any }>;
}

export async function startTestServer(): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendialer-test-'));
  const config = loadConfig({ dataDir, httpPort: 0, httpsPort: 0, tls: 'off', webDir: null, engineInterval: 0, jwtSecret: 'test-secret-'.repeat(4), corsOrigins: [] });
  const log = pino({ level: 'silent' });
  const app = createApp(config, log, ':memory:');
  const server = http.createServer(app.express);
  const rt = createRealtime(app.ctx, app.engine, [server]);
  app.engine.start(0);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const api: TestServer['api'] = async (method, p, body, token, extraHeaders = {}) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(url + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { status: res.status, body: parsed };
  };

  const upload: TestServer['upload'] = async (p, token, fields, file) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    if (file) form.append('file', new Blob([file.content], { type: file.type ?? 'text/csv' }), file.name);
    const res = await fetch(url + p, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, body: await res.json() };
  };

  return {
    app,
    url,
    port,
    api,
    upload,
    close: async () => {
      rt.io.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Run first-run setup and return the admin token. */
export async function setupAdmin(t: TestServer, username = 'admin', password = 'password123') {
  const r = await t.api('POST', '/api/setup', { username, password, displayName: 'Admin', companyName: 'TestCo', defaultCountry: 'US', defaultTimezone: 'UTC' });
  if (r.status !== 201) throw new Error(`setup failed: ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

export async function login(t: TestServer, username: string, password: string) {
  const r = await t.api('POST', '/api/auth/login', { username, password });
  if (r.status !== 200) throw new Error(`login failed: ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}

export async function createAgent(t: TestServer, adminToken: string, username: string, role: 'agent' | 'supervisor' | 'admin' = 'agent') {
  const r = await t.api('POST', '/api/users', { username, password: 'password123', displayName: username.toUpperCase(), role }, adminToken);
  if (r.status !== 201) throw new Error(`create user failed: ${JSON.stringify(r.body)}`);
  const token = await login(t, username, 'password123');
  return { user: r.body, token };
}

/** Create an active campaign with a list and leads, 24/7 calling window so tests are time-independent. */
export async function createCampaignWithLeads(
  t: TestServer,
  token: string,
  opts: { name?: string; dialMode?: 'manual' | 'preview' | 'progressive'; phones?: string[]; agentIds?: number[]; extra?: Record<string, unknown>; activate?: boolean } = {},
) {
  const c = await t.api(
    'POST',
    '/api/campaigns',
    {
      name: opts.name ?? 'Test campaign',
      dialMode: opts.dialMode ?? 'preview',
      callingHoursStart: '00:00',
      callingHoursEnd: '00:00',
      callingDays: [0, 1, 2, 3, 4, 5, 6],
      timezoneMode: 'fixed',
      fixedTimezone: 'UTC',
      ...(opts.extra ?? {}),
    },
    token,
  );
  if (c.status !== 201) throw new Error(`campaign failed: ${JSON.stringify(c.body)}`);
  const campaignId = c.body.id as number;
  const l = await t.api('POST', `/api/campaigns/${campaignId}/lists`, { name: 'List A' }, token);
  const listId = l.body.id as number;
  const phones = opts.phones ?? ['+14155550101', '+14155550102', '+14155550103'];
  const leads: any[] = [];
  for (const [i, phone] of phones.entries()) {
    const r = await t.api('POST', '/api/leads', { listId, phone, firstName: `Lead${i + 1}`, lastName: 'Test' }, token);
    if (r.status !== 201) throw new Error(`lead failed: ${JSON.stringify(r.body)}`);
    leads.push(r.body);
  }
  if (opts.agentIds) await t.api('PUT', `/api/campaigns/${campaignId}/agents`, { userIds: opts.agentIds }, token);
  if (opts.activate !== false) await t.api('POST', `/api/campaigns/${campaignId}/status`, { status: 'active' }, token);
  return { campaignId, listId, leads };
}

/* ---------- socket helpers ---------- */

export interface AgentClient {
  socket: Socket;
  call<T = any>(event: string, payload?: unknown): Promise<Ack<T>>;
  /** resolve with the next payload of `event` (or the queued one if it already arrived) */
  next<T = any>(event: string, timeoutMs?: number): Promise<T>;
  received(event: string): unknown[];
  close(): void;
}

export function connectAgent(t: TestServer, token: string): Promise<AgentClient> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(t.url + RT_NAMESPACE, { auth: { token }, transports: ['websocket'], reconnection: false });
    const queues = new Map<string, unknown[]>();
    const waiters = new Map<string, ((v: unknown) => void)[]>();
    const events = ['agent:state', 'lead:assigned', 'lead:released', 'call:started', 'call:ended', 'callback:due', 'wallboard:update', 'notice', 'session:replaced', 'campaign:changed'];
    for (const ev of events) {
      socket.on(ev, (payload: unknown) => {
        const w = waiters.get(ev);
        if (w && w.length) w.shift()!(payload);
        else queues.set(ev, [...(queues.get(ev) ?? []), payload]);
      });
    }
    socket.on('connect_error', (err) => reject(err));
    socket.on('connect', () =>
      resolve({
        socket,
        call: (event, payload = {}) => new Promise((res) => socket.emit(event, payload, (ack: Ack) => res(ack as Ack<any>))),
        next: (event, timeoutMs = 3000) =>
          new Promise((res, rej) => {
            const q = queues.get(event);
            if (q && q.length) return res(q.shift() as any);
            const timer = setTimeout(() => rej(new Error(`timeout waiting for ${event}`)), timeoutMs);
            waiters.set(event, [
              ...(waiters.get(event) ?? []),
              (v) => {
                clearTimeout(timer);
                res(v as any);
              },
            ]);
          }),
        received: (event) => queues.get(event) ?? [],
        close: () => socket.disconnect(),
      }),
    );
  });
}

/** Drive a complete simulated call on the client side. */
export async function runCall(agent: AgentClient, callId: number, opts: { answer?: boolean; cause?: string } = {}) {
  const ring = await agent.call('call:update', { callId, state: 'ringing' });
  if (!ring.ok) throw new Error(ring.error);
  if (opts.answer !== false) {
    const ans = await agent.call('call:update', { callId, state: 'answered', providerCallId: 'sim-' + callId });
    if (!ans.ok) throw new Error(ans.error);
  }
  const end = await agent.call('call:update', { callId, state: 'ended', cause: opts.cause ?? (opts.answer === false ? 'no-answer' : 'normal') });
  if (!end.ok) throw new Error(end.error);
  return end;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
