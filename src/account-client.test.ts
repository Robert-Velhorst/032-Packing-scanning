import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ platform: false, available: true, request: vi.fn(), forget: vi.fn(), exportFile: vi.fn(), availability: vi.fn() }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.platform, isPluginAvailable: () => native.available },
  registerPlugin: () => ({ request: native.request, forgetSession: native.forget, exportFile: native.exportFile, getAvailability: native.availability }),
}));
import { accountRequest } from './account-client';
import { accountAvailability, downloadAccountFile, forgetNativeAccount } from './native-account';

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); native.platform = false; native.available = true; });
describe('account transport selection and failures', () => {
  it('keeps browser authentication on the same origin', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { revision: 1 } }), { status: 200 })); vi.stubGlobal('fetch', fetch);
    expect(await accountRequest('/vault', 'PUT', { consent: true }, 'a'.repeat(64))).toEqual({ revision: 1 });
    expect(fetch.mock.calls[0][0]).toBe('/api/v1/account/vault'); expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store', method: 'PUT' });
    expect(native.request).not.toHaveBeenCalled();
  });
  it('uses the native bridge without browser fetch or caller supplied URLs', async () => {
    native.platform = true; native.availability.mockResolvedValue({ configured: true, serviceOrigin: 'https://accounts.example.com' });
    native.request.mockResolvedValue({ status: 200, bodyJson: '{"data":{"revision":2}}' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await accountRequest('/vault', 'PUT', { consent: true }, 'a'.repeat(64))).toEqual({ revision: 2 });
    expect(native.request).toHaveBeenCalledWith({ path: '/vault', method: 'PUT', bodyJson: '{"consent":true}', csrf: 'a'.repeat(64) });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not send requests on an unconfigured native build', async () => {
    native.platform = true; native.available = false; const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await accountAvailability()).toEqual({ native: true, configured: false });
    await expect(accountRequest('/session')).rejects.toMatchObject({ code: 'offline' });
    expect(native.request).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves real server conflict and authorization errors', async () => {
    native.platform = true; native.availability.mockResolvedValue({ configured: true });
    native.request.mockResolvedValue({ status: 409, bodyJson: '{"error":{"code":"backup_conflict","message":"Reload before saving."}}' });
    await expect(accountRequest('/vault', 'PUT', {})).rejects.toMatchObject({ code: 'backup_conflict', message: 'Reload before saving.' });
  });
  it('rejects malformed envelopes and never falls back after a native failure', async () => {
    native.platform = true; native.availability.mockResolvedValue({ configured: true }); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    for (const bodyJson of ['null', '[]', '{}', 'broken']) {
      native.request.mockResolvedValue({ status: 200, bodyJson }); await expect(accountRequest('/session')).rejects.toMatchObject({ code: 'account_unavailable' });
    }
    native.request.mockRejectedValue(new Error('unconfirmed')); await expect(accountRequest('/session')).rejects.toMatchObject({ code: 'offline' }); expect(fetch).not.toHaveBeenCalled();
  });
  it('honours native export cancellation and keeps local forgetting separate from remote logout', async () => {
    native.platform = true; native.exportFile.mockResolvedValue({ saved: false }); native.forget.mockResolvedValue(undefined);
    expect(await downloadAccountFile('packing-account-backup.json', { version: 1 })).toBe(false);
    await forgetNativeAccount(); expect(native.forget).toHaveBeenCalledOnce(); expect(native.request).not.toHaveBeenCalled();
  });
});
