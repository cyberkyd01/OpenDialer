import { normalizePhone, type DncEntry } from '@opendialer/shared';
import type { DB } from '../db.js';
import { paginate } from '../db.js';
import { badRequest, notFound } from '../errors.js';

interface Row {
  id: number;
  phone: string;
  source: string;
  note: string;
  created_at: string;
}
const map = (r: Row): DncEntry => ({ id: r.id, phone: r.phone, source: r.source, note: r.note, createdAt: r.created_at });

/** True when the E.164 number is on the do-not-call list. */
export function isDnc(db: DB, e164: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM dnc WHERE phone = ?').get(e164));
}

export function addDnc(db: DB, rawPhone: string, source: string, note = '', defaultCountry = 'US'): DncEntry {
  const n = normalizePhone(rawPhone, defaultCountry);
  if (!n.e164) throw badRequest('Invalid phone number');
  db.prepare(
    `INSERT INTO dnc (phone, source, note) VALUES (?, ?, ?)
     ON CONFLICT(phone) DO UPDATE SET note = CASE WHEN excluded.note <> '' THEN excluded.note ELSE dnc.note END`,
  ).run(n.e164, source, note);
  // any lead with this number is taken out of rotation everywhere
  db.prepare(`UPDATE leads SET status = 'dnc', locked_by = NULL, locked_at = NULL WHERE phone = ? AND status <> 'dnc'`).run(n.e164);
  db.prepare(`UPDATE callbacks SET status = 'cancelled' WHERE status = 'pending' AND lead_id IN (SELECT id FROM leads WHERE phone = ?)`).run(n.e164);
  return map(db.prepare('SELECT * FROM dnc WHERE phone = ?').get(n.e164) as Row);
}

export function removeDnc(db: DB, id: number) {
  const r = db.prepare('SELECT * FROM dnc WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('DNC entry');
  db.prepare('DELETE FROM dnc WHERE id = ?').run(id);
  return map(r);
}

export function listDnc(db: DB, q: string, page: number, pageSize: number) {
  const where = q ? 'WHERE phone LIKE @q OR note LIKE @q' : '';
  return paginate<DncEntry>(
    db,
    `SELECT * FROM dnc ${where} ORDER BY id DESC`,
    `SELECT COUNT(*) AS n FROM dnc ${where}`,
    { q: `%${q}%` },
    page,
    pageSize,
    (r) => map(r as unknown as Row),
  );
}

/** Bulk import of raw numbers (one per line / CSV cell). Returns counts. */
export function importDnc(db: DB, rawNumbers: string[], source: string, defaultCountry: string) {
  let added = 0;
  let invalid = 0;
  const tx = db.transaction(() => {
    for (const raw of rawNumbers) {
      const n = normalizePhone(raw, defaultCountry);
      if (!n.e164) {
        invalid++;
        continue;
      }
      const r = db.prepare('INSERT OR IGNORE INTO dnc (phone, source) VALUES (?, ?)').run(n.e164, source);
      if (r.changes) added++;
      db.prepare(`UPDATE leads SET status = 'dnc', locked_by = NULL, locked_at = NULL WHERE phone = ? AND status <> 'dnc'`).run(n.e164);
    }
  });
  tx();
  return { added, invalid, total: rawNumbers.length };
}
