import { Router } from 'express';
import { userCreateSchema, userUpdateSchema } from '@opendialer/shared';
import { requireRole } from '../auth.js';
import type { Ctx } from '../context.js';
import { conflict, idParam, parse, wrap } from '../errors.js';
import { audit } from '../services/audit.js';
import { createUser, deleteUser, getUser, listUsers, updateUser } from '../services/users.js';

export function userRoutes(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;

  // supervisors need the list to assign agents to campaigns / read reports
  r.get('/users', requireRole('supervisor'), (_req, res) => res.json(listUsers(db)));

  r.get(
    '/users/:id',
    requireRole('supervisor'),
    wrap((req, res) => res.json(getUser(db, idParam(req), req.user!.role === 'admin'))),
  );

  r.post(
    '/users',
    requireRole('admin'),
    wrap((req, res) => {
      const user = createUser(db, parse(userCreateSchema, req.body));
      audit(db, req.user!.id, 'user.create', 'user', user.id, { username: user.username, role: user.role });
      res.status(201).json(user);
    }),
  );

  r.patch(
    '/users/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      const patch = parse(userUpdateSchema, req.body);
      if (id === req.user!.id && (patch.role && patch.role !== 'admin' || patch.active === false)) {
        throw conflict('You cannot demote or deactivate yourself');
      }
      const user = updateUser(db, id, patch);
      audit(db, req.user!.id, 'user.update', 'user', id, Object.keys(patch));
      res.json(user);
    }),
  );

  r.delete(
    '/users/:id',
    requireRole('admin'),
    wrap((req, res) => {
      const id = idParam(req);
      if (id === req.user!.id) throw conflict('You cannot delete yourself');
      const result = deleteUser(db, id);
      audit(db, req.user!.id, 'user.delete', 'user', id, result);
      res.json(result);
    }),
  );

  return r;
}
