import { nativeAccounts, nativeAccountRequest } from './native-account';

export interface PackingAccountProfile { id: string; username: string; name: string; createdAt: string; }
export interface PackingAccountState { available: boolean; registrations: boolean; profile: PackingAccountProfile | null; csrf: string | null; }
export interface AccountVaultSummary { revision: number; updatedAt: string | null; hasBackup: boolean; }
export interface AccountAuthResult { profile: PackingAccountProfile; csrf: string; recoveryCode?: string; }
export class AccountRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
/** Browser same-origin cookies or a fixed-origin native transport. Neither exposes session tokens. */
export async function accountRequest<T>(path: string, method = 'GET', body?: unknown, csrf?: string | null): Promise<T> {
  let response: { status: number; ok: boolean; json: () => Promise<unknown> };
  try {
    if (nativeAccounts()) {
      const result = await nativeAccountRequest(path, method, body, csrf);
      response = { status: result.status, ok: result.status >= 200 && result.status < 300, json: async () => JSON.parse(result.bodyJson) };
    } else response = await fetch(`/api/v1/account${path}`, { method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000), headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrf ? { 'X-Packing-CSRF': csrf } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  catch { throw new AccountRequestError('offline', 'The account request was not confirmed. Reconnect and reload the account version before retrying a save. Your local packing records remain available.'); }
  if (response.status === 204) return undefined as T;
  let value: { data?: T; error?: { code?: string; message?: string } };
  try {
    const parsed = await response.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    value = parsed as typeof value;
  } catch { throw new AccountRequestError('account_unavailable', 'Accounts are not available on this installation. Local packing is unchanged.'); }
  if (!response.ok) throw new AccountRequestError(value.error?.code ?? 'account_unavailable', value.error?.message ?? 'The account request could not be completed.');
  if (!Object.hasOwn(value, 'data')) throw new AccountRequestError('account_unavailable', 'The account service returned an unsupported response.');
  return value.data as T;
}
