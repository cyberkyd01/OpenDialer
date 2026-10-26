import { Router } from 'express';
import { settingsUpdateSchema } from '@opendialer/shared';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import { parse, wrap } from '../errors.js';
import { audit } from '../services/audit.js';
import { getSettings, updateSettings } from '../services/settings.js';

export function settingsRoutes(ctx: Ctx) {
  const r = Router();
  r.get('/settings', requireRole('supervisor'), (_req, res) => res.json(getSettings(ctx.db)));
  r.put(
    '/settings',
    requireRole('admin'),
    wrap((req, res) => {
      const patch = parse(settingsUpdateSchema, req.body);
      const s = updateSettings(ctx.db, patch);
      audit(ctx.db, req.user!.id, 'settings.update', 'settings', 'app', Object.keys(patch));
      ctx.bus.emitDomain('settings.changed', {});
      res.json(s);
    }),
  );
  return r;
}
