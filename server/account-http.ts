import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { AccountError, ACCOUNT_VAULT_BYTES, type AccountSession, type AccountStore } from './accounts.ts';

const PREFIX = '/api/v1/account';
const loopback = (host: string) => ['127.0.0.1', 'localhost', '[::1]', '::1', '::ffff:127.0.0.1'].includes(host);
export class AccountApi {
  readonly store: AccountStore;
  readonly origin: string;
  private readonly host: string;
  private readonly secure: boolean;
  private readonly cookieName: string;
  private readonly registrations: boolean;
  private reading = 0;
  constructor(store: AccountStore, origin: string, registrations = false) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname)))) throw new Error('Account origin must be an exact HTTPS origin, or loopback HTTP for local use.');
    this.store = store; this.origin = origin; this.host = url.host; this.secure = url.protocol === 'https:'; this.registrations = registrations;
    this.cookieName = this.secure ? '__Host-packing_session' : 'packing_session';
  }
  private cookie(response: ServerResponse, token?: string) {
    response.setHeader('Set-Cookie', `${this.cookieName}=${token ?? ''}; Path=${this.secure ? '/' : PREFIX}; HttpOnly; SameSite=Strict; Max-Age=${token ? 43200 : 0}${this.secure ? '; Secure' : ''}`);
  }
  private token(request: IncomingMessage): string | undefined {
    const matches = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${this.cookieName}=`));
    return matches.length === 1 ? matches[0].slice(this.cookieName.length + 1) : undefined;
  }
  private authenticated(request: IncomingMessage, mutating: boolean): AccountSession {
    const session = this.store.readSession(this.token(request));
    if (!session) throw new AccountError(401, 'sign_in_required', 'Sign in to use this account.');
    if (mutating) {
      const csrf = request.headers['x-packing-csrf'];
      if (typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))) throw new AccountError(403, 'request_not_allowed', 'Reload the account screen before making this change.');
    }
    return session;
  }
  private async body(request: IncomingMessage, maximum = 16384): Promise<Record<string, unknown>> {
    if (this.reading >= 4) throw new AccountError(429, 'account_busy', 'Account upload handling is busy. Try again shortly.');
    this.reading++;
    try {
    if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AccountError(415, 'json_required', 'Send account changes as JSON.');
    if (Number(request.headers['content-length'] ?? 0) > maximum) throw new AccountError(413, 'request_too_large', 'This account request is too large.');
    const text = await new Promise<string>((resolve, reject) => {
      let total = 0; const chunks: Buffer[] = [];
      const timer = setTimeout(() => finish(new AccountError(408, 'request_timeout', 'The account request timed out.')), 10000);
      const finish = (error?: Error) => { clearTimeout(timer); request.off('data', data); request.off('end', end); request.off('error', errorHandler); request.off('aborted', aborted); if (error) { request.resume(); reject(error); } else resolve(Buffer.concat(chunks).toString('utf8')); };
      const data = (chunk: Buffer) => { total += chunk.length; if (total > maximum || chunks.length >= 2048) { finish(new AccountError(413, 'request_too_large', 'This account request is too large.')); return; } chunks.push(chunk); };
      const end = () => finish(); const errorHandler = (error: Error) => finish(error); const aborted = () => finish(new AccountError(400, 'request_aborted', 'The account request was interrupted.'));
      request.on('data', data); request.on('end', end); request.on('error', errorHandler); request.on('aborted', aborted);
    });
    try { const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
    catch { throw new AccountError(400, 'invalid_json', 'Use a valid JSON account request.'); }
    } finally { this.reading--; }
  }
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) return false;
    const json = (status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Vary', 'Cookie');
    try {
      const mutating = request.method !== 'GET', origin = request.headers.origin;
      if (request.headers.host !== this.host || (!this.secure && !loopback(request.socket.remoteAddress ?? '')) || origin !== undefined && origin !== this.origin || mutating && origin !== this.origin) throw new AccountError(403, 'request_not_allowed', 'Use the account screen on this server.');
      if (url.search || request.method === 'GET' && (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'])) throw new AccountError(400, 'invalid_request', 'This account endpoint accepts no query parameters or GET body.');
      const path = url.pathname.slice(PREFIX.length), peer = request.socket.remoteAddress ?? 'unknown';
      const methods: Record<string, string[]> = { '/session': ['GET', 'DELETE'], '/sessions': ['POST', 'DELETE'], '/registrations': ['POST'], '/recovery': ['POST'], '/vault': ['GET', 'PUT'], '/vault/backup': ['GET'], '/export': ['GET'], '/password': ['POST'], '': ['DELETE'] };
      const group = path.match(/^\/households\/([a-f0-9-]{36})(?:\/(ownership|invitations|members|packs)(?:\/([a-f0-9-]{36}))?)?$/);
      const householdMethods = path === '/households' ? ['GET','POST'] : path === '/households/memberships' ? ['POST'] : group ? !group[2] ? ['GET','DELETE'] : group[2] === 'ownership' && !group[3] ? ['POST'] : group[2] === 'invitations' ? group[3] ? ['DELETE'] : ['POST'] : group[2] === 'members' && group[3] ? ['DELETE'] : group[2] === 'packs' ? group[3] ? ['GET','PUT','DELETE'] : ['GET','POST'] : undefined : undefined;
      const allowed = methods[path] ?? householdMethods;
      if (!allowed) { json(404, { error: { code: 'not_found', message: 'Account endpoint not found.' } }); return true; }
      if (!allowed.includes(request.method ?? '')) { response.setHeader('Allow', allowed.join(', ')); json(405, { error: { code: 'method_not_allowed', message: 'Use the supported account method.' } }); return true; }
      if (path === '/session' && request.method === 'GET') { const session = this.store.readSession(this.token(request)); json(200, { data: { available: true, registrations: this.registrations, profile: session?.profile ?? null, csrf: session?.csrf ?? null } }); return true; }
      if (path === '/registrations' && request.method === 'POST') {
        if (!this.registrations) throw new AccountError(403, 'registration_closed', 'New accounts are not enabled on this server.');
        const result = await this.store.register(await this.body(request), peer); this.cookie(response, result.session.token);
        response.setHeader('Location', `${PREFIX}/session`); json(201, { data: { profile: result.session.profile, csrf: result.session.csrf, recoveryCode: result.recoveryCode } }); return true;
      }
      if (path === '/sessions' && request.method === 'POST') { const session = await this.store.login(await this.body(request), peer); this.cookie(response, session.token); json(200, { data: { profile: session.profile, csrf: session.csrf } }); return true; }
      if (path === '/recovery' && request.method === 'POST') { const result = await this.store.recover(await this.body(request), peer); this.cookie(response, result.session.token); json(200, { data: { profile: result.session.profile, csrf: result.session.csrf, recoveryCode: result.recoveryCode } }); return true; }
      const session = this.authenticated(request, mutating);
      if(path==='/households'||path.startsWith('/households/'))this.store.guardHouseholdRequests(session,peer);
      if (path === '/households') { if(request.method==='GET') json(200,{data:this.store.households(session)});else {const result=this.store.createHousehold(session,await this.body(request));response.setHeader('Location',`${PREFIX}/households/${result.id}`);json(201,{data:result});}return true; }
      if (path === '/households/memberships') {const result=this.store.joinHousehold(session,await this.body(request),peer);response.setHeader('Location',`${PREFIX}/households/${result.id}`);json(201,{data:result});return true;}
      if (group) {
        const [,id,resource,child]=group;
        if(!resource) {if(request.method==='GET')json(200,{data:this.store.household(session,id)});else {await this.store.deleteHousehold(session,id,await this.body(request),peer);response.writeHead(204);response.end();}return true;}
        if(resource==='ownership') {await this.store.transferHousehold(session,id,await this.body(request),peer);json(200,{data:{transferred:true}});return true;}
        if(resource==='invitations') {if(child){this.store.revokeInvitation(session,id,child);response.writeHead(204);response.end();}else{const result=this.store.inviteHousehold(session,id,await this.body(request));response.setHeader('Location',`${PREFIX}/households/${id}/invitations/${result.id}`);json(201,{data:result});}return true;}
        if(resource==='members') {this.store.removeMember(session,id,child);response.writeHead(204);response.end();return true;}
        if(resource==='packs') {
          if(request.method==='GET')json(200,{data:child?this.store.sharedPack(session,id,child):this.store.household(session,id).packs});
          else if(request.method==='DELETE'){this.store.deleteSharedPack(session,id,child,await this.body(request));response.writeHead(204);response.end();}
          else {const result=this.store.saveSharedPack(session,id,await this.body(request,8*1024*1024+65536),child);if(!child)response.setHeader('Location',`${PREFIX}/households/${id}/packs/${result.id}`);json(child?200:201,{data:result});}return true;
        }
      }
      if (path === '/session' && request.method === 'DELETE') { this.store.logout(session); this.cookie(response); response.writeHead(204); response.end(); return true; }
      if (path === '/sessions' && request.method === 'DELETE') { this.store.revokeOthers(session); json(200, { data: { revoked: true } }); return true; }
      if (path === '/vault' && request.method === 'GET') { json(200, { data: this.store.vaultSummary(session) }); return true; }
      if (path === '/vault/backup' && request.method === 'GET') { const vault = this.store.vault(session); if (!vault.backup) throw new AccountError(404, 'backup_not_found', 'This account has no saved backup.'); json(200, { data: vault }); return true; }
      if (path === '/vault' && request.method === 'PUT') { json(200, { data: this.store.saveVault(session, await this.body(request, ACCOUNT_VAULT_BYTES + 65536)) }); return true; }
      if (path === '/export' && request.method === 'GET') { json(200, { data: this.store.exportAccount(session) }); return true; }
      if (path === '/password' && request.method === 'POST') { const result = await this.store.changePassword(session, await this.body(request), peer); this.cookie(response, result.session.token); json(200, { data: { profile: result.session.profile, csrf: result.session.csrf, recoveryCode: result.recoveryCode } }); return true; }
      if (path === '' && request.method === 'DELETE') { await this.store.deleteAccount(session, await this.body(request), peer); this.cookie(response); response.writeHead(204); response.end(); return true; }
      json(404, { error: { code: 'not_found', message: 'Account endpoint not found.' } });
    } catch (error) {
      if (response.destroyed || response.writableEnded) return true;
      if (error instanceof AccountError) { if (error.status === 429) response.setHeader('Retry-After', '900'); if ([408, 413, 429].includes(error.status)) response.setHeader('Connection', 'close'); json(error.status, { error: { code: error.code, message: error.message } }); }
      else json(503, { error: { code: 'account_unavailable', message: 'The account service could not complete this request. Your local packing data is unchanged.' } });
    }
    return true;
  }
}
