import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface Config {
  /** HTTP port (0 disables). Default 8080. */
  httpPort: number;
  /** HTTPS port (0 disables). Default 8443. */
  httpsPort: number;
  /** 'auto' = generate a self-signed cert in DATA_DIR/tls, 'off' = HTTP only, or a dir with cert.pem/key.pem */
  tls: string;
  host: string;
  dataDir: string;
  jwtSecret: string;
  /** Lifetime of login tokens */
  tokenTtl: string;
  logLevel: string;
  /** Directory with the built web client (index.html). */
  webDir: string | null;
  /** Comma separated extra origins allowed for CORS (same-origin always allowed). */
  corsOrigins: string[];
  /** Public URL used in printed hints / webhooks (optional). */
  publicUrl: string | null;
  trustProxy: boolean;
  /** Disable the dialer tick loop (tests). */
  engineInterval: number;
  version: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function findWebDir(): string | null {
  const candidates = [
    process.env.WEB_DIR,
    path.join(here, '..', 'public'),
    path.join(here, '..', '..', 'web', 'dist'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}

function loadOrCreateSecret(dataDir: string): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, 'secret.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch {
    /* create below */
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const cfg: Config = {
    httpPort: Number(process.env.PORT ?? 8080),
    httpsPort: Number(process.env.HTTPS_PORT ?? 8443),
    tls: process.env.TLS ?? 'auto',
    host: process.env.HOST ?? '0.0.0.0',
    dataDir,
    jwtSecret: overrides.jwtSecret ?? loadOrCreateSecret(dataDir),
    tokenTtl: process.env.TOKEN_TTL ?? '12h',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    webDir: overrides.webDir !== undefined ? overrides.webDir : findWebDir(),
    corsOrigins: (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    publicUrl: process.env.PUBLIC_URL ?? null,
    trustProxy: (process.env.TRUST_PROXY ?? 'true') !== 'false',
    engineInterval: Number(process.env.ENGINE_INTERVAL_MS ?? 3000),
    version: readVersion(),
    ...overrides,
  };
  return cfg;
}
