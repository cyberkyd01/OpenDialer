#!/usr/bin/env node
/**
 * Maintenance commands that run against the data directory without the server:
 *   node dist/cli.js backup                      -> data/backups/<timestamp>.sqlite
 *   node dist/cli.js reset-password <user> <pw>  -> set a user's password (e.g. locked-out admin)
 *   node dist/cli.js create-admin <user> <pw>    -> create an admin (first-run without the browser wizard)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createUser, findByUsername, setPassword } from './services/users.js';

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDatabase(path.join(config.dataDir, 'opendialer.sqlite'));
  try {
    switch (cmd) {
      case 'backup': {
        const dir = path.join(config.dataDir, 'backups');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `opendialer-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
        await db.backup(file);
        console.log(`Backup written: ${file}`);
        break;
      }
      case 'reset-password': {
        const [username, password] = args;
        if (!username || !password || password.length < 8) throw new Error('usage: reset-password <username> <password(min 8)>');
        const u = findByUsername(db, username);
        if (!u) throw new Error(`User ${username} not found`);
        setPassword(db, u.id, password);
        console.log(`Password updated for ${username}`);
        break;
      }
      case 'create-admin': {
        const [username, password, displayName] = args;
        if (!username || !password || password.length < 8) throw new Error('usage: create-admin <username> <password(min 8)> [displayName]');
        const u = createUser(db, { username, password, displayName: displayName ?? username, role: 'admin', active: true });
        console.log(`Admin ${u.username} created (id ${u.id})`);
        break;
      }
      default:
        console.log('Commands: backup | reset-password <user> <pw> | create-admin <user> <pw> [name]');
        process.exitCode = cmd ? 1 : 0;
    }
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
