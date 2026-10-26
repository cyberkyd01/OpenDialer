import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { apiKeyCreateSchema, paginationSchema, webhookCreateSchema, webhookUpdateSchema, WEBHOOK_EVENTS } from '@opendialer/shared';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import type { Engine } from '../engine.js';
import { idParam, notFound, parse, wrap } from '../errors.js';
import { createApiKey, deleteApiKey, listApiKeys } from '../services/apikeys.js';
import { audit, listAudit } from '../services/audit.js';
import { createWebhook, deleteWebhook, deliver, getWebhook, listWebhooks, updateWebhook } from '../services/webhooks.js';

export function adminRoutes(ctx: Ctx, engine: Engine) {
  const r = Router();
  const { db } = ctx;

  /* ---------- webhooks ---------- */
  r.get('/webhooks', requireRole('admin'), (_req, res) => res.json({ items: listWebhooks(db), events: WEBHOOK_EVENTS }));
  r.post(
    '/webhooks',
    requireRole('admin'),
    wrap((req, res) => {
      const h = createWebhook(db, parse(webhookCreateSchema, req.body));
      audit(db, req.user!.id, 'webhook.create', 'webhook', h.id, { url: h.url });
      res.status(201).json(h);
    }),
  );
  r.patch(
    '/webhooks/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      const h = updateWebhook(db, id, parse(webhookUpdateSchema, req.body));
      audit(db, req.user!.id, 'webhook.update', 'webhook', id);
      res.json(h);
    }),
  );
  r.delete(
    '/webhooks/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      deleteWebhook(db, id);
      audit(db, req.user!.id, 'webhook.delete', 'webhook', id);
      res.json({ ok: true });
    }),
  );
  r.post(
    '/webhooks/:id/test',
    requireRole('admin'),
    wrap(async (req, res) => {
      const h = getWebhook(db, idParam(req));
      const ok = await deliver(h, 'test', { message: 'OpenDialer webhook test', by: req.user!.username }, ctx.log);
      res.json({ ok });
    }),
  );

  /* ---------- API keys ---------- */
  r.get('/api-keys', requireRole('admin'), (_req, res) => res.json(listApiKeys(db)));
  r.post(
    '/api-keys',
    requireRole('admin'),
    wrap((req, res) => {
      const { name } = parse(apiKeyCreateSchema, req.body);
      const { key, plaintext } = createApiKey(db, name);
      audit(db, req.user!.id, 'apikey.create', 'apikey', key.id, { name });
      res.status(201).json({ ...key, plaintext });
    }),
  );
  r.delete(
    '/api-keys/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      deleteApiKey(db, id);
      audit(db, req.user!.id, 'apikey.delete', 'apikey', id);
      res.json({ ok: true });
    }),
  );

  /* ---------- audit ---------- */
  r.get(
    '/audit',
    requireRole('supervisor'),
    wrap((req, res) => {
      const { page, pageSize } = parse(paginationSchema, req.query);
      const q = req.query as Record<string, string | undefined>;
      res.json(listAudit(db, page, pageSize, { entity: q.entity || undefined, userId: q.userId ? Number(q.userId) : undefined }));
    }),
  );

  /* ---------- agents (supervisor control) ---------- */
  r.get('/agents', requireRole('supervisor'), (_req, res) => res.json(engine.snapshot().agents));
  r.post(
    '/agents/:id/logout',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      if (!engine.getSession(id)) throw notFound('Agent session');
      engine.leave(id);
      audit(db, req.user!.id, 'agent.force_logout', 'user', id);
      res.json({ ok: true });
    }),
  );

  /* ---------- backup & health ---------- */
  r.post(
    '/admin/backup',
    requireRole('admin'),
    wrap(async (req, res) => {
      const dir = path.join(ctx.config.dataDir, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `opendialer-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      await db.backup(file);
      audit(db, req.user!.id, 'backup', 'db', null, { file: path.basename(file) });
      res.json({ ok: true, file: path.basename(file), bytes: fs.statSync(file).size });
    }),
  );
  r.get('/admin/backups', requireRole('admin'), (_req, res) => {
    const dir = path.join(ctx.config.dataDir, 'backups');
    const files = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.sqlite'))
          .map((f) => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtime.toISOString() }))
          .sort((a, b) => (a.at < b.at ? 1 : -1))
      : [];
    res.json(files);
  });
  r.get(
    '/admin/backups/:file',
    requireRole('admin'),
    wrap((req, res) => {
      const name = path.basename(String(req.params.file));
      const file = path.join(ctx.config.dataDir, 'backups', name);
      if (!name.endsWith('.sqlite') || !fs.existsSync(file)) throw notFound('Backup');
      res.download(file, name);
    }),
  );

  r.get('/admin/system', requireRole('admin'), (_req, res) => {
    const dbFile = path.join(ctx.config.dataDir, 'opendialer.sqlite');
    res.json({
      version: ctx.config.version,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      dataDir: ctx.config.dataDir,
      dbBytes: fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
      agentsOnline: engine.sessions.size,
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    });
  });

  return r;
}
