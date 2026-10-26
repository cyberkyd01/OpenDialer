import { Router } from 'express';
import { changePasswordSchema, loginSchema, setupSchema, type PublicSettings, type SipCredentials } from '@opendialer/shared';
import { checkLoginAllowed, clearLoginFailures, recordLoginFailure, requireRole, signToken, verifyPassword } from '../auth.js';
import type { Ctx } from '../context.js';
import { badRequest, conflict, parse, unauthorized, wrap } from '../errors.js';
import { audit } from '../services/audit.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { countUsers, createUser, findByUsername, getUser, getUserRow, mapUser, setPassword } from '../services/users.js';

export function authRoutes(ctx: Ctx) {
  const r = Router();
  const { db } = ctx;

  r.get('/settings/public', (_req, res) => {
    const s = getSettings(db);
    const body: PublicSettings = {
      companyName: s.companyName,
      needsSetup: countUsers(db) === 0,
      telephonyMode: s.telephony.mode,
      version: ctx.config.version,
    };
    res.json(body);
  });

  /** First-run: create the admin account. Only works while there are no users. */
  r.post(
    '/setup',
    wrap((req, res) => {
      if (countUsers(db) > 0) throw conflict('Setup already completed');
      const input = parse(setupSchema, req.body);
      const user = createUser(db, { ...input, role: 'admin', active: true });
      updateSettings(db, { companyName: input.companyName, defaultCountry: input.defaultCountry.toUpperCase(), defaultTimezone: input.defaultTimezone });
      audit(db, user.id, 'setup', 'user', user.id);
      res.status(201).json({ token: signToken(ctx, user), user });
    }),
  );

  r.post(
    '/auth/login',
    wrap((req, res) => {
      const input = parse(loginSchema, req.body);
      const key = `${req.ip}:${input.username.toLowerCase()}`;
      if (!checkLoginAllowed(key)) throw unauthorized('Too many failed logins – try again in 15 minutes');
      const row = findByUsername(db, input.username);
      if (!row || !row.active || !verifyPassword(input.password, row.password_hash)) {
        recordLoginFailure(key);
        throw unauthorized('Invalid username or password');
      }
      clearLoginFailures(key);
      const user = mapUser(row);
      audit(db, user.id, 'login', 'user', user.id, { ip: req.ip });
      res.json({ token: signToken(ctx, user), user });
    }),
  );

  r.get('/auth/me', requireRole('agent'), (req, res) => {
    if (req.user!.apiKey) return res.json({ user: req.user, settings: null });
    res.json({ user: getUser(db, req.user!.id), settings: getSettings(db) });
  });

  r.post(
    '/auth/change-password',
    requireRole('agent'),
    wrap((req, res) => {
      if (req.user!.apiKey) throw badRequest('Not available for API keys');
      const input = parse(changePasswordSchema, req.body);
      const row = getUserRow(db, req.user!.id)!;
      if (!verifyPassword(input.currentPassword, row.password_hash)) throw unauthorized('Current password is wrong');
      setPassword(db, row.id, input.newPassword);
      audit(db, row.id, 'password.change', 'user', row.id);
      res.json({ ok: true });
    }),
  );

  /** Softphone credentials for the logged-in agent. */
  r.get('/auth/sip', requireRole('agent'), wrap((req, res) => {
    if (req.user!.apiKey) throw badRequest('Not available for API keys');
    const s = getSettings(db);
    const row = getUserRow(db, req.user!.id)!;
    const body: SipCredentials = {
      mode: s.telephony.mode,
      wssUrl: s.telephony.wssUrl,
      sipDomain: s.telephony.sipDomain,
      username: row.sip_username ?? '',
      authUsername: row.sip_auth_username ?? row.sip_username ?? '',
      password: row.sip_password ?? '',
      displayName: row.display_name,
      iceServers: s.telephony.iceServers,
      register: s.telephony.register,
      ringTimeoutSec: s.telephony.ringTimeoutSec,
    };
    res.json(body);
  }));

  return r;
}
