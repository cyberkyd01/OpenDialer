import type { Disposition, DispositionCreateInput } from '@opendialer/shared';
import type { DB } from '../db.js';
import { buildSet, fromBool } from '../db.js';
import { conflict, notFound } from '../errors.js';

interface Row {
  id: number;
  code: string;
  label: string;
  category: Disposition['category'];
  retry_minutes: number | null;
  counts_as_contact: number;
  is_sale: number;
  color: string;
  sort_order: number;
  system: number;
}

const map = (r: Row): Disposition => ({
  id: r.id,
  code: r.code,
  label: r.label,
  category: r.category,
  retryMinutes: r.retry_minutes,
  countsAsContact: fromBool(r.counts_as_contact),
  isSale: fromBool(r.is_sale),
  color: r.color,
  sortOrder: r.sort_order,
  system: fromBool(r.system),
});

export function listDispositions(db: DB): Disposition[] {
  return (db.prepare('SELECT * FROM dispositions ORDER BY sort_order, id').all() as Row[]).map(map);
}

export function getDisposition(db: DB, id: number): Disposition {
  const r = db.prepare('SELECT * FROM dispositions WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw notFound('Disposition');
  return map(r);
}

export function createDisposition(db: DB, input: DispositionCreateInput): Disposition {
  if (db.prepare('SELECT 1 FROM dispositions WHERE code = ?').get(input.code)) throw conflict('Code already exists');
  const r = db
    .prepare(
      `INSERT INTO dispositions (code,label,category,retry_minutes,counts_as_contact,is_sale,color,sort_order,system)
       VALUES (@code,@label,@category,@retryMinutes,@countsAsContact,@isSale,@color,@sortOrder,0)`,
    )
    .run({ ...input, countsAsContact: input.countsAsContact ? 1 : 0, isSale: input.isSale ? 1 : 0 });
  return getDisposition(db, Number(r.lastInsertRowid));
}

export function updateDisposition(db: DB, id: number, patch: Partial<DispositionCreateInput>): Disposition {
  getDisposition(db, id);
  if (patch.code && db.prepare('SELECT 1 FROM dispositions WHERE code = ? AND id <> ?').get(patch.code, id)) throw conflict('Code already exists');
  const fields: Record<string, unknown> = { ...patch };
  if (typeof patch.countsAsContact === 'boolean') fields.countsAsContact = patch.countsAsContact ? 1 : 0;
  if (typeof patch.isSale === 'boolean') fields.isSale = patch.isSale ? 1 : 0;
  const { clause, params } = buildSet(fields, ['code', 'label', 'category', 'retryMinutes', 'countsAsContact', 'isSale', 'color', 'sortOrder']);
  if (clause) db.prepare(`UPDATE dispositions SET ${clause} WHERE id = @id`).run({ ...params, id });
  return getDisposition(db, id);
}

export function deleteDisposition(db: DB, id: number) {
  const d = getDisposition(db, id);
  if (d.system) throw conflict('System dispositions cannot be deleted');
  db.prepare('DELETE FROM dispositions WHERE id = ?').run(id);
}
