import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_DISPOSITIONS } from '@opendialer/shared';

export type DB = Database.Database;

const MIGRATIONS: { id: number; sql: string }[] = [
  {
    id: 1,
    sql: `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','supervisor','agent')),
  active INTEGER NOT NULL DEFAULT 1,
  sip_username TEXT,
  sip_auth_username TEXT,
  sip_password TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE scripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','completed')),
  dial_mode TEXT NOT NULL DEFAULT 'preview' CHECK (dial_mode IN ('manual','preview','progressive')),
  caller_id TEXT NOT NULL DEFAULT '',
  script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
  calling_hours_start TEXT NOT NULL DEFAULT '09:00',
  calling_hours_end TEXT NOT NULL DEFAULT '20:00',
  calling_days TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  timezone_mode TEXT NOT NULL DEFAULT 'lead' CHECK (timezone_mode IN ('lead','fixed')),
  fixed_timezone TEXT NOT NULL DEFAULT 'UTC',
  max_attempts INTEGER NOT NULL DEFAULT 3,
  retry_minutes INTEGER NOT NULL DEFAULT 240,
  preview_timeout_sec INTEGER NOT NULL DEFAULT 0,
  wrapup_timeout_sec INTEGER NOT NULL DEFAULT 0,
  recording TEXT NOT NULL DEFAULT 'agent' CHECK (recording IN ('off','always','agent')),
  dial_prefix TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE campaign_agents (
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, user_id)
);

CREATE TABLE lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  raw_phone TEXT NOT NULL DEFAULT '',
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  timezone TEXT,
  custom TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','callback','done','dnc','invalid')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  last_disposition_id INTEGER,
  locked_by INTEGER,
  locked_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_leads_campaign_status ON leads(campaign_id, status, next_attempt_at);
CREATE INDEX idx_leads_list ON leads(list_id);
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_locked ON leads(locked_by);

CREATE TABLE dispositions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('contact','no_contact','callback','dnc','invalid')),
  retry_minutes INTEGER,
  counts_as_contact INTEGER NOT NULL DEFAULT 0,
  is_sale INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#64748b',
  sort_order INTEGER NOT NULL DEFAULT 100,
  system INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE dnc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'manual',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'out',
  started_at TEXT NOT NULL,
  answered_at TEXT,
  ended_at TEXT,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  talk_sec INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'unknown',
  disposition_id INTEGER REFERENCES dispositions(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  recording_path TEXT,
  provider_call_id TEXT,
  hangup_cause TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_calls_campaign ON calls(campaign_id, started_at);
CREATE INDEX idx_calls_user ON calls(user_id, started_at);
CREATE INDEX idx_calls_lead ON calls(lead_id);
CREATE INDEX idx_calls_phone ON calls(phone, started_at);

CREATE TABLE callbacks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  scheduled_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_callbacks_due ON callbacks(status, scheduled_at);

CREATE TABLE agent_state_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  state TEXT NOT NULL,
  pause_code TEXT,
  campaign_id INTEGER,
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_agent_state_log ON agent_state_log(user_id, at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT
);

CREATE TABLE webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  events TEXT NOT NULL DEFAULT '[]',
  secret TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`,
  },
];

export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  seed(db);
  return db;
}

function migrate(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => (r as { id: number }).id));
  const apply = db.transaction((m: { id: number; sql: string }) => {
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(m.id, new Date().toISOString());
  });
  for (const m of MIGRATIONS) if (!applied.has(m.id)) apply(m);
}

function seed(db: DB) {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM dispositions').get() as { n: number }).n;
  if (count === 0) {
    const ins = db.prepare(
      `INSERT INTO dispositions (code,label,category,retry_minutes,counts_as_contact,is_sale,color,sort_order,system)
       VALUES (@code,@label,@category,@retryMinutes,@countsAsContact,@isSale,@color,@sortOrder,1)`,
    );
    const tx = db.transaction(() => {
      for (const d of DEFAULT_DISPOSITIONS) {
        ins.run({ ...d, countsAsContact: d.countsAsContact ? 1 : 0, isSale: d.isSale ? 1 : 0 });
      }
    });
    tx();
  }
}

/* ---------- small helpers ---------- */

export const now = () => new Date().toISOString();
export const bool = (v: unknown) => (v ? 1 : 0);
export const fromBool = (v: unknown) => Boolean(v);
export const json = (v: unknown) => JSON.stringify(v ?? null);
export function fromJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Build "SET a = @a, b = @b" for the keys present in `patch` (camelCase -> snake_case). */
export function buildSet(patch: Record<string, unknown>, allowed: string[]): { clause: string; params: Record<string, unknown> } {
  const parts: string[] = [];
  const params: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in patch) || patch[key] === undefined) continue;
    const col = key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    parts.push(`${col} = @${key}`);
    params[key] = patch[key];
  }
  return { clause: parts.join(', '), params };
}

export function paginate<T>(
  db: DB,
  baseSql: string,
  countSql: string,
  params: Record<string, unknown>,
  page: number,
  pageSize: number,
  map: (row: Record<string, unknown>) => T,
) {
  const total = (db.prepare(countSql).get(params) as { n: number }).n;
  const rows = db
    .prepare(`${baseSql} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as Record<string, unknown>[];
  return { items: rows.map(map), total, page, pageSize };
}
