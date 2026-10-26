import 'reflect-metadata'; // required by @peculiar/x509's DI container before it loads
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

export interface TlsMaterial {
  cert: string;
  key: string;
}

/** All non-internal IPv4 addresses of this machine (for the cert SAN and the startup banner). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

/**
 * Load cert.pem/key.pem from `dir`, generating a self-signed pair (valid 10 years,
 * SAN = localhost + all LAN IPs + hostname) when absent. Browsers require a secure
 * context for microphone access, so agents on the LAN use https://<ip>:8443 and
 * accept the certificate once.
 */
export async function loadOrCreateSelfSigned(dir: string): Promise<TlsMaterial> {
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');
  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    return { cert: fs.readFileSync(certFile, 'utf8'), key: fs.readFileSync(keyFile, 'utf8') };
  }
  fs.mkdirSync(dir, { recursive: true });
  const alg = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', publicExponent: new Uint8Array([1, 0, 1]), modulusLength: 2048 };
  const keys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const sans: x509.JsonGeneralName[] = [
    { type: 'dns', value: 'localhost' },
    { type: 'dns', value: os.hostname() },
    { type: 'ip', value: '127.0.0.1' },
    ...lanAddresses().map((ip) => ({ type: 'ip' as const, value: ip })),
  ];
  const notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  const notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: Date.now().toString(16),
    name: `CN=OpenDialer ${os.hostname()}`,
    notBefore,
    notAfter,
    signingAlgorithm: alg,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(sans),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  const keyPem = x509.PemConverter.encode(pkcs8, 'PRIVATE KEY');
  const certPem = cert.toString('pem');
  fs.writeFileSync(certFile, certPem);
  fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
  return { cert: certPem, key: keyPem };
}

export function loadTlsFromDir(dir: string): TlsMaterial {
  return {
    cert: fs.readFileSync(path.join(dir, 'cert.pem'), 'utf8'),
    key: fs.readFileSync(path.join(dir, 'key.pem'), 'utf8'),
  };
}
