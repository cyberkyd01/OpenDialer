import { Router } from 'express';
import multer from 'multer';
import { dncCreateSchema, normalizePhone, paginationSchema } from '@opendialer/shared';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import { badRequest, idParam, parse, wrap } from '../errors.js';
import { audit } from '../services/audit.js';
import { addDnc, importDnc, isDnc, listDnc, removeDnc } from '../services/dnc.js';
import { getSettings } from '../services/settings.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function dncRoutes(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;

  r.get(
    '/dnc',
    requireRole('agent'),
    wrap((req, res) => {
      const { page, pageSize } = parse(paginationSchema, req.query);
      res.json(listDnc(db, String(req.query.q ?? '').trim(), page, pageSize));
    }),
  );

  r.get(
    '/dnc/check',
    requireRole('agent'),
    wrap((req, res) => {
      const n = normalizePhone(String(req.query.phone ?? ''), getSettings(db).defaultCountry);
      if (!n.e164) throw badRequest('Invalid phone number');
      res.json({ phone: n.e164, dnc: isDnc(db, n.e164) });
    }),
  );

  // agents may add numbers (a customer asking not to be called must be honoured immediately)
  r.post(
    '/dnc',
    requireRole('agent'),
    wrap((req, res) => {
      const input = parse(dncCreateSchema, req.body);
      const e = addDnc(db, input.phone, `user:${req.user!.username}`, input.note, getSettings(db).defaultCountry);
      audit(db, req.user!.id, 'dnc.add', 'dnc', e.id, { phone: e.phone });
      ctx.bus.emitDomain('lead.dnc', { leadId: null, phone: e.phone });
      res.status(201).json(e);
    }),
  );

  r.post(
    '/dnc/import',
    requireRole('supervisor'),
    upload.single('file'),
    wrap((req, res) => {
      const text: string = req.file ? req.file.buffer.toString('utf8') : typeof req.body?.csv === 'string' ? req.body.csv : '';
      if (!text.trim()) throw badRequest('No data');
      const numbers = text
        .split(/[\r\n,;]+/)
        .map((s) => s.trim().replace(/^"|"$/g, ''))
        .filter((s) => s && /\d{3,}/.test(s));
      const result = importDnc(db, numbers, `import:${req.user!.username}`, getSettings(db).defaultCountry);
      audit(db, req.user!.id, 'dnc.import', 'dnc', null, result);
      res.json(result);
    }),
  );

  r.delete(
    '/dnc/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const e = removeDnc(db, idParam(req));
      audit(db, req.user!.id, 'dnc.remove', 'dnc', e.id, { phone: e.phone });
      res.json({ ok: true });
    }),
  );

  return r;
}
