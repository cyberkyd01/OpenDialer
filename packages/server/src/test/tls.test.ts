import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate } from 'node:crypto';
import https from 'node:https';
import { describe, expect, it } from 'vitest';
import { lanAddresses, loadOrCreateSelfSigned, loadTlsFromDir } from '../tls.js';

describe('self-signed TLS', () => {
  it('generates a usable certificate with LAN SANs and reuses it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opendialer-tls-'));
    const first = await loadOrCreateSelfSigned(dir);
    expect(first.cert).toContain('BEGIN CERTIFICATE');
    expect(first.key).toContain('BEGIN PRIVATE KEY');
    const cert = new X509Certificate(first.cert);
    expect(cert.subjectAltName).toContain('DNS:localhost');
    expect(cert.subjectAltName).toContain('IP Address:127.0.0.1');
    for (const ip of lanAddresses()) expect(cert.subjectAltName).toContain(`IP Address:${ip}`);
    expect(new Date(cert.validTo).getTime()).toBeGreaterThan(Date.now() + 9 * 365 * 24 * 3600 * 1000);
    expect(cert.checkPrivateKey(await import('node:crypto').then((c) => c.createPrivateKey(first.key)))).toBe(true);

    const second = await loadOrCreateSelfSigned(dir);
    expect(second.cert).toBe(first.cert);
    expect(loadTlsFromDir(dir).key).toBe(first.key);

    // node's https server accepts the pair
    const server = https.createServer({ cert: first.cert, key: first.key }, (_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const body = await new Promise<string>((resolve, reject) => {
      https.get({ host: '127.0.0.1', port, path: '/', rejectUnauthorized: false }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
    expect(body).toBe('ok');
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
