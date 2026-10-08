import { Capacitor, registerPlugin } from '@capacitor/core';

interface NativeAccountPlugin {
  getAvailability(): Promise<{ configured: boolean; serviceOrigin?: string }>;
  request(options: { path: string; method: string; bodyJson?: string; csrf?: string }): Promise<{ status: number; bodyJson: string }>;
  forgetSession(): Promise<void>;
  exportFile(options: { name: string; text: string }): Promise<{ saved: boolean }>;
}
const account = registerPlugin<NativeAccountPlugin>('PackingAccount');
export function nativeAccounts(): boolean { return Capacitor.isNativePlatform(); }
export async function accountAvailability(): Promise<{ native: boolean; configured: boolean; serviceOrigin?: string }> {
  if (!nativeAccounts()) return { native: false, configured: true };
  if (!Capacitor.isPluginAvailable('PackingAccount')) return { native: true, configured: false };
  const value = await account.getAvailability();
  return { native: true, configured: value.configured === true, ...(value.serviceOrigin ? { serviceOrigin: value.serviceOrigin } : {}) };
}
export async function nativeAccountRequest(path: string, method: string, body?: unknown, csrf?: string | null) {
  if (!(await accountAvailability()).configured) throw new Error('Accounts are not configured on this installation.');
  return account.request({ path, method, ...(body === undefined ? {} : { bodyJson: JSON.stringify(body) }), ...(csrf ? { csrf } : {}) });
}
export async function forgetNativeAccount(): Promise<void> {
  if (nativeAccounts() && Capacitor.isPluginAvailable('PackingAccount')) await account.forgetSession();
}
/** Explicit file export. Native apps use the system save dialog, never a silent upload. */
export async function downloadAccountFile(name: string, value: unknown): Promise<boolean> {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (nativeAccounts()) {
    if (!Capacitor.isPluginAvailable('PackingAccount')) throw new Error('File export is unavailable on this installation.');
    return (await account.exportFile({ name, text })).saved;
  }
  const url = URL.createObjectURL(new Blob([text], { type: typeof value === 'string' ? 'text/plain' : 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
