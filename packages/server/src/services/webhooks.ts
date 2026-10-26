import crypto from 'node:crypto';
import type { Webhook, WebhookCreateInput } from '@opendialer/shared';
import type { Ctx } from '../context.js';
import type { DB } from '../db.js';
import { buildSet, fromBool, fromJson } from '../db.js';
import { notFound } from '../errors.js';
import { findCall } from './calls.js';
import { getCallback } from './callbacks.js';

interface Row {
  id: number;
  url: string;
  events: string;
  secret: string;
  active: number;
  created_at: string;
}
const map = (r: Row): Webhook => ({
  id: r.id,
  url: r.url,
  events: fromJson<string[]>(r.events, []),
  secret: r.secret,
  active: fromBool(r.active),
  createdAt: r.created_at,
});

export function listWebhooks(db: DB): Webhook[] {
  return (db.prepare('SELECT * FROM webhooks ORDER BY id').all() as Row[]).map(map);
}
export function getWebhook(db: DB, id: number): Webhook {
  const r = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('Webhook');
  return map(r);
}
export function createWebhook(db: DB, input: WebhookCreateInput): Webhook {
  const r = db
    .prepare('INSERT INTO webhooks (url, events, secret, active) VALUES (?, ?, ?, ?)')
    .run(input.url, JSON.stringify(input.events), input.secret, input.active ? 1 : 0);
  return getWebhook(db, Number(r.lastInsertRowid));
}
export function updateWebhook(db: DB, id: number, patch: Partial<WebhookCreateInput>): Webhook {
  getWebhook(db, id);
  const fields: Record<string, unknown> = { ...patch };
  if (patch.events) fields.events = JSON.stringify(patch.events);
  if (typeof patch.active === 'boolean') fields.active = patch.active ? 1 : 0;
  const { clause, params } = buildSet(fields, ['url', 'events', 'secret', 'active']);
  if (clause) db.prepare(`UPDATE webhooks SET ${clause} WHERE id = @id`).run({ ...params, id });
  return getWebhook(db, id);
}
export function deleteWebhook(db: DB, id: number) {
  getWebhook(db, id);
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
}

/* ---------- dispatcher ---------- */

export async function deliver(hook: Webhook, event: string, payload: unknown, log: Ctx['log'], attempt = 1): Promise<boolean> {
  const body = JSON.stringify({ event, at: new Date().toISOString(), data: payload });
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-opendialer-event': event };
  if (hook.secret) headers['x-opendialer-signature'] = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
  try {
    const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    if (res.ok) return true;
    log.warn({ url: hook.url, status: res.status, event }, 'webhook non-2xx');
  } catch (err) {
    log.warn({ url: hook.url, event, err: (err as Error).message }, 'webhook failed');
  }
  if (attempt < 3) {
    await new Promise((r) => setTimeout(r, attempt * 2000));
    return deliver(hook, event, payload, log, attempt + 1);
  }
  return false;
}

/** Subscribe the dispatcher to the domain bus. Returns an unsubscribe function. */
export function startWebhookDispatcher(ctx: Ctx) {
  const send = (event: string, payload: unknown) => {
    const hooks = listWebhooks(ctx.db).filter((h) => h.active && (h.events.includes(event) || h.events.includes('*')));
    for (const h of hooks) void deliver(h, event, payload, ctx.log);
  };
  const subs = [
    ctx.bus.onDomain('call.started', ({ callId }) => send('call.started', findCall(ctx.db, callId))),
    ctx.bus.onDomain('call.ended', ({ callId }) => send('call.ended', findCall(ctx.db, callId))),
    ctx.bus.onDomain('call.disposed', ({ callId }) => send('call.disposed', findCall(ctx.db, callId))),
    ctx.bus.onDomain('lead.dnc', (p) => send('lead.dnc', p)),
    ctx.bus.onDomain('callback.created', ({ callbackId }) => send('callback.created', getCallback(ctx.db, callbackId))),
    ctx.bus.onDomain('campaign.status', (p) => send('campaign.status', p)),
    ctx.bus.onDomain('agent.state', (p) => send('agent.state', p)),
  ];
  return () => subs.forEach((u) => u());
}
