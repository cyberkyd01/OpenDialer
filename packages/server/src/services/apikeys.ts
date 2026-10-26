import crypto from 'node:crypto';
import type { ApiKey } from '@opendialer/shared';
import type { DB } from '../db.js';
import { hashApiKey } from '../auth.js';
import { notFound } from '../errors.js';

interface Row {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
}
const map = (r: Row): ApiKey => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.created_at, lastUsedAt: r.last_used_at });

export function listApiKeys(db: DB): ApiKey[] {
  return (db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_keys ORDER BY id').all() as Row[]).map(map);
}

/** Creates a key; the plaintext is returned exactly once. */
export function createApiKey(db: DB, name: string): { key: ApiKey; plaintext: string } {
  const plaintext = 'odk_' + crypto.randomBytes(24).toString('base64url');
  const r = db.prepare('INSERT INTO api_keys (name, prefix, key_hash) VALUES (?, ?, ?)').run(name, plaintext.slice(0, 10), hashApiKey(plaintext));
  const row = db.prepare('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE id = ?').get(Number(r.lastInsertRowid)) as Row;
  return { key: map(row), plaintext };
}

export function deleteApiKey(db: DB, id: number) {
  const r = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  if (!r.changes) throw notFound('API key');
}
