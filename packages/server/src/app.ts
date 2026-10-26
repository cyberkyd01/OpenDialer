import path from 'node:path';
import fs from 'node:fs';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import { authenticate } from './auth.js';
import type { Config } from './config.js';
import { Bus, type Ctx } from './context.js';
import { openDatabase } from './db.js';
import { Engine } from './engine.js';
import { errorHandler } from './errors.js';
import type { Logger } from './logger.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { callRoutes } from './routes/calls.js';
import { campaignRoutes } from './routes/campaigns.js';
import { dispositionRoutes } from './routes/dispositions.js';
import { dncRoutes } from './routes/dnc.js';
import { leadRoutes } from './routes/leads.js';
import { reportRoutes } from './routes/reports.js';
import { settingsRoutes } from './routes/settings.js';
import { userRoutes } from './routes/users.js';
import { closeDanglingCalls } from './services/calls.js';
import { startWebhookDispatcher } from './services/webhooks.js';

export interface App {
  ctx: Ctx;
  engine: Engine;
  express: express.Express;
  close: () => void;
}

/**
 * Build the Express app + engine without listening. Tests call this with an
 * in-memory database; `index.ts` wires it to HTTP/HTTPS + Socket.IO.
 */
export function createApp(config: Config, log: Logger, dbFile = path.join(config.dataDir, 'opendialer.sqlite')): App {
  const db = openDatabase(dbFile);
  const bus = new Bus();
  const ctx: Ctx = { db, config, log, bus };
  const engine = new Engine(ctx);
  const stopWebhooks = startWebhookDispatcher(ctx);
  closeDanglingCalls(db);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(compression());
  app.use(
    cors({
      origin: config.corsOrigins.length ? config.corsOrigins : true,
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '20mb' }));
  app.use(express.urlencoded({ extended: false, limit: '20mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(authenticate(ctx));

  app.get('/api/health', (_req, res) => res.json({ ok: true, version: config.version, agentsOnline: engine.sessions.size, time: new Date().toISOString() }));

  const api = express.Router();
  api.use(authRoutes(ctx));
  api.use(userRoutes(ctx));
  api.use(settingsRoutes(ctx));
  api.use(campaignRoutes(ctx, engine));
  api.use(leadRoutes(ctx));
  api.use(dncRoutes(ctx));
  api.use(dispositionRoutes(ctx));
  api.use(callRoutes(ctx));
  api.use(reportRoutes(ctx, engine));
  api.use(adminRoutes(ctx, engine));
  api.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use('/api', api);

  // Built web client (SPA). Any non-API route falls back to index.html.
  if (config.webDir && fs.existsSync(path.join(config.webDir, 'index.html'))) {
    const webDir = config.webDir;
    app.use(
      express.static(webDir, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (res, file) => {
          if (file.endsWith('index.html') || file.endsWith('sw.js') || file.endsWith('manifest.webmanifest')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(webDir, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res
        .type('html')
        .send(
          `<!doctype html><title>OpenDialer</title><body style="font-family:system-ui;padding:2rem"><h1>OpenDialer server is running</h1>
           <p>The web client is not built. Run <code>npm run build</code> in the repository root, then restart the server.</p>
           <p>API health: <a href="/api/health">/api/health</a></p></body>`,
        ),
    );
  }

  app.use(errorHandler(log));

  return {
    ctx,
    engine,
    express: app,
    close: () => {
      engine.stop();
      stopWebhooks();
      db.close();
    },
  };
}
