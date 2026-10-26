import type { Callback } from '@opendialer/shared';
import type { DB } from '../db.js';
import { buildSet, now } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { mapLead, type LeadRow } from './leads.js';

interface Row {
  id: number;
  lead_id: number;
  campaign_id: number;
  user_id: number | null;
  scheduled_at: string;
  note: string;
  status: Callback['status'];
  created_by: number;
  created_at: string;
  agent_name?: string | null;
}

const SELECT = `SELECT cb.*, u.display_name AS agent_name FROM callbacks cb LEFT JOIN users u ON u.id = cb.user_id`;

export function mapCallback(db: DB, r: Row, withLead = true): Callback {
  const lead = withLead ? (db.prepare('SELECT * FROM leads WHERE id = ?').get(r.lead_id) as LeadRow | undefined) : undefined;
  return {
    id: r.id,
    leadId: r.lead_id,
    campaignId: r.campaign_id,
    userId: r.user_id,
    scheduledAt: r.scheduled_at,
    note: r.note,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    agentName: r.agent_name ?? null,
    ...(lead ? { lead: mapLead(lead) } : {}),
  };
}

export function createCallback(
  db: DB,
  input: { leadId: number; campaignId: number; userId: number | null; scheduledAt: string; note: string; createdBy: number },
): Callback {
  const at = new Date(input.scheduledAt);
  if (Number.isNaN(at.getTime())) throw badRequest('Invalid callback time');
  // one pending callback per lead
  db.prepare(`UPDATE callbacks SET status = 'cancelled' WHERE lead_id = ? AND status = 'pending'`).run(input.leadId);
  const r = db
    .prepare(
      `INSERT INTO callbacks (lead_id, campaign_id, user_id, scheduled_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.leadId, input.campaignId, input.userId, at.toISOString(), input.note, input.createdBy);
  db.prepare(`UPDATE leads SET status = 'callback', next_attempt_at = ? WHERE id = ?`).run(at.toISOString(), input.leadId);
  return getCallback(db, Number(r.lastInsertRowid));
}

export function getCallback(db: DB, id: number): Callback {
  const r = db.prepare(`${SELECT} WHERE cb.id = ?`).get(id) as Row | undefined;
  if (!r) throw notFound('Callback');
  return mapCallback(db, r);
}

export function listCallbacks(
  db: DB,
  filter: { userId?: number; mine?: boolean; status?: string; campaignId?: number; dueBefore?: string },
): Callback[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.status) {
    where.push('cb.status = @status');
    params.status = filter.status;
  }
  if (filter.campaignId) {
    where.push('cb.campaign_id = @campaignId');
    params.campaignId = filter.campaignId;
  }
  if (filter.mine && filter.userId) {
    where.push('(cb.user_id = @userId OR cb.user_id IS NULL)');
    params.userId = filter.userId;
  } else if (filter.userId) {
    where.push('cb.user_id = @userId');
    params.userId = filter.userId;
  }
  if (filter.dueBefore) {
    where.push('cb.scheduled_at <= @dueBefore');
    params.dueBefore = filter.dueBefore;
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return (db.prepare(`${SELECT} ${w} ORDER BY cb.scheduled_at ASC LIMIT 500`).all(params) as Row[]).map((r) => mapCallback(db, r));
}

export function updateCallback(db: DB, id: number, patch: { scheduledAt?: string; note?: string; status?: string; userId?: number | null }): Callback {
  getCallback(db, id);
  const fields: Record<string, unknown> = { ...patch };
  if (patch.scheduledAt) {
    const at = new Date(patch.scheduledAt);
    if (Number.isNaN(at.getTime())) throw badRequest('Invalid callback time');
    fields.scheduledAt = at.toISOString();
  }
  const { clause, params } = buildSet(fields, ['scheduledAt', 'note', 'status', 'userId']);
  if (clause) db.prepare(`UPDATE callbacks SET ${clause} WHERE id = @id`).run({ ...params, id });
  const cb = getCallback(db, id);
  if (patch.status === 'cancelled') {
    // lead goes back to the normal queue
    db.prepare(`UPDATE leads SET status = 'in_progress', next_attempt_at = NULL WHERE id = ? AND status = 'callback'`).run(cb.leadId);
  } else if (patch.scheduledAt && cb.status === 'pending') {
    db.prepare(`UPDATE leads SET status = 'callback', next_attempt_at = ? WHERE id = ?`).run(cb.scheduledAt, cb.leadId);
  }
  return cb;
}

/** Pending callbacks that are due now for this agent (personal first, then campaign-wide). */
export function dueCallbacksFor(db: DB, userId: number, campaignId: number): Row[] {
  return db
    .prepare(
      `${SELECT} WHERE cb.status = 'pending' AND cb.campaign_id = @campaignId AND cb.scheduled_at <= @now
         AND (cb.user_id = @userId OR cb.user_id IS NULL)
       ORDER BY (cb.user_id = @userId) DESC, cb.scheduled_at ASC LIMIT 20`,
    )
    .all({ campaignId, userId, now: now() }) as Row[];
}

/** Personal callbacks due in the next `withinMinutes` that the agent has not been reminded about. */
export function upcomingPersonalCallbacks(db: DB, userId: number, withinMinutes: number): Callback[] {
  const until = new Date(Date.now() + withinMinutes * 60 * 1000).toISOString();
  return (
    db
      .prepare(`${SELECT} WHERE cb.status = 'pending' AND cb.user_id = @userId AND cb.scheduled_at <= @until ORDER BY cb.scheduled_at`)
      .all({ userId, until }) as Row[]
  ).map((r) => mapCallback(db, r));
}
