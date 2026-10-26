#!/usr/bin/env node
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createRealtime } from './realtime.js';
import { lanAddresses, loadOrCreateSelfSigned, loadTlsFromDir } from './tls.js';

async function main() {
  const config = loadConfig();
  const log = createLogger(config.logLevel);
  const app = createApp(config, log);
  const servers: (http.Server | https.Server)[] = [];

  if (config.httpPort > 0) {
    servers.push(http.createServer(app.express));
  }
  if (config.httpsPort > 0 && config.tls !== 'off') {
    try {
      const material =
        config.tls === 'auto' ? await loadOrCreateSelfSigned(path.join(config.dataDir, 'tls')) : loadTlsFromDir(config.tls);
      servers.push(https.createServer({ cert: material.cert, key: material.key }, app.express));
    } catch (err) {
      log.error({ err }, 'TLS setup failed – HTTPS disabled');
    }
  }
  if (!servers.length) {
    log.error('No listener configured (PORT and HTTPS_PORT are both 0)');
    process.exit(1);
  }

  const rt = createRealtime(app.ctx, app.engine, servers);
  app.engine.start();

  const listen = (server: http.Server | https.Server, port: number) =>
    new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, config.host, () => resolve());
    });

  const urls: string[] = [];
  for (const server of servers) {
    const isTls = server instanceof https.Server;
    const port = isTls ? config.httpsPort : config.httpPort;
    try {
      await listen(server, port);
    } catch (err) {
      log.error({ err, port }, `Could not listen on port ${port}`);
      process.exit(1);
    }
    const scheme = isTls ? 'https' : 'http';
    urls.push(`${scheme}://localhost:${port}`);
    for (const ip of lanAddresses()) urls.push(`${scheme}://${ip}:${port}`);
  }

  const banner = [
    '',
    `  OpenDialer v${config.version} is running`,
    '',
    '  Open the console at:',
    ...urls.map((u) => `    ${u}`),
    '',
    '  Agents on the same network use the https:// LAN address (microphone access needs HTTPS;',
    '  accept the self-signed certificate once). For remote agents put the server behind a',
    '  reverse proxy / tunnel – see docs/REMOTE-ACCESS.md.',
    `  Data directory: ${config.dataDir}`,
    '',
  ].join('\n');
  console.log(banner);

  const shutdown = (signal: string) => {
    log.info({ signal }, 'shutting down');
    rt.io.close();
    for (const s of servers) s.close();
    app.close();
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => log.error({ err }, 'uncaught exception'));
  process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
