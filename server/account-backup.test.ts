import { describe, expect, it } from 'vitest';
import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { backupAccounts } from './account-backup.ts';
import { AccountStore } from './accounts.ts';
import { accountMetadataBackup } from '../src/backup.ts';
import { createInitialData } from '../src/seed.ts';
import { createTestTempDirectory } from '../src/test-temp.ts';

describe('operator account snapshots', () => {
  it('restores committed WAL data, credentials and encrypted vaults independently of the live store', async () => {
    const root = await createTestTempDirectory('packing-backup-');
    const source = join(root, 'live.sqlite'), destination = join(root, 'backup.sqlite'), restored = join(root, 'restored.sqlite');
    const key = Buffer.alloc(32, 11), credentials = { username: 'backup-rehearsal', name: 'Synthetic private name', password: 'synthetic snapshot restore passphrase' };
    const live = new AccountStore(source, key);
    try {
      const registered = await live.register(credentials, 'synthetic');
      const data = createInitialData(); data.libraryItems[0].name = 'Synthetic private backup item';
      const payload = accountMetadataBackup(data);
      const expectedPayload = JSON.parse(JSON.stringify(payload));
      live.saveVault(registered.session, { consent: true, revision: 0, backup: payload });
      expect((await stat(`${source}-wal`)).size).toBeGreaterThan(0);
      const result = await backupAccounts(source, destination);
      expect(result.pages).toBeGreaterThan(0);
      const bytes = await readFile(destination);
      expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      for (const secret of [credentials.username, credentials.name, credentials.password, data.libraryItems[0].name]) {
        expect(bytes.includes(Buffer.from(secret))).toBe(false);
      }
      if (process.platform !== 'win32') expect((await stat(destination)).mode & 0o777).toBe(0o600);
      // A later source edit must not silently change the published snapshot.
      data.libraryItems[0].name = 'Later live edit';
      live.saveVault(registered.session, { consent: true, revision: 1, backup: accountMetadataBackup(data) });
      await copyFile(destination, restored);
      expect(() => new AccountStore(restored, Buffer.alloc(32, 12))).toThrow(/key does not match/);
      const recovery = new AccountStore(restored, key);
      try {
        recovery.checkReady();
        const session = await recovery.login(credentials, 'restored');
        expect(session.profile.id).toBe(registered.session.profile.id);
        expect(recovery.vault(session)).toMatchObject({ revision: 1, backup: expectedPayload });
      } finally { recovery.close(); }
      expect(live.vault(registered.session).revision).toBe(2);
      expect(await readFile(destination)).toEqual(bytes);
      expect((await readdir(root)).filter(name => name.startsWith('.packing-backup-'))).toEqual([]);
    } finally { live.close(); }
  }, 15000);

  it('refuses overwrite, missing sources and unrelated databases without publishing or removing files', async () => {
    const root = await createTestTempDirectory('packing-backup-');
    const source = join(root, 'source.sqlite'), existing = join(root, 'existing.sqlite'), output = join(root, 'new.sqlite');
    await writeFile(existing, 'preserve this backup');
    const db = new DatabaseSync(source); db.exec('CREATE TABLE unrelated (value TEXT)'); db.close();
    await expect(backupAccounts(source, existing)).rejects.toThrow(/already exists/);
    expect(await readFile(existing, 'utf8')).toBe('preserve this backup');
    await expect(backupAccounts(join(root, 'missing.sqlite'), output)).rejects.toThrow();
    await expect(backupAccounts(source, output)).rejects.toThrow();
    expect((await readdir(root)).sort()).toEqual(['existing.sqlite', 'source.sqlite']);
  });

  it('runs the actual operator CLI and returns a nonzero status without replacing an existing file', async () => {
    const root = await createTestTempDirectory('packing-backup-');
    const source = join(root, 'source.sqlite'), output = join(root, 'snapshot.sqlite');
    const store = new AccountStore(source, Buffer.alloc(32, 4)); store.close();
    const args = ['server/account-backup.ts', source, output];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
    expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(first.stdout).sha256).toMatch(/^[a-f0-9]{64}$/);
    const before = await readFile(output);
    const second = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 15000 });
    expect(second.status).toBe(1);
    expect(await readFile(output)).toEqual(before);
    expect(second.stdout).toBe('');
  }, 35000);

  it('publishes exactly one snapshot when two backups select the same destination', async () => {
    const root = await createTestTempDirectory('packing-backup-');
    const source = join(root, 'source.sqlite'), output = join(root, 'snapshot.sqlite');
    const store = new AccountStore(source, Buffer.alloc(32, 4)); store.close();
    const outcomes = await Promise.allSettled([backupAccounts(source, output), backupAccounts(source, output)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect((await readdir(root)).filter(name => !name.startsWith('source.sqlite')).sort()).toEqual(['snapshot.sqlite']);
  });

  it('cleans up an aborted snapshot without publishing an incomplete backup', async () => {
    const root = await createTestTempDirectory('packing-backup-');
    const source = join(root, 'source.sqlite'), output = join(root, 'snapshot.sqlite');
    const store = new AccountStore(source, Buffer.alloc(32, 4)); store.close();
    await expect(backupAccounts(source, output, 0)).rejects.toThrow(/time limit/);
    expect((await readdir(root)).filter(name => !name.startsWith('source.sqlite'))).toEqual([]);
  });
});
