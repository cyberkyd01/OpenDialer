import type { DB } from '../db.js';

export interface DateRange {
  from?: string;
  to?: string;
}

function rangeWhere(r: DateRange, col = 'c.started_at') {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (r.from) (where.push(`${col} >= @from`), (params.from = r.from));
  if (r.to) (where.push(`${col} <= @to`), (params.to = r.to));
  return { w: where.length ? `AND ${where.join(' AND ')}` : '', params };
}

export interface CampaignReportRow {
  campaignId: number;
  campaignName: string;
  calls: number;
  answered: number;
  contacts: number;
  sales: number;
  talkSec: number;
  avgTalkSec: number;
  answerRate: number;
  contactRate: number;
  conversionRate: number;
}

export function campaignReport(db: DB, range: DateRange): CampaignReportRow[] {
  const { w, params } = rangeWhere(range);
  const rows = db
    .prepare(
      `SELECT ca.id AS campaign_id, ca.name AS campaign_name,
        COUNT(c.id) AS calls, SUM(c.result = 'answered') AS answered,
        SUM(COALESCE(d.counts_as_contact,0)) AS contacts, SUM(COALESCE(d.is_sale,0)) AS sales,
        SUM(c.talk_sec) AS talk_sec
       FROM campaigns ca
       LEFT JOIN calls c ON c.campaign_id = ca.id ${w.replace(/^AND/, 'AND')}
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       GROUP BY ca.id ORDER BY ca.name`,
    )
    .all(params) as Record<string, number | string | null>[];
  return rows.map((r) => {
    const calls = Number(r.calls ?? 0);
    const answered = Number(r.answered ?? 0);
    const contacts = Number(r.contacts ?? 0);
    const sales = Number(r.sales ?? 0);
    const talk = Number(r.talk_sec ?? 0);
    return {
      campaignId: Number(r.campaign_id),
      campaignName: String(r.campaign_name),
      calls,
      answered,
      contacts,
      sales,
      talkSec: talk,
      avgTalkSec: answered ? Math.round(talk / answered) : 0,
      answerRate: calls ? +(answered / calls).toFixed(3) : 0,
      contactRate: calls ? +(contacts / calls).toFixed(3) : 0,
      conversionRate: contacts ? +(sales / contacts).toFixed(3) : 0,
    };
  });
}

export interface AgentReportRow {
  userId: number;
  agentName: string;
  calls: number;
  answered: number;
  contacts: number;
  sales: number;
  talkSec: number;
  avgTalkSec: number;
  readySec: number;
  pauseSec: number;
  wrapupSec: number;
}

export function agentReport(db: DB, range: DateRange): AgentReportRow[] {
  const { w, params } = rangeWhere(range);
  const rows = db
    .prepare(
      `SELECT u.id AS user_id, u.display_name AS agent_name,
        COUNT(c.id) AS calls, SUM(c.result = 'answered') AS answered,
        SUM(COALESCE(d.counts_as_contact,0)) AS contacts, SUM(COALESCE(d.is_sale,0)) AS sales, SUM(c.talk_sec) AS talk_sec
       FROM users u
       LEFT JOIN calls c ON c.user_id = u.id ${w}
       LEFT JOIN dispositions d ON d.id = c.disposition_id
       WHERE u.role IN ('agent','supervisor','admin')
       GROUP BY u.id ORDER BY u.display_name`,
    )
    .all(params) as Record<string, number | string | null>[];
  const times = stateTimes(db, range);
  return rows.map((r) => {
    const id = Number(r.user_id);
    const answered = Number(r.answered ?? 0);
    const talk = Number(r.talk_sec ?? 0);
    const t = times.get(id) ?? { ready: 0, paused: 0, wrapup: 0 };
    return {
      userId: id,
      agentName: String(r.agent_name),
      calls: Number(r.calls ?? 0),
      answered,
      contacts: Number(r.contacts ?? 0),
      sales: Number(r.sales ?? 0),
      talkSec: talk,
      avgTalkSec: answered ? Math.round(talk / answered) : 0,
      readySec: t.ready,
      pauseSec: t.paused,
      wrapupSec: t.wrapup,
    };
  });
}

/** Seconds spent in ready / paused / wrapup per agent, from the state log. */
function stateTimes(db: DB, range: DateRange) {
  const { w, params } = rangeWhere(range, 'at');
  const rows = db
    .prepare(`SELECT user_id, state, at FROM agent_state_log WHERE 1=1 ${w} ORDER BY user_id, at`)
    .all(params) as { user_id: number; state: string; at: string }[];
  const out = new Map<number, { ready: number; paused: number; wrapup: number }>();
  const end = range.to ? new Date(range.to).getTime() : Date.now();
  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    const next = rows[i + 1];
    const until = next && next.user_id === cur.user_id ? new Date(next.at).getTime() : Math.min(end, Date.now());
    const sec = Math.max(0, Math.round((until - new Date(cur.at).getTime()) / 1000));
    const t = out.get(cur.user_id) ?? { ready: 0, paused: 0, wrapup: 0 };
    if (cur.state === 'ready') t.ready += sec;
    else if (cur.state === 'paused') t.paused += sec;
    else if (cur.state === 'wrapup') t.wrapup += sec;
    out.set(cur.user_id, t);
  }
  return out;
}

export function dispositionReport(db: DB, range: DateRange, campaignId?: number) {
  const { w, params } = rangeWhere(range);
  const cw = campaignId ? 'AND c.campaign_id = @campaignId' : '';
  const rows = db
    .prepare(
      `SELECT d.id, d.code, d.label, d.color, d.category, COUNT(c.id) AS n
       FROM dispositions d LEFT JOIN calls c ON c.disposition_id = d.id ${w} ${cw}
       GROUP BY d.id ORDER BY d.sort_order`,
    )
    .all({ ...params, campaignId }) as { id: number; code: string; label: string; color: string; category: string; n: number }[];
  const noDisp = (
    db.prepare(`SELECT COUNT(*) AS n FROM calls c WHERE c.disposition_id IS NULL ${w} ${cw}`).get({ ...params, campaignId }) as { n: number }
  ).n;
  return { dispositions: rows, undisposed: noDisp };
}

export function hourlyReport(db: DB, range: DateRange, campaignId?: number) {
  const { w, params } = rangeWhere(range);
  const cw = campaignId ? 'AND c.campaign_id = @campaignId' : '';
  return db
    .prepare(
      `SELECT substr(c.started_at, 12, 2) AS hour, COUNT(*) AS calls, SUM(c.result = 'answered') AS answered,
        SUM(COALESCE(d.counts_as_contact,0)) AS contacts
       FROM calls c LEFT JOIN dispositions d ON d.id = c.disposition_id WHERE 1=1 ${w} ${cw}
       GROUP BY hour ORDER BY hour`,
    )
    .all({ ...params, campaignId }) as { hour: string; calls: number; answered: number; contacts: number }[];
}

export function todaySummary(db: DB) {
  const today = new Date().toISOString().slice(0, 10);
  const r = db
    .prepare(
      `SELECT COUNT(*) AS calls, SUM(c.result = 'answered') AS answered, SUM(COALESCE(d.counts_as_contact,0)) AS contacts,
        SUM(COALESCE(d.is_sale,0)) AS sales, SUM(c.talk_sec) AS talk
       FROM calls c LEFT JOIN dispositions d ON d.id = c.disposition_id WHERE c.started_at >= ?`,
    )
    .get(today) as Record<string, number | null>;
  return {
    calls: r.calls ?? 0,
    answered: r.answered ?? 0,
    contacts: r.contacts ?? 0,
    sales: r.sales ?? 0,
    talkSec: r.talk ?? 0,
  };
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return (columns ?? []).join(',') + '\n';
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}
