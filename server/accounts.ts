import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isPackingBackup, type PackingBackup } from '../src/backup.ts';
import { isSharedPackingRecords, type HouseholdSummary, type SharedPackSnapshot, type SharedPackingRecords } from '../src/shared-packs.ts';

export const ACCOUNT_VAULT_BYTES = 16 * 1024 * 1024;
const IDLE_MS = 30 * 60 * 1000, ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export interface AccountProfile { id: string; username: string; name: string; createdAt: string; }
export interface AccountSession { profile: AccountProfile; csrf: string; token: string; }
export class AccountError extends Error {
  readonly status: number; readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const fail = (status: number, code: string, message: string): never => { throw new AccountError(status, code, message); };
const safeEqual = (a: string | Uint8Array, b: string | Uint8Array) => { const left = typeof a === 'string' ? Buffer.from(a) : Buffer.from(a), right = typeof b === 'string' ? Buffer.from(b) : Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
function username(value: unknown): string {
  if (typeof value !== 'string') return fail(422, 'invalid_account', 'Use a username with 3–40 letters, digits, dots, underscores or hyphens.');
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(result)) return fail(422, 'invalid_account', 'Use a username with 3–40 letters, digits, dots, underscores or hyphens.');
  return result;
}
function password(value: unknown): string {
  if (typeof value !== 'string' || value.length < 15 || value.length > 128 || Buffer.byteLength(value) > 512) return fail(422, 'invalid_password', 'Use a password or passphrase of 15–128 characters.');
  return value;
}
export function validateAccountBackup(value: unknown): asserts value is PackingBackup {
  if (!isPackingBackup(value) || value.photos.length !== 0 || value.app.libraryItems.some(item => item.scan !== undefined || item.photoId !== undefined)
    || value.app.containers.some(bag => bag.scan !== undefined)) fail(422, 'invalid_backup', 'Use a supported metadata backup without photos or original native scan links.');
  if (Buffer.byteLength(JSON.stringify(value)) > ACCOUNT_VAULT_BYTES) fail(413, 'backup_too_large', 'This account backup exceeds 16 MB.');
}

/** One operator-managed encrypted store. Keys are supplied separately from the database. */
export class AccountStore {
  private readonly db: DatabaseSync;
  private readonly master: Buffer;
  private readonly clock: () => number;
  private hashing = 0;
  private readonly attempts = new Map<string, { count: number; expires: number }>();
  constructor(path: string, key: Uint8Array, now: () => number = Date.now) {
    if (key.length !== 32) throw new Error('Account encryption key must contain exactly 32 bytes.');
    this.master = Buffer.from(key); this.clock = now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS metadata (id INTEGER PRIMARY KEY CHECK(id=1), key_check BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, lookup TEXT UNIQUE NOT NULL, salt BLOB NOT NULL, password_hash BLOB NOT NULL, recovery_hash TEXT NOT NULL, profile BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created INTEGER NOT NULL, seen INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS vaults (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT, payload BLOB);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, action TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS households (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name BLOB NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS household_members (household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, joined_at TEXT NOT NULL, PRIMARY KEY(household_id,user_id));
      CREATE TABLE IF NOT EXISTS household_invitations (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT UNIQUE NOT NULL, expires INTEGER NOT NULL, UNIQUE(household_id,user_id));
      CREATE TABLE IF NOT EXISTS shared_packs (id TEXT PRIMARY KEY, household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT REFERENCES users(id) ON DELETE SET NULL, payload BLOB NOT NULL);`);
    const check = this.mac('key-check', 'packing-account-store-v1');
    const existing = this.db.prepare('SELECT key_check FROM metadata WHERE id=1').get() as { key_check: Uint8Array } | undefined;
    if (existing && !safeEqual(existing.key_check, check)) { this.db.close(); this.master.fill(0); throw new Error('The configured account encryption key does not match this store.'); }
    if (!existing) this.db.prepare('INSERT INTO metadata VALUES(1,?)').run(Buffer.from(check));
  }
  close() { this.db.close(); this.master.fill(0); }
  private mac(purpose: string, value: string): string { return createHmac('sha256', this.master).update(purpose).update('\0').update(value).digest('hex'); }
  private cryptKey() { return createHmac('sha256', this.master).update('packing-account-encryption-v1').digest(); }
  private encrypt(kind: string, id: string, value: unknown): Buffer {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.cryptKey(), iv); cipher.setAAD(Buffer.from(`${kind}:${id}`));
    const payload = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), payload]);
  }
  private decrypt<T>(kind: string, id: string, value: Uint8Array): T {
    const data = Buffer.from(value), decipher = createDecipheriv('aes-256-gcm', this.cryptKey(), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${kind}:${id}`)); decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as T;
  }
  private transaction<T>(work: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = work(); this.db.exec('COMMIT'); return result; } catch (error) { this.db.exec('ROLLBACK'); throw error; } }
  private audit(id: string, action: string) {
    this.db.prepare('INSERT INTO audit(user_id,action,at) VALUES(?,?,?)').run(id, action, new Date(this.clock()).toISOString());
    this.db.prepare('DELETE FROM audit WHERE user_id=? AND id NOT IN (SELECT id FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 500)').run(id, id);
  }
  private throttle(peer: string, identity: string) {
    const now = this.clock();
    for (const [key, value] of this.attempts) if (value.expires <= now) this.attempts.delete(key);
    for (const [label, limit] of [[`peer:${peer}`, 40], [`identity:${identity}`, 12]] as const) {
      const key = this.mac('attempt', label), record = this.attempts.get(key) ?? { count: 0, expires: now + 15 * 60 * 1000 };
      if (this.attempts.size >= 10000 && !this.attempts.has(key) || ++record.count > limit) fail(429, 'rate_limited', 'Too many account attempts. Try again later.');
      this.attempts.set(key, record);
    }
  }
  private async derive(secret: string, salt: Uint8Array): Promise<Buffer> {
    if (this.hashing >= 2) return fail(429, 'account_busy', 'Account verification is busy. Try again shortly.');
    this.hashing++;
    try { return await new Promise<Buffer>((resolve, reject) => scrypt(secret, salt, 32, { N: 131072, r: 8, p: 1, maxmem: 192 * 1024 * 1024 }, (error, result) => error ? reject(error) : resolve(result))); }
    finally { this.hashing--; }
  }
  private userByName(name: string) { return this.db.prepare('SELECT * FROM users WHERE lookup=?').get(this.mac('username', name)) as { id: string; salt: Uint8Array; password_hash: Uint8Array; recovery_hash: string; profile: Uint8Array } | undefined; }
  private async verified(name: string, secret: string, peer: string) {
    this.throttle(peer, name); const user = this.userByName(name);
    const derived = await this.derive(secret, user?.salt ?? Buffer.alloc(16));
    const current = this.userByName(name);
    if (!user || !current || current.id !== user.id || current.recovery_hash !== user.recovery_hash || !safeEqual(derived, current.password_hash)) return fail(401, 'invalid_credentials', 'The account details could not be verified.');
    return current;
  }
  private session(id: string): AccountSession {
    const token = randomBytes(32).toString('base64url'), now = this.clock();
    this.db.prepare('DELETE FROM sessions WHERE created<=? OR seen<=?').run(now - ABSOLUTE_MS, now - IDLE_MS);
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(this.mac('session', token), id, now, now);
    this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY created DESC, rowid DESC LIMIT 5)').run(id, id);
    const row = this.db.prepare('SELECT profile FROM users WHERE id=?').get(id) as { profile: Uint8Array };
    return { profile: this.decrypt<AccountProfile>('profile', id, row.profile), token, csrf: this.mac('csrf', token) };
  }
  readSession(token?: string): AccountSession | undefined {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const hash = this.mac('session', token), row = this.db.prepare('SELECT s.*,u.profile FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=?').get(hash) as { user_id: string; created: number; seen: number; profile: Uint8Array } | undefined;
    const now = this.clock();
    if (!row) return;
    if (now - row.created >= ABSOLUTE_MS || now - row.seen >= IDLE_MS) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash); return; }
    this.db.prepare('UPDATE sessions SET seen=? WHERE token_hash=?').run(now, hash);
    return { profile: this.decrypt<AccountProfile>('profile', row.user_id, row.profile), token, csrf: this.mac('csrf', token) };
  }
  async register(input: { username?: unknown; name?: unknown; password?: unknown }, peer: string) {
    const handle = username(input.username), secret = password(input.password);
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 70) return fail(422, 'invalid_account', 'Enter a display name up to 70 characters.');
    this.throttle(peer, handle);
    if (Number((this.db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }).total) >= 1000) return fail(503, 'account_capacity', 'This server cannot create another account.');
    const salt = randomBytes(16), hash = await this.derive(secret, salt), recoveryCode = randomBytes(32).toString('base64url');
    const profile: AccountProfile = { id: randomUUID(), username: handle, name: input.name.trim(), createdAt: new Date(this.clock()).toISOString() };
    this.transaction(() => {
      if (this.userByName(handle)) return fail(409, 'account_unavailable', 'That username cannot be registered.');
      if (Number((this.db.prepare('SELECT COUNT(*) AS total FROM users').get() as { total: number }).total) >= 1000) return fail(503, 'account_capacity', 'This server cannot create another account.');
      this.db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(profile.id, this.mac('username', handle), salt, hash, this.mac('recovery', `${profile.id}:${recoveryCode}`), this.encrypt('profile', profile.id, profile));
      this.db.prepare('INSERT INTO vaults(user_id,revision) VALUES(?,0)').run(profile.id); this.audit(profile.id, 'account_created');
    });
    return { session: this.session(profile.id), recoveryCode };
  }
  async login(input: { username?: unknown; password?: unknown }, peer: string) { const handle = username(input.username), secret = password(input.password), user = await this.verified(handle, secret, peer); this.audit(user.id, 'signed_in'); return this.session(user.id); }
  logout(session: AccountSession) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(this.mac('session', session.token)); this.audit(session.profile.id, 'signed_out'); }
  revokeOthers(session: AccountSession) { this.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(session.profile.id, this.mac('session', session.token)); this.audit(session.profile.id, 'other_sessions_revoked'); }
  vault(session: AccountSession) {
    const row = this.db.prepare('SELECT * FROM vaults WHERE user_id=?').get(session.profile.id) as { revision: number; updated_at: string | null; payload: Uint8Array | null };
    return { revision: row.revision, updatedAt: row.updated_at, backup: row.payload ? this.decrypt<PackingBackup>('vault', session.profile.id, row.payload) : null };
  }
  vaultSummary(session: AccountSession) {
    const row = this.db.prepare('SELECT revision,updated_at,payload IS NOT NULL AS has_backup FROM vaults WHERE user_id=?').get(session.profile.id) as { revision: number; updated_at: string | null; has_backup: number };
    return { revision: row.revision, updatedAt: row.updated_at, hasBackup: Boolean(row.has_backup) };
  }
  saveVault(session: AccountSession, input: { revision?: unknown; consent?: unknown; backup?: unknown }) {
    if (input.consent !== true) return fail(422, 'upload_consent_required', 'Confirm the private metadata upload before saving.');
    if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) return fail(422, 'invalid_revision', 'Load the current account backup before saving.');
    validateAccountBackup(input.backup); const now = new Date(this.clock()).toISOString();
    return this.transaction(() => {
      const result = this.db.prepare('UPDATE vaults SET revision=revision+1,updated_at=?,payload=? WHERE user_id=? AND revision=?').run(now, this.encrypt('vault', session.profile.id, input.backup), session.profile.id, input.revision as number);
      if (Number(result.changes) !== 1) return fail(409, 'backup_conflict', 'The account backup changed on another device. Reload it before choosing what to save.');
      this.audit(session.profile.id, 'backup_saved'); return { revision: Number(input.revision) + 1, updatedAt: now };
    });
  }
  exportAccount(session: AccountSession) { this.audit(session.profile.id, 'account_exported'); return { format: 'packing-account-export', profile: session.profile, vault: this.vault(session), households: this.households(session).map(house => this.household(session,house.id)), audit: this.db.prepare('SELECT action,at FROM audit WHERE user_id=? ORDER BY id DESC LIMIT 500').all(session.profile.id) }; }
  private house(session: AccountSession, id: string, owner = false) {
    const row = this.db.prepare('SELECT h.* FROM households h JOIN household_members m ON m.household_id=h.id WHERE h.id=? AND m.user_id=?').get(id,session.profile.id) as { id: string; owner_id: string; name: Uint8Array; created_at: string } | undefined;
    if (!row) return fail(404,'household_not_found','This household is unavailable to your account.');
    if (owner && row.owner_id !== session.profile.id) return fail(403,'household_owner_required','Only the household owner can make this change.');
    return row;
  }
  households(session: AccountSession): HouseholdSummary[] {
    const rows = this.db.prepare('SELECT h.* FROM households h JOIN household_members m ON m.household_id=h.id WHERE m.user_id=? ORDER BY h.created_at,h.id').all(session.profile.id) as Array<{id:string;owner_id:string;name:Uint8Array;created_at:string}>;
    return rows.map(row => ({id:row.id,ownerId:row.owner_id,name:this.decrypt<string>('household',row.id,row.name),createdAt:row.created_at}));
  }
  guardHouseholdRequests(session:AccountSession,peer:string) {
    const now=this.clock();for(const [key,value]of this.attempts)if(value.expires<=now)this.attempts.delete(key);
    for(const [label,limit]of [[`household-peer:${peer}`,600],[`household-account:${session.profile.id}`,180]] as const){const key=this.mac('attempt',label),record=this.attempts.get(key)??{count:0,expires:now+15*60*1000};if(this.attempts.size>=10000&&!this.attempts.has(key)||++record.count>limit)return fail(429,'household_rate_limited','Too many household requests. Local copies remain available; try again later.');this.attempts.set(key,record);}
  }
  createHousehold(session: AccountSession, input: {name?:unknown}) {
    if(typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) return fail(422,'invalid_household','Enter a household name up to 80 characters.');
    const id=randomUUID(),createdAt=new Date(this.clock()).toISOString(),name=input.name.trim();
    this.transaction(()=>{
      if(Number((this.db.prepare('SELECT COUNT(*) AS n FROM households WHERE owner_id=?').get(session.profile.id) as {n:number}).n)>=5 || Number((this.db.prepare('SELECT COUNT(*) AS n FROM household_members WHERE user_id=?').get(session.profile.id) as {n:number}).n)>=20 || Number((this.db.prepare('SELECT COUNT(*) AS n FROM households').get() as {n:number}).n)>=1000) return fail(422,'household_limit','This account or server has reached its household limit.');
      this.db.prepare('INSERT INTO households VALUES(?,?,?,?)').run(id,session.profile.id,this.encrypt('household',id,name),createdAt);
      this.db.prepare('INSERT INTO household_members VALUES(?,?,?)').run(id,session.profile.id,createdAt);this.audit(session.profile.id,'household_created');
    });return {id,name,ownerId:session.profile.id,createdAt};
  }
  household(session:AccountSession,id:string) {
    const row=this.house(session,id);
    const members=(this.db.prepare('SELECT u.id,u.profile FROM users u JOIN household_members m ON m.user_id=u.id WHERE m.household_id=? ORDER BY m.joined_at,u.id').all(id) as Array<{id:string;profile:Uint8Array}>).map(user=>{const p=this.decrypt<AccountProfile>('profile',user.id,user.profile);return {id:p.id,name:p.name,username:p.username};});
    const packs=(this.db.prepare('SELECT * FROM shared_packs WHERE household_id=? ORDER BY updated_at DESC,id').all(id) as Array<{id:string;revision:number;updated_at:string;updated_by:string|null;payload:Uint8Array}>).map(pack=>({id:pack.id,name:this.decrypt<SharedPackingRecords>('shared-pack',pack.id,pack.payload).trip.name,revision:pack.revision,updatedAt:pack.updated_at,updatedBy:pack.updated_by??'deleted-account'}));
    const invitations=row.owner_id===session.profile.id ? (this.db.prepare('SELECT i.id,i.expires,u.id AS user_id,u.profile FROM household_invitations i JOIN users u ON u.id=i.user_id WHERE i.household_id=? AND i.expires>? ORDER BY i.expires').all(id,this.clock()) as Array<{id:string;expires:number;user_id:string;profile:Uint8Array}>).map(invite=>({id:invite.id,username:this.decrypt<AccountProfile>('profile',invite.user_id,invite.profile).username,expiresAt:new Date(invite.expires).toISOString()})) : [];
    return {id:row.id,name:this.decrypt<string>('household',id,row.name),ownerId:row.owner_id,createdAt:row.created_at,members,packs,invitations};
  }
  inviteHousehold(session:AccountSession,id:string,input:{username?:unknown}) {
    this.house(session,id,true);const target=this.userByName(username(input.username));
    if(!target) return fail(422,'invitation_unavailable','Choose an existing packing account to invite.');
    const inviteId=randomUUID(),code=randomBytes(32).toString('base64url'),expires=this.clock()+48*60*60*1000;
    this.transaction(()=>{
      this.db.prepare('DELETE FROM household_invitations WHERE expires<=?').run(this.clock());
      if(this.db.prepare('SELECT 1 FROM household_members WHERE household_id=? AND user_id=?').get(id,target.id)) return fail(409,'already_member','That account already belongs to this household.');
      if(Number((this.db.prepare('SELECT COUNT(*) AS n FROM household_invitations WHERE household_id=?').get(id) as {n:number}).n)>=20&&!this.db.prepare('SELECT 1 FROM household_invitations WHERE household_id=? AND user_id=?').get(id,target.id)) return fail(422,'invitation_limit','Review pending invitations before adding another.');
      this.db.prepare('INSERT INTO household_invitations VALUES(?,?,?,?,?) ON CONFLICT(household_id,user_id) DO UPDATE SET id=excluded.id,token_hash=excluded.token_hash,expires=excluded.expires').run(inviteId,id,target.id,this.mac('household-invitation',code),expires);this.audit(session.profile.id,'household_invitation_created');
    });return {id:inviteId,code,expiresAt:new Date(expires).toISOString()};
  }
  joinHousehold(session:AccountSession,input:{code?:unknown;consent?:unknown},peer:string) {
    this.throttle(peer,`household-join:${session.profile.id}`);
    if(input.consent!==true) return fail(422,'join_consent_required','Confirm household membership before joining.');
    if(typeof input.code!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.code)) return fail(404,'invitation_unavailable','This invitation is unavailable to your account.');
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM household_invitations WHERE token_hash=? AND user_id=? AND expires>?').get(this.mac('household-invitation',input.code as string),session.profile.id,this.clock()) as {id:string;household_id:string}|undefined;
      if(!row)return fail(404,'invitation_unavailable','This invitation is unavailable to your account.');
      if(Number((this.db.prepare('SELECT COUNT(*) AS n FROM household_members WHERE household_id=?').get(row.household_id) as {n:number}).n)>=20||Number((this.db.prepare('SELECT COUNT(*) AS n FROM household_members WHERE user_id=?').get(session.profile.id) as {n:number}).n)>=20)return fail(422,'membership_limit','This household or account has reached its membership limit.');
      this.db.prepare('INSERT INTO household_members VALUES(?,?,?)').run(row.household_id,session.profile.id,new Date(this.clock()).toISOString());this.db.prepare('DELETE FROM household_invitations WHERE id=?').run(row.id);this.audit(session.profile.id,'household_joined');return this.households(session).find(house=>house.id===row.household_id)!;
    });
  }
  revokeInvitation(session:AccountSession,id:string,invitationId:string) {this.house(session,id,true);this.db.prepare('DELETE FROM household_invitations WHERE household_id=? AND id=?').run(id,invitationId);this.audit(session.profile.id,'household_invitation_revoked');}
  removeMember(session:AccountSession,id:string,userId:string) {const row=this.house(session,id);if(userId===row.owner_id)return fail(409,'owner_cannot_leave','Transfer ownership or delete this household before leaving.');if(userId!==session.profile.id&&row.owner_id!==session.profile.id)return fail(403,'household_owner_required','Only the household owner can remove another member.');this.db.prepare('DELETE FROM household_members WHERE household_id=? AND user_id=?').run(id,userId);this.audit(session.profile.id,userId===session.profile.id?'household_left':'household_member_removed');}
  sharedPack(session:AccountSession,householdId:string,id:string):SharedPackSnapshot {
    this.house(session,householdId);const row=this.db.prepare('SELECT * FROM shared_packs WHERE household_id=? AND id=?').get(householdId,id) as {id:string;revision:number;updated_at:string;updated_by:string|null;payload:Uint8Array}|undefined;
    if(!row)return fail(404,'shared_pack_not_found','This shared pack is unavailable.');
    this.audit(session.profile.id,'shared_pack_opened');const records=this.decrypt<SharedPackingRecords>('shared-pack',id,row.payload);return {id,householdId,name:records.trip.name,revision:row.revision,updatedAt:row.updated_at,updatedBy:row.updated_by??'deleted-account',records};
  }
  saveSharedPack(session:AccountSession,householdId:string,input:{records?:unknown;consent?:unknown;revision?:unknown},id?:string) {
    this.house(session,householdId);if(input.consent!==true)return fail(422,'sharing_consent_required','Confirm sharing this pack with every household member.');
    if(!isSharedPackingRecords(input.records))return fail(422,'invalid_shared_pack','Use a complete selected-pack record without photos, native links or unused personal items.');
    if(Buffer.byteLength(JSON.stringify(input.records))>8*1024*1024)return fail(413,'shared_pack_too_large','This shared pack exceeds 8 MB.');
    if(id&&(!Number.isSafeInteger(input.revision)||Number(input.revision)<1))return fail(422,'invalid_revision','Use the version opened on this device.');
    const records=input.records,packId=id??randomUUID(),now=new Date(this.clock()).toISOString();
    return this.transaction(()=>{
      if(id){const update=this.db.prepare('UPDATE shared_packs SET revision=revision+1,updated_at=?,updated_by=?,payload=? WHERE household_id=? AND id=? AND revision=?').run(now,session.profile.id,this.encrypt('shared-pack',packId,input.records),householdId,packId,input.revision as number);if(Number(update.changes)!==1)return fail(409,'shared_pack_conflict','This shared pack changed. Open its newer version as a separate local copy and review both before publishing.');}
      else {if(Number((this.db.prepare('SELECT COUNT(*) AS n FROM shared_packs WHERE household_id=?').get(householdId) as {n:number}).n)>=10)return fail(422,'shared_pack_limit','This household already has 10 shared packs.');this.db.prepare('INSERT INTO shared_packs VALUES(?,?,?,?,?,?)').run(packId,householdId,1,now,session.profile.id,this.encrypt('shared-pack',packId,input.records));}
      this.audit(session.profile.id,id?'shared_pack_updated':'shared_pack_created');return {id:packId,householdId,name:records.trip.name,revision:id?Number(input.revision)+1:1,updatedAt:now,updatedBy:session.profile.id};
    });
  }
  deleteSharedPack(session:AccountSession,householdId:string,id:string,input:{revision?:unknown;confirm?:unknown}) {this.house(session,householdId,true);if(input.confirm!==true||!Number.isSafeInteger(input.revision))return fail(422,'delete_confirmation_required','Confirm deletion of the reviewed shared pack version.');const deleted=this.db.prepare('DELETE FROM shared_packs WHERE household_id=? AND id=? AND revision=?').run(householdId,id,input.revision as number);if(Number(deleted.changes)!==1)return fail(409,'shared_pack_conflict','This shared pack changed. Reload before choosing whether to delete it.');this.audit(session.profile.id,'shared_pack_deleted');}
  async transferHousehold(session:AccountSession,id:string,input:{userId?:unknown;password?:unknown;confirm?:unknown},peer:string){this.house(session,id,true);if(input.confirm!==true||typeof input.userId!=='string'||input.userId===session.profile.id)return fail(422,'invalid_transfer','Choose another member and confirm ownership transfer.');const user=await this.verified(session.profile.username,password(input.password),peer);this.transaction(()=>{this.house(session,id,true);const current=this.userByName(session.profile.username);if(current?.recovery_hash!==user.recovery_hash)return fail(409,'account_changed','Account credentials changed. Sign in again.');if(!this.db.prepare('SELECT 1 FROM household_members WHERE household_id=? AND user_id=?').get(id,input.userId as string))return fail(422,'invalid_transfer','Choose a current household member.');if(Number((this.db.prepare('SELECT COUNT(*) AS n FROM households WHERE owner_id=?').get(input.userId as string) as {n:number}).n)>=5)return fail(422,'household_limit','That member has reached the ownership limit.');this.db.prepare('UPDATE households SET owner_id=? WHERE id=?').run(input.userId as string,id);this.audit(session.profile.id,'household_ownership_transferred');});}
  async deleteHousehold(session:AccountSession,id:string,input:{password?:unknown;confirm?:unknown},peer:string){this.house(session,id,true);if(input.confirm!==true)return fail(422,'delete_confirmation_required','Confirm deletion of the household and its shared packs.');const user=await this.verified(session.profile.username,password(input.password),peer);this.transaction(()=>{this.house(session,id,true);if(this.userByName(session.profile.username)?.recovery_hash!==user.recovery_hash)return fail(409,'account_changed','Account credentials changed. Sign in again.');this.db.prepare('DELETE FROM households WHERE id=?').run(id);this.audit(session.profile.id,'household_deleted');});this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}
  async changePassword(session: AccountSession, input: { currentPassword?: unknown; newPassword?: unknown }, peer: string) {
    const user = await this.verified(session.profile.username, password(input.currentPassword), peer); return this.replacePassword(session.profile.id, password(input.newPassword), 'password_changed', user.recovery_hash);
  }
  private async replacePassword(id: string, secret: string, action: string, expectedRecovery: string) {
    const salt = randomBytes(16), hash = await this.derive(secret, salt), recoveryCode = randomBytes(32).toString('base64url');
    this.transaction(() => { const changed = this.db.prepare('UPDATE users SET salt=?,password_hash=?,recovery_hash=? WHERE id=? AND recovery_hash=?').run(salt, hash, this.mac('recovery', `${id}:${recoveryCode}`), id, expectedRecovery); if (Number(changed.changes) !== 1) return fail(409, 'account_changed', 'Account credentials changed. Sign in again before retrying.'); this.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); this.audit(id, action); });
    return { session: this.session(id), recoveryCode };
  }
  async recover(input: { username?: unknown; recoveryCode?: unknown; newPassword?: unknown }, peer: string) {
    const handle = username(input.username), secret = password(input.newPassword); this.throttle(peer, handle);
    if (typeof input.recoveryCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.recoveryCode)) return fail(401, 'invalid_credentials', 'The account details could not be verified.');
    const user = this.userByName(handle);
    if (!user || !safeEqual(user.recovery_hash, this.mac('recovery', `${user.id}:${input.recoveryCode}`))) return fail(401, 'invalid_credentials', 'The account details could not be verified.');
    return this.replacePassword(user.id, secret, 'account_recovered', user.recovery_hash);
  }
  async deleteAccount(session: AccountSession, input: { password?: unknown; confirm?: unknown }, peer: string) {
    if (input.confirm !== true) return fail(422, 'delete_confirmation_required', 'Confirm account deletion.');
    const user = await this.verified(session.profile.username, password(input.password), peer);
    this.transaction(() => { if(this.db.prepare('SELECT 1 FROM households h JOIN household_members m ON m.household_id=h.id WHERE h.owner_id=? AND m.user_id<>? LIMIT 1').get(session.profile.id,session.profile.id))return fail(409,'household_owner_required','Transfer ownership or explicitly delete households with other members before deleting your account.');const changed = this.db.prepare('DELETE FROM users WHERE id=? AND recovery_hash=?').run(session.profile.id, user.recovery_hash); if (Number(changed.changes) !== 1) return fail(409, 'account_changed', 'Account credentials changed. Sign in again before retrying.'); });
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  }
}
