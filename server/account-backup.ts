import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, lstat, mkdtemp, open, realpath, rmdir, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function checkAccountDatabase(db: DatabaseSync) {
  const integrity = db.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok') throw new Error('Database integrity check failed.');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database relationship check failed.');
  const metadata = db.prepare('SELECT key_check FROM metadata WHERE id=1').get();
  const keyCheck = metadata?.key_check;
  // AccountStore stores its HMAC check as the 64 ASCII hexadecimal bytes.
  if (!keyCheck || typeof keyCheck !== 'object' || !ArrayBuffer.isView(keyCheck)
    || !/^[a-f0-9]{64}$/.test(Buffer.from(keyCheck).toString('utf8'))) throw new Error('Not an initialized packing account database.');
  for (const table of ['users', 'sessions', 'vaults', 'audit', 'households', 'household_members', 'household_invitations', 'shared_packs']) {
    db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
  }
}

/** Consistent SQLite snapshot, including committed WAL records. No key is read. */
export async function backupAccounts(source: string, destination: string, maximumDurationMs = 60000) {
  if (!Number.isFinite(maximumDurationMs) || maximumDurationMs < 0) throw new Error('Invalid backup time limit.');
  const input = await realpath(source);
  const parent = await realpath(dirname(resolve(destination)));
  const output = join(parent, basename(destination));
  try { await lstat(output); throw new Error('Backup destination already exists.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(input, { readOnly: true, timeout: 5000 });
  let temporary: string | undefined;
  try {
    // Reject wrong/empty databases before creating an output directory.
    checkAccountDatabase(db);
    temporary = await mkdtemp(join(parent, '.packing-backup-'));
    const file = join(temporary, 'snapshot.sqlite');
    const initial = await open(file, 'wx', 0o600);
    await initial.close();
    const started = Date.now();
    const checkDeadline = () => {
      if (Date.now() - started >= maximumDurationMs) throw new Error('Backup exceeded its time limit; no snapshot published.');
    };
    const pages = await backup(db, file, { progress: checkDeadline });
    // SQLite need not invoke progress for a single-batch snapshot.
    checkDeadline();
    const snapshot = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
    try { checkAccountDatabase(snapshot); } finally { snapshot.close(); }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    const handle = await open(file, 'r+');
    try { await handle.sync(); } finally { await handle.close(); }
    // Atomic, same-filesystem publication. Unlike rename, link cannot replace
    // an existing file or symlink if another backup wins the race.
    await link(file, output);
    return { pages, sha256: hash.digest('hex') };
  } finally {
    db.close();
    if (temporary) {
      for (const suffix of ['', '-wal', '-shm']) {
        await unlink(join(temporary, `snapshot.sqlite${suffix}`)).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        });
      }
      await rmdir(temporary);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node server/account-backup.ts SOURCE.sqlite NEW-BACKUP.sqlite');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await backupAccounts(process.argv[2], process.argv[3]))); }
    catch { console.error('Account backup failed. Check source integrity, destination availability and permissions. Existing backups were not replaced.'); process.exitCode = 1; }
  }
}
