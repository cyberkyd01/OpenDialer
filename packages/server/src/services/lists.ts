import type { LeadList } from '@opendialer/shared';
import type { DB } from '../db.js';
import { buildSet, fromBool } from '../db.js';
import { notFound } from '../errors.js';

interface Row {
  id: number;
  campaign_id: number;
  name: string;
  active: number;
  created_at: string;
  lead_count: number;
}

const map = (r: Row): LeadList => ({
  id: r.id,
  campaignId: r.campaign_id,
  name: r.name,
  active: fromBool(r.active),
  leadCount: r.lead_count ?? 0,
  createdAt: r.created_at,
});

const SELECT = `SELECT l.*, (SELECT COUNT(*) FROM leads WHERE list_id = l.id) AS lead_count FROM lists l`;

export function listLists(db: DB, campaignId: number): LeadList[] {
  return (db.prepare(`${SELECT} WHERE l.campaign_id = ? ORDER BY l.id`).all(campaignId) as Row[]).map(map);
}

export function getList(db: DB, id: number): LeadList {
  const r = db.prepare(`${SELECT} WHERE l.id = ?`).get(id) as Row | undefined;
  if (!r) throw notFound('List');
  return map(r);
}

export function createList(db: DB, campaignId: number, input: { name: string; active: boolean }): LeadList {
  const r = db.prepare('INSERT INTO lists (campaign_id, name, active) VALUES (?, ?, ?)').run(campaignId, input.name, input.active ? 1 : 0);
  return getList(db, Number(r.lastInsertRowid));
}

export function updateList(db: DB, id: number, patch: { name?: string; active?: boolean }): LeadList {
  getList(db, id);
  const fields: Record<string, unknown> = { ...patch };
  if (typeof patch.active === 'boolean') fields.active = patch.active ? 1 : 0;
  const { clause, params } = buildSet(fields, ['name', 'active']);
  if (clause) db.prepare(`UPDATE lists SET ${clause} WHERE id = @id`).run({ ...params, id });
  return getList(db, id);
}

export function deleteList(db: DB, id: number) {
  getList(db, id);
  db.prepare('DELETE FROM lists WHERE id = ?').run(id);
}
