import type { Script } from '@opendialer/shared';
import type { DB } from '../db.js';
import { buildSet, now } from '../db.js';
import { notFound } from '../errors.js';

interface Row {
  id: number;
  name: string;
  body: string;
  created_at: string;
  updated_at: string;
}

const map = (r: Row): Script => ({ id: r.id, name: r.name, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at });

export function listScripts(db: DB): Script[] {
  return (db.prepare('SELECT * FROM scripts ORDER BY name').all() as Row[]).map(map);
}

export function getScript(db: DB, id: number): Script {
  const r = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('Script');
  return map(r);
}

export function findScript(db: DB, id: number | null): Script | null {
  if (!id) return null;
  const r = db.prepare('SELECT * FROM scripts WHERE id = ?').get(id) as Row | undefined;
  return r ? map(r) : null;
}

export function createScript(db: DB, input: { name: string; body: string }): Script {
  const r = db.prepare('INSERT INTO scripts (name, body) VALUES (?, ?)').run(input.name, input.body);
  return getScript(db, Number(r.lastInsertRowid));
}

export function updateScript(db: DB, id: number, patch: { name?: string; body?: string }): Script {
  getScript(db, id);
  const { clause, params } = buildSet({ ...patch, updatedAt: now() }, ['name', 'body', 'updatedAt']);
  db.prepare(`UPDATE scripts SET ${clause} WHERE id = @id`).run({ ...params, id });
  return getScript(db, id);
}

export function deleteScript(db: DB, id: number) {
  getScript(db, id);
  db.prepare('DELETE FROM scripts WHERE id = ?').run(id);
}
