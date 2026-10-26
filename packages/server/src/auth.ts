import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '@opendialer/shared';
import type { Ctx } from './context.js';
import { forbidden, unauthorized } from './errors.js';
import { mapUser, type UserRow } from './services/users.js';

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  /** true when authenticated with an API key instead of a login token */
  apiKey?: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const hashPassword = (pw: string) => bcrypt.hashSync(pw, 10);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compareSync(pw, hash);

export function signToken(ctx: Ctx, user: Pick<User, 'id' | 'username' | 'role'>): string {
  return jwt.sign({ sub: String(user.id), username: user.username, role: user.role }, ctx.config.jwtSecret, {
    expiresIn: ctx.config.tokenTtl as jwt.SignOptions['expiresIn'],
  });
}

/** Resolve a JWT to a live, active user (or null). */
export function userFromToken(ctx: Ctx, token: string | undefined | null): AuthUser | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, ctx.config.jwtSecret) as { sub: string };
    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(Number(payload.sub)) as UserRow | undefined;
    if (!row) return null;
    const u = mapUser(row);
    return { id: u.id, username: u.username, displayName: u.displayName, role: u.role };
  } catch {
    return null;
  }
}

export const hashApiKey = (key: string) => crypto.createHash('sha256').update(key).digest('hex');

export function userFromApiKey(ctx: Ctx, key: string | undefined): AuthUser | null {
  if (!key) return null;
  const row = ctx.db.prepare('SELECT id, name FROM api_keys WHERE key_hash = ?').get(hashApiKey(key)) as
    | { id: number; name: string }
    | undefined;
  if (!row) return null;
  ctx.db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
  // API keys act as an admin "service user" – they have no agent identity.
  return { id: 0, username: `apikey:${row.name}`, displayName: row.name, role: 'admin', apiKey: true };
}

/** Attach req.user when a valid Bearer token or X-API-Key is present. Never rejects. */
export function authenticate(ctx: Ctx) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const apiKey = (req.headers['x-api-key'] as string | undefined) ?? undefined;
    req.user = userFromToken(ctx, bearer) ?? userFromApiKey(ctx, apiKey) ?? undefined;
    next();
  };
}

const RANK: Record<Role, number> = { agent: 1, supervisor: 2, admin: 3 };

/** Require a logged-in user with at least `role`. */
export function requireRole(role: Role = 'agent') {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (RANK[req.user.role] < RANK[role]) return next(forbidden('Insufficient role'));
    next();
  };
}

/* ---------- login rate limiting (per IP + username) ---------- */
const attempts = new Map<string, { count: number; until: number }>();
export function checkLoginAllowed(key: string): boolean {
  const a = attempts.get(key);
  if (!a) return true;
  if (Date.now() > a.until) {
    attempts.delete(key);
    return true;
  }
  return a.count < 10;
}
export function recordLoginFailure(key: string) {
  const a = attempts.get(key) ?? { count: 0, until: Date.now() + 15 * 60 * 1000 };
  a.count += 1;
  if (a.count >= 10) a.until = Date.now() + 15 * 60 * 1000;
  attempts.set(key, a);
}
export function clearLoginFailures(key: string) {
  attempts.delete(key);
}
