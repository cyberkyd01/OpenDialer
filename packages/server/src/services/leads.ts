import { parse as parseCsv } from 'csv-parse/sync';
import {
  isWithinCallingHours,
  normalizePhone,
  resolveLeadTimezone,
  timezoneForPhone,
  type Campaign,
  type ImportMapping,
  type ImportResult,
  type Lead,
  type LeadCreateInput,
  type LeadStatus,
  type LeadUpdateInput,
  type Settings,
} from '@opendialer/shared';
import type { DB } from '../db.js';
import { buildSet, fromJson, now, paginate } from '../db.js';
import { badRequest, notFound } from '../errors.js';
import { isDnc } from './dnc.js';

export interface LeadRow {
  id: number;
  list_id: number;
  campaign_id: number;
  phone: string;
  raw_phone: string;
  first_name: string;
  last_name: string;
  company: string;
  email: string;
  timezone: string | null;
  custom: string;
  status: LeadStatus;
  attempts: number;
  last_attempt_at: string | null;
  next_attempt_at: string | null;
  last_disposition_id: number | null;
  locked_by: number | null;
  locked_at: string | null;
  priority: number;
  notes: string;
  created_at: string;
}

export const mapLead = (r: LeadRow): Lead => ({
  id: r.id,
  listId: r.list_id,
  campaignId: r.campaign_id,
  phone: r.phone,
  rawPhone: r.raw_phone,
  firstName: r.first_name,
  lastName: r.last_name,
  company: r.company,
  email: r.email,
  timezone: r.timezone,
  custom: fromJson<Record<string, string>>(r.custom, {}),
  status: r.status,
  attempts: r.attempts,
  lastAttemptAt: r.last_attempt_at,
  nextAttemptAt: r.next_attempt_at,
  lastDispositionId: r.last_disposition_id,
  lockedBy: r.locked_by,
  lockedAt: r.locked_at,
  priority: r.priority,
  notes: r.notes,
  createdAt: r.created_at,
});

export const leadName = (l: Pick<Lead, 'firstName' | 'lastName' | 'company' | 'phone'>) =>
  [l.firstName, l.lastName].filter(Boolean).join(' ') || l.company || l.phone;

export function findLead(db: DB, id: number): Lead | null {
  const r = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
  return r ? mapLead(r) : null;
}

export function getLead(db: DB, id: number): Lead {
  const l = findLead(db, id);
  if (!l) throw notFound('Lead');
  return l;
}

export interface LeadFilter {
  campaignId?: number;
  listId?: number;
  status?: string;
  q?: string;
}

export function listLeads(db: DB, filter: LeadFilter, page: number, pageSize: number) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.campaignId) {
    where.push('campaign_id = @campaignId');
    params.campaignId = filter.campaignId;
  }
  if (filter.listId) {
    where.push('list_id = @listId');
    params.listId = filter.listId;
  }
  if (filter.status) {
    where.push('status = @status');
    params.status = filter.status;
  }
  if (filter.q) {
    const digits = filter.q.replace(/\D/g, '');
    where.push(`(first_name LIKE @q OR last_name LIKE @q OR company LIKE @q OR email LIKE @q OR (first_name || ' ' || last_name) LIKE @q ${digits ? 'OR phone LIKE @digits' : ''})`);
    params.q = `%${filter.q}%`;
    if (digits) params.digits = `%${digits}%`;
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paginate<Lead>(
    db,
    `SELECT * FROM leads ${w} ORDER BY id DESC`,
    `SELECT COUNT(*) AS n FROM leads ${w}`,
    params,
    page,
    pageSize,
    (r) => mapLead(r as unknown as LeadRow),
  );
}

export function createLead(db: DB, input: LeadCreateInput, campaignId: number, defaultCountry: string): Lead {
  const n = normalizePhone(input.phone, defaultCountry);
  if (!n.e164) throw badRequest('Invalid phone number');
  const status: LeadStatus = isDnc(db, n.e164) ? 'dnc' : n.valid ? 'new' : 'invalid';
  const r = db
    .prepare(
      `INSERT INTO leads (list_id, campaign_id, phone, raw_phone, first_name, last_name, company, email, timezone, custom, status, priority, notes)
       VALUES (@listId, @campaignId, @phone, @rawPhone, @firstName, @lastName, @company, @email, @timezone, @custom, @status, @priority, @notes)`,
    )
    .run({
      listId: input.listId,
      campaignId,
      phone: n.e164,
      rawPhone: input.phone,
      firstName: input.firstName,
      lastName: input.lastName,
      company: input.company,
      email: input.email,
      timezone: input.timezone,
      custom: JSON.stringify(input.custom ?? {}),
      status,
      priority: input.priority,
      notes: input.notes,
    });
  return getLead(db, Number(r.lastInsertRowid));
}

export function updateLead(db: DB, id: number, patch: LeadUpdateInput, defaultCountry: string): Lead {
  getLead(db, id);
  const fields: Record<string, unknown> = { ...patch };
  if (patch.phone) {
    const n = normalizePhone(patch.phone, defaultCountry);
    if (!n.e164) throw badRequest('Invalid phone number');
    fields.phone = n.e164;
    fields.rawPhone = patch.phone;
  }
  if (patch.custom) fields.custom = JSON.stringify(patch.custom);
  if (patch.status === 'new') {
    fields.nextAttemptAt = patch.nextAttemptAt ?? null;
    fields.lockedBy = null;
    fields.lockedAt = null;
  }
  const { clause, params } = buildSet(fields, [
    'firstName',
    'lastName',
    'company',
    'email',
    'phone',
    'rawPhone',
    'timezone',
    'custom',
    'priority',
    'notes',
    'status',
    'nextAttemptAt',
    'attempts',
    'lockedBy',
    'lockedAt',
  ]);
  if (clause) db.prepare(`UPDATE leads SET ${clause} WHERE id = @id`).run({ ...params, id });
  return getLead(db, id);
}

export function deleteLead(db: DB, id: number) {
  getLead(db, id);
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

export function parseCsvText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const cleaned = text.replace(/^﻿/, '');
  const rows = parseCsv(cleaned, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];
  const headers = rows.length ? Object.keys(rows[0]) : cleaned.split(/\r?\n/)[0]?.split(',').map((h) => h.trim()) ?? [];
  return { headers, rows };
}

/** Guess a column mapping from CSV headers (used by the import wizard). */
export function guessMapping(headers: string[]): Partial<ImportMapping> {
  const find = (...names: string[]) =>
    headers.find((h) => names.some((n) => h.toLowerCase().replace(/[^a-z]/g, '') === n.replace(/[^a-z]/g, '')));
  const mapping: Partial<ImportMapping> = {
    phone: find('phone', 'phonenumber', 'number', 'mobile', 'cell', 'telephone', 'tel', 'phone1'),
    firstName: find('firstname', 'first', 'givenname', 'name'),
    lastName: find('lastname', 'last', 'surname', 'familyname'),
    company: find('company', 'organization', 'organisation', 'business'),
    email: find('email', 'emailaddress', 'mail'),
    timezone: find('timezone', 'tz', 'zone'),
    priority: find('priority'),
    notes: find('notes', 'note', 'comments', 'comment'),
  };
  const used = new Set(Object.values(mapping).filter(Boolean) as string[]);
  mapping.customColumns = headers.filter((h) => !used.has(h));
  return mapping;
}

export function importLeads(
  db: DB,
  listId: number,
  campaignId: number,
  rows: Record<string, string>[],
  mapping: ImportMapping,
  settings: Settings,
): ImportResult {
  const result: ImportResult = { imported: 0, duplicates: 0, dnc: 0, invalid: 0, total: rows.length, errors: [] };
  const existing = new Set<string>();
  if (mapping.dedupeAgainst !== 'none') {
    const sql =
      mapping.dedupeAgainst === 'list' ? 'SELECT phone FROM leads WHERE list_id = ?' : 'SELECT phone FROM leads WHERE campaign_id = ?';
    for (const r of db.prepare(sql).all(mapping.dedupeAgainst === 'list' ? listId : campaignId) as { phone: string }[]) existing.add(r.phone);
  }
  const insert = db.prepare(
    `INSERT INTO leads (list_id, campaign_id, phone, raw_phone, first_name, last_name, company, email, timezone, custom, status, priority, notes)
     VALUES (@listId, @campaignId, @phone, @rawPhone, @firstName, @lastName, @company, @email, @timezone, @custom, @status, @priority, @notes)`,
  );
  const get = (row: Record<string, string>, col?: string) => (col ? (row[col] ?? '').toString().trim() : '');
  const tx = db.transaction(() => {
    rows.forEach((row, i) => {
      const raw = get(row, mapping.phone);
      const n = normalizePhone(raw, settings.defaultCountry);
      if (!n.e164 || !n.valid) {
        result.invalid++;
        if (result.errors.length < 50) result.errors.push(`Row ${i + 2}: invalid phone "${raw}"`);
        return;
      }
      if (existing.has(n.e164)) {
        result.duplicates++;
        return;
      }
      let status: LeadStatus = 'new';
      if (isDnc(db, n.e164)) {
        result.dnc++;
        if (mapping.skipDnc) return;
        status = 'dnc';
      }
      const custom: Record<string, string> = {};
      for (const c of mapping.customColumns) if (row[c] !== undefined && row[c] !== '') custom[c] = String(row[c]);
      const tz = get(row, mapping.timezone) || null;
      const priority = Number.parseInt(get(row, mapping.priority), 10);
      insert.run({
        listId,
        campaignId,
        phone: n.e164,
        rawPhone: raw,
        firstName: get(row, mapping.firstName),
        lastName: get(row, mapping.lastName),
        company: get(row, mapping.company),
        email: get(row, mapping.email),
        timezone: tz,
        custom: JSON.stringify(custom),
        status,
        priority: Number.isFinite(priority) ? Math.max(0, Math.min(100, priority)) : 0,
        notes: get(row, mapping.notes),
      });
      existing.add(n.e164);
      result.imported++;
    });
  });
  tx();
  return result;
}

/* ------------------------------------------------------------------ */
/* Dialer queue                                                        */
/* ------------------------------------------------------------------ */

export function leadTimezone(lead: Lead, campaign: Campaign, settings: Settings): string {
  return resolveLeadTimezone({
    leadTimezone: lead.timezone,
    phoneTimezone: timezoneForPhone(lead.phone),
    timezoneMode: campaign.timezoneMode,
    fixedTimezone: campaign.fixedTimezone,
    defaultTimezone: settings.defaultTimezone,
  });
}

export interface DialCheck {
  ok: boolean;
  reason?: string;
}

export interface DialCheckOptions {
  /** callbacks were scheduled by the customer – skip the calling-hours window */
  ignoreHours?: boolean;
  /** manual dials and callbacks are not bound by the campaign attempt cap */
  ignoreAttempts?: boolean;
}

/** Compliance gate applied right before any dial (automatic or manual). */
export function checkDialable(
  db: DB,
  lead: Lead | null,
  phone: string,
  campaign: Campaign | null,
  settings: Settings,
  at = new Date(),
  opts: DialCheckOptions = {},
): DialCheck {
  if (isDnc(db, phone)) return { ok: false, reason: 'Number is on the do-not-call list' };
  if (settings.maxAttemptsPerDay > 0) {
    const since = new Date(at.getTime() - 24 * 3600 * 1000).toISOString();
    const n = (db.prepare('SELECT COUNT(*) AS n FROM calls WHERE phone = ? AND started_at >= ?').get(phone, since) as { n: number }).n;
    if (n >= settings.maxAttemptsPerDay) return { ok: false, reason: `Daily attempt limit (${settings.maxAttemptsPerDay}) reached for this number` };
  }
  if (campaign) {
    const tz = lead ? leadTimezone(lead, campaign, settings) : resolveLeadTimezone({
      leadTimezone: null,
      phoneTimezone: timezoneForPhone(phone),
      timezoneMode: campaign.timezoneMode,
      fixedTimezone: campaign.fixedTimezone,
      defaultTimezone: settings.defaultTimezone,
    });
    if (!opts.ignoreHours && !isWithinCallingHours(campaign, tz, at)) return { ok: false, reason: `Outside calling hours (${tz})` };
    if (!opts.ignoreAttempts && lead && lead.attempts >= campaign.maxAttempts && lead.status !== 'callback') {
      return { ok: false, reason: 'Maximum attempts reached' };
    }
  }
  if (settings.requireConsentFlag && lead) {
    const consent = String(lead.custom.consent ?? lead.custom.Consent ?? '').toLowerCase();
    if (!['yes', 'true', '1', 'y'].includes(consent)) return { ok: false, reason: 'Lead has no consent flag' };
  }
  return { ok: true };
}

/**
 * Pick and lock the next dialable lead of a campaign for an agent.
 * Order: higher priority first, then oldest next_attempt_at / id.
 * Leads outside calling hours or on DNC are skipped (not consumed).
 */
export function claimNextLead(db: DB, campaign: Campaign, userId: number, settings: Settings, at = new Date()): Lead | null {
  const candidates = db
    .prepare(
      `SELECT l.* FROM leads l
       JOIN lists li ON li.id = l.list_id AND li.active = 1
       WHERE l.campaign_id = @campaignId
         AND l.status IN ('new','in_progress')
         AND l.locked_by IS NULL
         AND l.attempts < @maxAttempts
         AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= @now)
         AND NOT EXISTS (SELECT 1 FROM dnc d WHERE d.phone = l.phone)
       ORDER BY l.priority DESC, l.status = 'new' DESC, COALESCE(l.next_attempt_at, l.created_at) ASC, l.id ASC
       LIMIT 200`,
    )
    .all({ campaignId: campaign.id, maxAttempts: campaign.maxAttempts, now: at.toISOString() }) as LeadRow[];
  const claim = db.prepare(
    `UPDATE leads SET locked_by = @userId, locked_at = @now, status = 'in_progress' WHERE id = @id AND locked_by IS NULL`,
  );
  for (const row of candidates) {
    const lead = mapLead(row);
    const check = checkDialable(db, lead, lead.phone, campaign, settings, at);
    if (!check.ok) continue;
    const r = claim.run({ userId, now: at.toISOString(), id: lead.id });
    if (r.changes === 1) return getLead(db, lead.id);
  }
  return null;
}

/** Unlock a lead (agent skipped / disconnected / campaign paused). */
export function releaseLead(db: DB, leadId: number, opts: { requeue?: boolean; delayMinutes?: number } = {}) {
  const next = opts.delayMinutes ? new Date(Date.now() + opts.delayMinutes * 60 * 1000).toISOString() : null;
  db.prepare(`UPDATE leads SET locked_by = NULL, locked_at = NULL, next_attempt_at = COALESCE(@next, next_attempt_at) WHERE id = @id`).run({
    id: leadId,
    next,
  });
}

/** Release every lead locked by an agent (on disconnect / logout). */
export function releaseLeadsOf(db: DB, userId: number): number {
  return db.prepare('UPDATE leads SET locked_by = NULL, locked_at = NULL WHERE locked_by = ?').run(userId).changes;
}

/** Locks older than `minutes` are considered stale (crashed client) and released. */
export function releaseStaleLocks(db: DB, minutes = 30): number {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  return db.prepare('UPDATE leads SET locked_by = NULL, locked_at = NULL WHERE locked_at IS NOT NULL AND locked_at < ?').run(cutoff).changes;
}

/** Apply a disposition outcome to the lead's queue state. */
export function applyDispositionToLead(
  db: DB,
  leadId: number,
  disposition: { id: number; category: string; retryMinutes: number | null },
  campaign: Campaign,
  hasCallback: boolean,
) {
  const lead = getLead(db, leadId);
  const attempts = lead.attempts + 1;
  let status: LeadStatus;
  let nextAttemptAt: string | null = null;
  if (hasCallback) {
    status = 'callback';
  } else if (disposition.category === 'callback') {
    // "callback" chosen without a time: treat as a normal retry after the campaign delay
    status = attempts >= campaign.maxAttempts ? 'done' : 'in_progress';
    if (status === 'in_progress') nextAttemptAt = new Date(Date.now() + campaign.retryMinutes * 60 * 1000).toISOString();
  } else if (disposition.category === 'dnc') {
    status = 'dnc';
  } else if (disposition.category === 'invalid') {
    status = 'invalid';
  } else if (disposition.retryMinutes == null) {
    status = 'done';
  } else if (attempts >= campaign.maxAttempts) {
    status = 'done';
  } else {
    status = 'in_progress';
    nextAttemptAt = new Date(Date.now() + disposition.retryMinutes * 60 * 1000).toISOString();
  }
  db.prepare(
    `UPDATE leads SET attempts = @attempts, last_attempt_at = @now, next_attempt_at = CASE WHEN @status = 'callback' THEN next_attempt_at ELSE @next END,
       last_disposition_id = @dispId, status = @status, locked_by = NULL, locked_at = NULL WHERE id = @id`,
  ).run({ attempts, now: now(), next: nextAttemptAt, dispId: disposition.id, status, id: leadId });
  return getLead(db, leadId);
}
