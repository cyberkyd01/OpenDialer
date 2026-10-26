import type { AuditEntry } from '@opendialer/shared';
import type { DB } from '../db.js';
import { paginate } from '../db.js';

export function audit(db: DB, userId: number | null, action: string, entity: string, entityId: string | number | null, details: unknown = '') {
  db.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)').run(
    userId,
    action,
    entity,
    entityId == null ? null : String(entityId),
    typeof details === 'string' ? details : JSON.stringify(details),
  );
}

export function listAudit(db: DB, page: number, pageSize: number, filter: { entity?: string; userId?: number } = {}) {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.entity) {
    where.push('a.entity = @entity');
    params.entity = filter.entity;
  }
  if (filter.userId) {
    where.push('a.user_id = @userId');
    params.userId = filter.userId;
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return paginate<AuditEntry>(
    db,
    `SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w} ORDER BY a.id DESC`,
    `SELECT COUNT(*) AS n FROM audit_log a ${w}`,
    params,
    page,
    pageSize,
    (r) => ({
      id: r.id as number,
      userId: (r.user_id as number | null) ?? null,
      username: (r.username as string | null) ?? null,
      action: r.action as string,
      entity: r.entity as string,
      entityId: (r.entity_id as string | null) ?? null,
      details: r.details as string,
      at: r.at as string,
    }),
  );
}
