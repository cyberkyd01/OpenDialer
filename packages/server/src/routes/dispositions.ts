import { Router } from 'express';
import { dispositionCreateSchema, dispositionUpdateSchema, scriptCreateSchema, scriptUpdateSchema, renderScript } from '@opendialer/shared';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam, parse, wrap } from '../errors.js';
import { audit } from '../services/audit.js';
import { createDisposition, deleteDisposition, listDispositions, updateDisposition } from '../services/dispositions.js';
import { findLead } from '../services/leads.js';
import { createScript, deleteScript, getScript, listScripts, updateScript } from '../services/scripts.js';
import { getSettings } from '../services/settings.js';

export function dispositionRoutes(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;

  r.get('/dispositions', requireRole('agent'), (_req, res) => res.json(listDispositions(db)));
  r.post(
    '/dispositions',
    requireRole('admin'),
    wrap((req, res) => {
      const d = createDisposition(db, parse(dispositionCreateSchema, req.body));
      audit(db, req.user!.id, 'disposition.create', 'disposition', d.id, { code: d.code });
      res.status(201).json(d);
    }),
  );
  r.patch(
    '/dispositions/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      const d = updateDisposition(db, id, parse(dispositionUpdateSchema, req.body));
      audit(db, req.user!.id, 'disposition.update', 'disposition', id);
      res.json(d);
    }),
  );
  r.delete(
    '/dispositions/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      deleteDisposition(db, id);
      audit(db, req.user!.id, 'disposition.delete', 'disposition', id);
      res.json({ ok: true });
    }),
  );

  /* ---------- scripts ---------- */

  r.get('/scripts', requireRole('agent'), (_req, res) => res.json(listScripts(db)));
  r.get('/scripts/:id', requireRole('agent'), wrap((req, res) => res.json(getScript(db, idParam(req)))));
  r.get(
    '/scripts/:id/preview',
    requireRole('agent'),
    wrap((req, res) => {
      const s = getScript(db, idParam(req));
      const lead = req.query.leadId ? findLead(db, Number(req.query.leadId)) : { firstName: 'Jane', lastName: 'Doe', company: 'Acme Inc', phone: '+15551234567', custom: {} };
      res.json({ rendered: renderScript(s.body, { lead, agentName: req.user!.displayName, companyName: getSettings(db).companyName }) });
    }),
  );
  r.post(
    '/scripts',
    requireRole('supervisor'),
    wrap((req, res) => {
      const s = createScript(db, parse(scriptCreateSchema, req.body));
      audit(db, req.user!.id, 'script.create', 'script', s.id);
      res.status(201).json(s);
    }),
  );
  r.patch(
    '/scripts/:id',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      const s = updateScript(db, id, parse(scriptUpdateSchema, req.body));
      audit(db, req.user!.id, 'script.update', 'script', id);
      res.json(s);
    }),
  );
  r.delete(
    '/scripts/:id',
    requireRole('supervisor'),
    wrap((req, res) => {
      const id = idParam(req);
      deleteScript(db, id);
      audit(db, req.user!.id, 'script.delete', 'script', id);
      res.json({ ok: true });
    }),
  );

  return r;
}
