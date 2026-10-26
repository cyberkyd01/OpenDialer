import type { Campaign, CampaignCreateInput, CampaignStats, CampaignStatus, CampaignUpdateInput } from '@opendialer/shared';
import type { DB } from '../db.js';
import { buildSet, fromJson, now } from '../db.js';
import { notFound } from '../errors.js';

export interface CampaignRow {
  id: number;
  name: string;
  description: string;
  status: CampaignStatus;
  dial_mode: Campaign['dialMode'];
  caller_id: string;
  script_id: number | null;
  calling_hours_start: string;
  calling_hours_end: string;
  calling_days: string;
  timezone_mode: 'lead' | 'fixed';
  fixed_timezone: string;
  max_attempts: number;
  retry_minutes: number;
  preview_timeout_sec: number;
  wrapup_timeout_sec: number;
  recording: Campaign['recording'];
  dial_prefix: string;
  created_at: string;
  updated_at: string;
}

export const mapCampaign = (r: CampaignRow): Campaign => ({
  id: r.id,
  name: r.name,
  description: r.description,
  status: r.status,
  dialMode: r.dial_mode,
  callerId: r.caller_id,
  scriptId: r.script_id,
  callingHoursStart: r.calling_hours_start,
  callingHoursEnd: r.calling_hours_end,
  callingDays: fromJson<number[]>(r.calling_days, [1, 2, 3, 4, 5]),
  timezoneMode: r.timezone_mode,
  fixedTimezone: r.fixed_timezone,
  maxAttempts: r.max_attempts,
  retryMinutes: r.retry_minutes,
  previewTimeoutSec: r.preview_timeout_sec,
  wrapupTimeoutSec: r.wrapup_timeout_sec,
  recording: r.recording,
  dialPrefix: r.dial_prefix,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export function listCampaigns(db: DB): Campaign[] {
  return (db.prepare(`SELECT * FROM campaigns ORDER BY status = 'active' DESC, name`).all() as CampaignRow[]).map(mapCampaign);
}

/** Campaigns an agent may join (assigned + not draft/completed). Supervisors/admins see all. */
export function campaignsForUser(db: DB, userId: number, role: string): Campaign[] {
  if (role !== 'agent') return listCampaigns(db).filter((c) => c.status !== 'completed');
  return (
    db
      .prepare(
        `SELECT c.* FROM campaigns c JOIN campaign_agents ca ON ca.campaign_id = c.id
         WHERE ca.user_id = ? AND c.status IN ('active','paused') ORDER BY c.name`,
      )
      .all(userId) as CampaignRow[]
  ).map(mapCampaign);
}

export function findCampaign(db: DB, id: number): Campaign | null {
  const r = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) as CampaignRow | undefined;
  return r ? mapCampaign(r) : null;
}

export function getCampaign(db: DB, id: number): Campaign {
  const c = findCampaign(db, id);
  if (!c) throw notFound('Campaign');
  return c;
}

export function createCampaign(db: DB, input: CampaignCreateInput): Campaign {
  const r = db
    .prepare(
      `INSERT INTO campaigns (name, description, dial_mode, caller_id, script_id, calling_hours_start, calling_hours_end,
        calling_days, timezone_mode, fixed_timezone, max_attempts, retry_minutes, preview_timeout_sec, wrapup_timeout_sec, recording, dial_prefix)
       VALUES (@name, @description, @dialMode, @callerId, @scriptId, @callingHoursStart, @callingHoursEnd,
        @callingDays, @timezoneMode, @fixedTimezone, @maxAttempts, @retryMinutes, @previewTimeoutSec, @wrapupTimeoutSec, @recording, @dialPrefix)`,
    )
    .run({ ...input, callingDays: JSON.stringify(input.callingDays) });
  return getCampaign(db, Number(r.lastInsertRowid));
}

export function updateCampaign(db: DB, id: number, patch: CampaignUpdateInput): Campaign {
  getCampaign(db, id);
  const fields: Record<string, unknown> = { ...patch, updatedAt: now() };
  if (patch.callingDays) fields.callingDays = JSON.stringify(patch.callingDays);
  const { clause, params } = buildSet(fields, [
    'name',
    'description',
    'dialMode',
    'callerId',
    'scriptId',
    'callingHoursStart',
    'callingHoursEnd',
    'callingDays',
    'timezoneMode',
    'fixedTimezone',
    'maxAttempts',
    'retryMinutes',
    'previewTimeoutSec',
    'wrapupTimeoutSec',
    'recording',
    'dialPrefix',
    'updatedAt',
  ]);
  db.prepare(`UPDATE campaigns SET ${clause} WHERE id = @id`).run({ ...params, id });
  return getCampaign(db, id);
}

export function setCampaignStatus(db: DB, id: number, status: CampaignStatus): Campaign {
  getCampaign(db, id);
  db.prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  if (status !== 'active') {
    // release any leads still locked by agents – they will be re-queued
    db.prepare(`UPDATE leads SET locked_by = NULL, locked_at = NULL WHERE campaign_id = ? AND locked_by IS NOT NULL`).run(id);
  }
  return getCampaign(db, id);
}

export function deleteCampaign(db: DB, id: number) {
  getCampaign(db, id);
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
}

export function getCampaignAgentIds(db: DB, id: number): number[] {
  return (db.prepare('SELECT user_id FROM campaign_agents WHERE campaign_id = ?').all(id) as { user_id: number }[]).map((r) => r.user_id);
}

export function setCampaignAgents(db: DB, id: number, userIds: number[]) {
  getCampaign(db, id);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM campaign_agents WHERE campaign_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO campaign_agents (campaign_id, user_id) VALUES (?, ?)');
    for (const u of userIds) ins.run(id, u);
  });
  tx();
  return getCampaignAgentIds(db, id);
}

export function isAgentOnCampaign(db: DB, campaignId: number, userId: number, role: string): boolean {
  if (role !== 'agent') return true;
  return Boolean(db.prepare('SELECT 1 FROM campaign_agents WHERE campaign_id = ? AND user_id = ?').get(campaignId, userId));
}

/**
 * Reset leads of a campaign (or list) back to "new" so they can be dialed again.
 * DNC leads are never reset.
 */
export function resetLeads(db: DB, campaignId: number, opts: { listId?: number; onlyStatus?: string[] } = {}): number {
  const where: string[] = ['campaign_id = @campaignId', `status <> 'dnc'`];
  const params: Record<string, unknown> = { campaignId };
  if (opts.listId) {
    where.push('list_id = @listId');
    params.listId = opts.listId;
  }
  if (opts.onlyStatus?.length) {
    where.push(`status IN (${opts.onlyStatus.map((_, i) => `@s${i}`).join(',')})`);
    opts.onlyStatus.forEach((s, i) => (params[`s${i}`] = s));
  }
  const r = db
    .prepare(
      `UPDATE leads SET status = 'new', attempts = 0, next_attempt_at = NULL, locked_by = NULL, locked_at = NULL, last_disposition_id = NULL
       WHERE ${where.join(' AND ')}`,
    )
    .run(params);
  return r.changes;
}

export function campaignStats(db: DB, id: number, onlineAgents = 0): CampaignStats {
  const counts = db
    .prepare(
      `SELECT
        COUNT(*) AS total,
        SUM(status = 'new') AS new_, SUM(status = 'in_progress') AS in_progress, SUM(status = 'callback') AS callback,
        SUM(status = 'done') AS done, SUM(status = 'dnc') AS dnc, SUM(status = 'invalid') AS invalid,
        SUM(status IN ('new','in_progress') AND locked_by IS NULL AND (next_attempt_at IS NULL OR next_attempt_at <= @now)) AS dialable
       FROM leads l WHERE campaign_id = @id AND list_id IN (SELECT id FROM lists WHERE campaign_id = @id AND active = 1)`,
    )
    .get({ id, now: now() }) as Record<string, number | null>;
  const calls = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(result = 'answered') AS answered,
        SUM(started_at >= @today) AS today,
        SUM(COALESCE(d.counts_as_contact, 0)) AS contacts, SUM(COALESCE(d.is_sale, 0)) AS sales,
        AVG(CASE WHEN result = 'answered' THEN talk_sec END) AS avg_talk
       FROM calls c LEFT JOIN dispositions d ON d.id = c.disposition_id WHERE c.campaign_id = @id`,
    )
    .get({ id, today: new Date().toISOString().slice(0, 10) }) as Record<string, number | null>;
  return {
    campaignId: id,
    leadsTotal: counts.total ?? 0,
    leadsNew: counts.new_ ?? 0,
    leadsInProgress: counts.in_progress ?? 0,
    leadsCallback: counts.callback ?? 0,
    leadsDone: counts.done ?? 0,
    leadsDnc: counts.dnc ?? 0,
    leadsInvalid: counts.invalid ?? 0,
    dialable: counts.dialable ?? 0,
    callsTotal: calls.total ?? 0,
    callsAnswered: calls.answered ?? 0,
    callsToday: calls.today ?? 0,
    contacts: calls.contacts ?? 0,
    sales: calls.sales ?? 0,
    agentsOnline: onlineAgents,
    avgTalkSec: Math.round(calls.avg_talk ?? 0),
  };
}
