import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { AccountStore, validateAccountBackup } from './accounts.ts';
import { accountMetadataBackup } from '../src/backup.ts';
import { createInitialData } from '../src/seed.ts';

const input = { username: 'qa-traveller', name: 'Synthetic account', password: 'synthetic passphrase 032 only' };
const key = Buffer.alloc(32, 7);
describe('private account store', () => {
  it('keeps private records encrypted, preserves source records, and survives restart with the correct key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'packing-account-')), file = join(root, 'accounts.sqlite');
    let store = new AccountStore(file, key);
    const registered = await store.register(input, 'loopback'), data = createInitialData(), before = structuredClone(data);
    data.libraryItems[0].name = 'Private synthetic medicine kit';
    const backup = accountMetadataBackup(data);
    store.saveVault(registered.session, { revision: 0, consent: true, backup });
    expect(store.vault(registered.session).backup).toEqual(backup);
    expect(data.libraryItems[1]).toEqual(before.libraryItems[1]);
    const accountId = registered.session.profile.id; store.close();
    const bytes = await readFile(file);
    for (const secret of ['Private synthetic medicine kit', input.username, input.password, input.name]) expect(bytes.includes(Buffer.from(secret))).toBe(false);
    expect(() => new AccountStore(file, Buffer.alloc(32, 8))).toThrow(/key does not match/);
    store = new AccountStore(file, key);
    try { const session = await store.login(input, 'loopback'); expect(session.profile.id).toBe(accountId); expect(store.vault(session).backup).toEqual(backup); } finally { store.close(); }
  }, 15000);
  it('isolates accounts and prevents a stale device from overwriting a newer backup', async () => {
    const store = new AccountStore(':memory:', key);
    try {
      const first = await store.register(input, 'one'), other = await store.register({ ...input, username: 'other-qa' }, 'two');
      const backup = accountMetadataBackup(createInitialData());
      expect(() => store.saveVault(first.session, { revision: 0, backup })).toThrow(/Confirm/);
      store.saveVault(first.session, { revision: 0, consent: true, backup });
      expect(store.vault(other.session).backup).toBeNull();
      expect(() => store.saveVault(first.session, { revision: 0, consent: true, backup })).toThrow(/changed on another device/);
      expect(store.vault(first.session).revision).toBe(1);
      const exported = JSON.stringify(store.exportAccount(first.session));
      expect(exported).toContain('backup_saved'); expect(exported).not.toContain('password_hash'); expect(exported).not.toContain(first.session.token);
    } finally { store.close(); }
  }, 15000);
  it('expires idle and absolute sessions, revokes other devices and does not accept chosen/fixed tokens', async () => {
    let now = 1000; const store = new AccountStore(':memory:', key, () => now);
    try {
      const first = await store.register(input, 'one'), second = await store.login(input, 'one');
      expect(first.session.token).not.toBe(second.token); expect(store.readSession('chosen-session')).toBeUndefined();
      store.revokeOthers(second); expect(store.readSession(first.session.token)).toBeUndefined(); expect(store.readSession(second.token)).toBeDefined();
      now += 30 * 60 * 1000; expect(store.readSession(second.token)).toBeUndefined();
      const third = await store.login(input, 'one');
      for (let i = 0; i < 48; i++) { now += 15 * 60 * 1000; if (i < 47) expect(store.readSession(third.token)).toBeDefined(); }
      expect(store.readSession(third.token)).toBeUndefined();
    } finally { store.close(); }
  }, 15000);
  it('rotates credentials and recovery, revokes old sessions, and accepts a recovery code only once under concurrency', async () => {
    const store = new AccountStore(':memory:', key);
    try {
      const first = await store.register(input, 'one');
      const changed = await store.changePassword(first.session, { currentPassword: input.password, newPassword: 'second synthetic passphrase 032' }, 'one');
      expect(store.readSession(first.session.token)).toBeUndefined();
      await expect(store.recover({ username: input.username, recoveryCode: first.recoveryCode, newPassword: 'third synthetic passphrase 032' }, 'one')).rejects.toMatchObject({ status: 401 });
      const results = await Promise.allSettled([1, 2].map(i => store.recover({ username: input.username, recoveryCode: changed.recoveryCode, newPassword: `recovered synthetic passphrase ${i}` }, 'one')));
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(store.readSession(changed.session.token)).toBeUndefined();
      await expect(store.login(input, 'one')).rejects.toMatchObject({ status: 401 });
    } finally { store.close(); }
  }, 20000);
  it('requires reauthentication and confirmation before deletion and removes current account data and sessions', async () => {
    const store = new AccountStore(':memory:', key);
    try {
      const first = await store.register(input, 'one'); store.saveVault(first.session, { revision: 0, consent: true, backup: accountMetadataBackup(createInitialData()) });
      await expect(store.deleteAccount(first.session, { password: input.password }, 'one')).rejects.toMatchObject({ status: 422 });
      await expect(store.deleteAccount(first.session, { password: 'incorrect synthetic password', confirm: true }, 'one')).rejects.toMatchObject({ status: 401 });
      expect(store.readSession(first.session.token)).toBeDefined();
      await store.deleteAccount(first.session, { password: input.password, confirm: true }, 'one');
      expect(store.readSession(first.session.token)).toBeUndefined(); await expect(store.login(input, 'one')).rejects.toMatchObject({ status: 401 });
    } finally { store.close(); }
  }, 15000);
  it('bounds account attempts and concurrent expensive password work without exposing credentials', async () => {
    let now = 1; const store = new AccountStore(':memory:', key, () => now);
    try {
      await store.register(input, 'one');
      for (let i = 0; i < 12; i++) await expect(store.recover({ username: 'unknown-qa', recoveryCode: 'not-a-recovery-code', newPassword: input.password }, 'one')).rejects.toMatchObject({ status: 401 });
      await expect(store.recover({ username: 'unknown-qa', recoveryCode: 'not-a-recovery-code', newPassword: input.password }, 'one')).rejects.toMatchObject({ status: 429 });
      now += 15 * 60 * 1000;
      const attempts = await Promise.allSettled([1, 2, 3].map(() => store.login(input, 'one')));
      expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(2);
      expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(1);
    } finally { store.close(); }
  }, 15000);
  it('does not issue a session when credentials change during asynchronous password verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'packing-account-race-')), file = join(root, 'accounts.sqlite');
    const store = new AccountStore(file, key), writer = new DatabaseSync(file);
    try {
      const first = await store.register(input, 'one');
      const pending = store.login(input, 'one');
      // A second request can rotate credentials while scrypt is still running.
      writer.prepare('UPDATE users SET recovery_hash=? WHERE id=?').run('synthetic-rotated-credential-version', first.session.profile.id);
      await expect(pending).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
      expect((writer.prepare('SELECT COUNT(*) AS total FROM sessions').get() as { total: number }).total).toBe(1);
    } finally { writer.close(); store.close(); }
  }, 15000);
  it('rejects native links/photos/malformed forms and strips sources without modifying local records', () => {
    const data = createInitialData(), item = data.libraryItems[0]; item.photoId = 'private-photo';
    item.scan = { id: 'private-scan', target: 'item', createdAt: new Date().toISOString(), platform: 'android', method: 'arcore_depth', completedPasses: 1, modelStoredLocally: true };
    const before = structuredClone(data), backup = accountMetadataBackup(data);
    expect(data).toEqual(before); expect(backup.app.libraryItems[0].scan).toBeUndefined(); expect(backup.app.libraryItems[0].photoId).toBeUndefined();
    validateAccountBackup(backup);
    expect(() => validateAccountBackup({ ...backup, app: data })).toThrow(/without photos or original native scan links/);
    backup.app.libraryItems[0].packingForms = [null as never]; expect(() => validateAccountBackup(backup)).toThrow(/supported metadata/);
  });
});
