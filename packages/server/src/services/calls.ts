import fs from 'node:fs';
import path from 'node:path';
import type { CallLog, CallResult } from '@opendialer/shared';
import type { DB } from '../db.js';
import { now, paginate } from '../db.js';
import { notFound } from '../errors.js';

export interface CallRow {
  id: number;
  lead_id: number | null;
  campaign_id: number | null;
  user_id: number;
  phone: string;
  direction: 'out' | 'in';
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  duration_sec: number;
  talk_sec: number;
  result: CallResult;
  disposition_id: number | null;
  notes: string;
  recording_path: string | null;
  provider_call_id: string | null;
  hangup_cause: string;
  agent_name?: string;
  campaign_name?: string;
  disposition_code?: string | null;
  lead_first?: string;
  lead_last?: string;
  lead_company?: string;
}

export const mapCall = (r: CallRow): CallLog => ({
  id: r.id,
  leadId: r.lead_id,
  campaignId: r.campaign_id,
  userId: r.user_id,
  phone: r.phone,
  direction: r.direction,
  startedAt: r.started_at,
  answeredAt: r.answered_at,
  endedAt: r.ended_at,
  durationSec: r.duration_sec,
  talkSec: r.talk_sec,
  result: r.result,
  dispositionId: r.disposition_id,
  notes: r.notes,
  hasRecording: Boolean(r.recording_path),
  hangupCause: r.hangup_cause,
  agentName: r.agent_name,
  campaignName: r.campaign_name,
  dispositionCode: r.disposition_code ?? null,
  leadName: [r.lead_first, r.lead_last].filter(Boolean).join(' ') || r.lead_company || undefined,
});

const SELECT = `SELECT c.*, u.display_name AS agent_name, ca.name AS campaign_name, d.code AS disposition_code,
  l.first_name AS lead_first, l.last_name AS lead_last, l.company AS lead_company
  FROM calls c
  LEFT JOIN users u ON u.id = c.user_id
  LEFT JOIN campaigns ca ON ca.id = c.campaign_id
  LEFT JOIN dispositions d ON d.id = c.disposition_id
  LEFT JOIN leads l ON l.id = c.lead_id`;

export function getCall(db: DB, id: number): CallLog {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as CallRow | undefined;
  if (!r) throw notFound('Call');
  return mapCall(r);
}

export function findCall(db: DB, id: number): CallLog | null {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(id) as CallRow | undefined;
  return r ? mapCall(r) : null;
}

export function startCall(
  db: DB,
  input: { leadId: number | null; campaignId: number | null; userId: number; phone: string; direction?: 'out' | 'in' },
): CallLog {
  const r = db
    .prepare(`INSERT INTO calls (lead_id, campaign_id, user_id, phone, direction, started_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(input.leadId, input.campaignId, input.userId, input.phone, input.direction ?? 'out', now());
  return getCall(db, Number(r.lastInsertRowid));
}

export function markAnswered(db: DB, id: number, providerCallId?: string) {
  db.prepare(`UPDATE calls SET answered_at = COALESCE(answered_at, ?), provider_call_id = COALESCE(?, provider_call_id) WHERE id = ?`).run(
    now(),
    providerCallId ?? null,
    id,
  );
}

export function causeToResult(cause: string | undefined, answered: boolean): CallResult {
  if (answered) return 'answered';
  const c = (cause ?? '').toLowerCase();
  if (c.includes('busy')) return 'busy';
  if (c.includes('no-answer') || c.includes('noanswer') || c.includes('timeout') || c.includes('no answer')) return 'no_answer';
  if (c.includes('cancel') || c.includes('normal')) return 'cancelled';
  if (c.includes('fail') || c.includes('reject') || c.includes('unavailable') || c.includes('error') || /^[45]\d\d/.test(c)) return 'failed';
  return c ? 'failed' : 'cancelled';
}

export function endCall(db: DB, id: number, cause: string | undefined, providerCallId?: string): CallLog {
  const existing = getCall(db, id);
  if (existing.endedAt) return existing;
  const endedAt = new Date();
  const started = new Date(existing.startedAt);
  const answered = existing.answeredAt ? new Date(existing.answeredAt) : null;
  const durationSec = Math.max(0, Math.round((endedAt.getTime() - started.getTime()) / 1000));
  const talkSec = answered ? Math.max(0, Math.round((endedAt.getTime() - answered.getTime()) / 1000)) : 0;
  db.prepare(
    `UPDATE calls SET ended_at = ?, duration_sec = ?, talk_sec = ?, result = ?, hangup_cause = ?, provider_call_id = COALESCE(?, provider_call_id) WHERE id = ?`,
  ).run(endedAt.toISOString(), durationSec, talkSec, causeToResult(cause, Boolean(answered)), cause ?? '', providerCallId ?? null, id);
  return getCall(db, id);
}

export function disposeCall(db: DB, id: number, dispositionId: number, notes: string) {
  db.prepare(`UPDATE calls SET disposition_id = ?, notes = ? WHERE id = ?`).run(dispositionId, notes, id);
  return getCall(db, id);
}

export interface CallFilter {
  campaignId?: number;
  userId?: number;
  leadId?: number;
  from?: string;
  to?: string;
  result?: string;
  dispositionId?: number;
  phone?: string;
}

function whereFor(f: CallFilter) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (f.campaignId) (where.push('c.campaign_id = @campaignId'), (params.campaignId = f.campaignId));
  if (f.userId) (where.push('c.user_id = @userId'), (params.userId = f.userId));
  if (f.leadId) (where.push('c.lead_id = @leadId'), (params.leadId = f.leadId));
  if (f.from) (where.push('c.started_at >= @from'), (params.from = f.from));
  if (f.to) (where.push('c.started_at <= @to'), (params.to = f.to));
  if (f.result) (where.push('c.result = @result'), (params.result = f.result));
  if (f.dispositionId) (where.push('c.disposition_id = @dispositionId'), (params.dispositionId = f.dispositionId));
  if (f.phone) (where.push('c.phone LIKE @phone'), (params.phone = `%${f.phone.replace(/\D/g, '')}%`));
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listCalls(db: DB, f: CallFilter, page: number, pageSize: number) {
  const { w, params } = whereFor(f);
  return paginate<CallLog>(db, `${SELECT} ${w} ORDER BY c.id DESC`, `SELECT COUNT(*) AS n FROM calls c ${w}`, params, page, pageSize, (r) =>
    mapCall(r as unknown as CallRow),
  );
}

export function iterateCalls(db: DB, f: CallFilter): CallLog[] {
  const { w, params } = whereFor(f);
  return (db.prepare(`${SELECT} ${w} ORDER BY c.id DESC LIMIT 100000`).all(params) as CallRow[]).map(mapCall);
}

/* ---------- recordings ---------- */

export function recordingDir(dataDir: string) {
  return path.join(dataDir, 'recordings');
}

export function saveRecording(db: DB, dataDir: string, callId: number, buffer: Buffer, mime: string): string {
  getCall(db, callId);
  const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : mime.includes('wav') ? 'wav' : 'webm';
  const d = new Date();
  const rel = path.join(String(d.getUTCFullYear()), String(d.getUTCMonth() + 1).padStart(2, '0'), `call-${callId}.${ext}`);
  const full = path.join(recordingDir(dataDir), rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  db.prepare('UPDATE calls SET recording_path = ? WHERE id = ?').run(rel, callId);
  return rel;
}

export function recordingFile(db: DB, dataDir: string, callId: number): { file: string; mime: string } | null {
  const r = db.prepare('SELECT recording_path FROM calls WHERE id = ?').get(callId) as { recording_path: string | null } | undefined;
  if (!r?.recording_path) return null;
  const file = path.join(recordingDir(dataDir), r.recording_path);
  if (!fs.existsSync(file)) return null;
  const ext = path.extname(file).slice(1);
  const mime = ext === 'ogg' ? 'audio/ogg' : ext === 'm4a' ? 'audio/mp4' : ext === 'wav' ? 'audio/wav' : 'audio/webm';
  return { file, mime };
}

/** Calls that were never closed (client crashed) are closed as 'unknown'. */
export function closeDanglingCalls(db: DB, olderThanMinutes = 120): number {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  return db
    .prepare(`UPDATE calls SET ended_at = ?, result = 'unknown', hangup_cause = 'dangling' WHERE ended_at IS NULL AND started_at < ?`)
    .run(now(), cutoff).changes;
}
