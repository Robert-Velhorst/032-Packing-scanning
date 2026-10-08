import { useEffect, useState, type FormEvent } from 'react';
import { accountAvailability, downloadAccountFile as download, forgetNativeAccount, nativeAccounts } from '../native-account';
import { accountRequest, AccountRequestError, type AccountAuthResult, type AccountVaultSummary, type PackingAccountState } from '../account-client';
import { accountMetadataBackup, isPackingBackup, type PackingBackup } from '../backup';
import type { AppData } from '../types';
import { HouseholdPanel } from './HouseholdPanel';
import type { SharedPackSnapshot, SharedCopyWitness } from '../shared-packs';
import type {SharedPackBaseline} from '../shared-pack-baseline';
import {DeviceWorkspaceSetup,useDeviceWorkspace} from './DeviceWorkspace';

const initial: PackingAccountState = { available: false, registrations: false, profile: null, csrf: null };
export function AccountPanel({ data, onRestore, onOpenShared, onPublished }: { data: AppData; onRestore: (file: File) => Promise<boolean>; onOpenShared: (snapshot: SharedPackSnapshot,baseline?:SharedPackBaseline,witness?:SharedCopyWitness) => void; onPublished: (tripId: string,snapshot:SharedPackSnapshot,baseline:SharedPackBaseline) => void }) {
  const device=useDeviceWorkspace();
  const native = nativeAccounts();
  const [serviceOrigin, setServiceOrigin] = useState('');
  const [account, setAccount] = useState(initial), [vault, setVault] = useState<AccountVaultSummary>();
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>('login');
  const [username, setUsername] = useState(''), [name, setName] = useState(''), [secret, setSecret] = useState('');
  const [newSecret, setNewSecret] = useState(''), [repeatSecret, setRepeatSecret] = useState(''), [recovery, setRecovery] = useState('');
  const [issuedRecovery, setIssuedRecovery] = useState(''), [consent, setConsent] = useState(false), [deleteConsent, setDeleteConsent] = useState(false);
  useEffect(() => { setConsent(false); }, [data]);
  useEffect(() => {
    let active = true;
    accountAvailability().then(async availability => {
      if (!active) return;
      setServiceOrigin(availability.serviceOrigin ?? '');
      if (!availability.configured) return;
      const result = await accountRequest<PackingAccountState>('/session');
      if (!active || result.profile && !device.accountKnown(result.profile.id)) return;
      const summary = result.profile ? await accountRequest<AccountVaultSummary>('/vault') : undefined;
      if (active) { setAccount(result); setVault(summary); }
    })
      .catch(error => { if (active) setNotice(error instanceof Error ? error.message : 'Accounts are unavailable.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const clearSecrets = () => { setSecret(''); setNewSecret(''); setRepeatSecret(''); setRecovery(''); };
  async function run(action: () => Promise<void>) {
    setBusy(true); setNotice('');
    try { await action(); }
    catch (error) { if (error instanceof AccountRequestError && error.code === 'sign_in_required') { setAccount(current => ({ ...current, profile: null, csrf: null })); setVault(undefined); setDeleteConsent(false); clearSecrets(); device.accountEnded(); } if (error instanceof AccountRequestError && error.code === 'backup_conflict') setConsent(false); setNotice(error instanceof Error ? error.message : 'The account request failed.'); }
    finally { setBusy(false); }
  }
  async function authenticated(result: AccountAuthResult) {
    if(!device.accountKnown(result.profile.id,true))return;
    setAccount(current => ({ ...current, available: true, profile: result.profile, csrf: result.csrf })); setIssuedRecovery(result.recoveryCode ?? ''); setMode('login'); clearSecrets(); setConsent(false); setDeleteConsent(false);
    setVault(await accountRequest<AccountVaultSummary>('/vault'));
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      if (mode !== 'login' && secret !== repeatSecret) throw new Error('The new passwords do not match.');
      const path = mode === 'register' ? '/registrations' : mode === 'recover' ? '/recovery' : '/sessions';
      const body = mode === 'register' ? { username, name, password: secret } : mode === 'recover' ? { username, recoveryCode: recovery, newPassword: secret } : { username, password: secret };
      await authenticated(await accountRequest<AccountAuthResult>(path, 'POST', body)); setNotice(mode === 'register' ? 'Account created. Save the recovery code before uploading a backup.' : mode === 'recover' ? 'Account recovered. The previous recovery code and sessions are no longer valid.' : 'Signed in. Local packing data has not been uploaded.');
    });
  }
  async function downloadBackup(restore = false) {
    const result = await accountRequest<{ backup: PackingBackup }>('/vault/backup');
    if (!isPackingBackup(result.backup)) throw new Error('This account backup is unsupported. Local data is unchanged.');
    if (restore) { const restored = await onRestore(new File([JSON.stringify(result.backup)], 'account-backup.json', { type: 'application/json' })); setNotice(restored ? 'Account backup restored on this device.' : 'Account restore was cancelled or could not be completed.'); }
    else { const saved = await download('packing-account-backup.json', result.backup); setNotice(saved ? 'Account backup downloaded. Keep it private.' : 'Account backup export cancelled.'); }
  }
  return <section className="settings-section account-panel" aria-label="Packing account"><h2>Packing account</h2>
    <p>Local guest packing works without an account. Optional accounts can hold a private backup on this installation’s server. Nothing uploads automatically.</p>
    {native && <p>{device.session?'Packing records, photos and new original scans belong to this protected device workspace. Locking or signing out closes its local key.':'Native scans and packing records use this device’s guest storage. Signing in alone does not protect them. Create or unlock a protected device workspace when available; guest copies remain visible.'}</p>}
    {serviceOrigin && <p>Account server: <strong>{serviceOrigin}</strong></p>}
    {loading ? <p role="status">Checking account availability…</p> : !account.available ? <p>{native ? 'Accounts are not configured or could not be reached on this installation. Local packing remains available.' : 'Accounts are not enabled here. Your packs remain available on this device.'}</p> : !account.profile ? <>
      <div className="account-mode-buttons"><button type="button" className="button button-secondary" disabled={busy} aria-pressed={mode === 'login'} onClick={() => { clearSecrets(); setMode('login'); }}>Sign in</button>{account.registrations && <button type="button" className="button button-secondary" disabled={busy} aria-pressed={mode === 'register'} onClick={() => { clearSecrets(); setMode('register'); }}>Create account</button>}<button type="button" className="button button-secondary" disabled={busy} aria-pressed={mode === 'recover'} onClick={() => { clearSecrets(); setMode('recover'); }}>Recover account</button></div>
      <form onSubmit={submit} className="account-form"><label className="field"><span>Account username</span><input required minLength={3} maxLength={40} autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)}/></label>
        {mode === 'register' && <label className="field"><span>Account display name</span><input required maxLength={70} value={name} onChange={e => setName(e.target.value)}/></label>}
        {mode === 'recover' && <label className="field"><span>Saved recovery code</span><input type="password" required autoComplete="off" value={recovery} onChange={e => setRecovery(e.target.value)}/></label>}
        <label className="field"><span>{mode === 'login' ? 'Account password' : 'New account password'}</span><input type="password" required minLength={15} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={secret} onChange={e => setSecret(e.target.value)}/></label>
        {mode !== 'login' && <label className="field"><span>Repeat new account password</span><input type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={repeatSecret} onChange={e => setRepeatSecret(e.target.value)}/></label>}
        <p>Use a passphrase of 15–128 characters. Recovery uses a private one-use code; no email is required.</p><button className="button button-primary" type="submit" disabled={busy}>{mode === 'register' ? 'Create my account' : mode === 'recover' ? 'Reset account password' : 'Sign in to my account'}</button>
      </form>
    </> : <>
      <p><strong>Signed in as {account.profile.name}</strong> · {account.profile.username}</p>
      {!issuedRecovery&&<DeviceWorkspaceSetup key={`workspace:${account.profile.id}`} profile={account.profile} data={data}/>}
      {issuedRecovery && <aside className="account-recovery" aria-label="New recovery code"><h3>Save your recovery code</h3><p>This one-use code can reset your account. Keep it separate from your password and never share it. A new code replaces the previous one.</p><code>{issuedRecovery}</code><div className="account-actions"><button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { const saved = await download('packing-account-recovery.txt', `Packing Scanning recovery\nUsername: ${account.profile!.username}\nRecovery code: ${issuedRecovery}\nKeep this private. It can reset the account.\n`); setNotice(saved ? 'Recovery code exported. Keep it private.' : 'Recovery code export cancelled. Keep the code visible until you save it.'); })}>Download recovery code</button><button className="button button-primary" disabled={busy} onClick={() => setIssuedRecovery('')}>I saved this code</button></div></aside>}
      <div className="account-backup"><h3>Private account backup</h3><p>{vault?.hasBackup ? `Saved version ${vault.revision} · ${vault.updatedAt ? new Date(vault.updatedAt).toLocaleString() : 'date unavailable'}` : 'No account backup yet.'}</p>
        <p>Includes {data.trips.length} local pack{data.trips.length === 1 ? '' : 's'}, {data.libraryItems.length} library item{data.libraryItems.length === 1 ? '' : 's'} and {data.containers.length} bag{data.containers.length === 1 ? '' : 's'}: names, travel details, measurements, weights, derived packing shapes and progress. Photos and original native scan files stay on this device.</p>
        {!!data.trips.length && <details><summary>Review included packs</summary><ul>{data.trips.map(trip => <li key={trip.id}>{trip.name}</li>)}</ul></details>}
        <label className="account-check"><input type="checkbox" checked={consent} disabled={busy || !!issuedRecovery} onChange={e => setConsent(e.target.checked)}/><span>I agree to upload these packing records as a private backup to this server. Saving replaces the previous account backup.</span></label>
        <div className="account-actions"><button className="button button-primary" disabled={busy || !consent || !vault || !!issuedRecovery} onClick={() => void run(async () => { const backup = accountMetadataBackup(data); if (!isPackingBackup(backup)) throw new Error('Review invalid local records before uploading.'); const result = await accountRequest<{ revision: number; updatedAt: string }>('/vault', 'PUT', { revision: vault!.revision, consent: true, backup }, account.csrf); setVault({ ...result, hasBackup: true }); setConsent(false); setNotice('Private account backup saved. Local records and original scans are unchanged.'); })}>Save private account backup</button>
          <button className="button button-secondary" disabled={busy || !!issuedRecovery} onClick={() => void run(async () => { setVault(await accountRequest<AccountVaultSummary>('/vault')); setConsent(false); setNotice('Current account version loaded. Review it before deciding whether your local records should replace it.'); })}>Reload account version</button>
          <button className="button button-secondary" disabled={busy || !vault?.hasBackup || !!issuedRecovery} onClick={() => void run(() => downloadBackup())}>Download account backup</button><button className="button button-secondary" disabled={busy || !vault?.hasBackup || !!issuedRecovery} onClick={() => void run(() => downloadBackup(true))}>Restore account backup on this device</button>
        </div><p>Restore replaces packing records in the current device workspace after confirmation. Other protected workspaces stay intact. Original scan files are absent from account backups. Signing out locks an opened protected workspace. Guest records remain visible; use the local data controls below to remove those records.</p>
      </div>
      <details className="account-security"><summary>Account security and deletion</summary><div className="account-actions"><button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { const exported = await accountRequest<unknown>('/export'); const saved = await download('packing-account-export.json', exported); setNotice(saved ? 'Account export downloaded. It contains private records and audit history.' : 'Account export cancelled.'); })}>Download account export</button><button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { await accountRequest('/sessions', 'DELETE', undefined, account.csrf); setNotice('Other account sessions were revoked. Their downloaded copies cannot be recalled.'); })}>Sign out other devices</button></div>
        <label className="field"><span>Current account password</span><input type="password" autoComplete="current-password" value={secret} onChange={e => setSecret(e.target.value)}/></label><label className="field"><span>New password for this account</span><input type="password" autoComplete="new-password" minLength={15} maxLength={128} value={newSecret} onChange={e => setNewSecret(e.target.value)}/></label><label className="field"><span>Repeat changed password</span><input type="password" autoComplete="new-password" minLength={15} maxLength={128} value={repeatSecret} onChange={e => setRepeatSecret(e.target.value)}/></label>
        <button className="button button-secondary" disabled={busy || !secret || !newSecret || !!issuedRecovery} onClick={() => void run(async () => { if (newSecret !== repeatSecret) throw new Error('The new passwords do not match.'); await authenticated(await accountRequest<AccountAuthResult>('/password', 'POST', { currentPassword: secret, newPassword: newSecret }, account.csrf)); setNotice('Password changed. Previous sessions and recovery code were revoked. Save the new recovery code.'); })}>Change account password</button>
        <label className="account-check"><input type="checkbox" checked={deleteConsent} disabled={busy} onChange={e => setDeleteConsent(e.target.checked)}/><span>Delete my account, its current server backup, sole-owned households and audit records. Locally saved or previously downloaded copies remain.</span></label><button className="button danger-button" disabled={busy || !deleteConsent || !secret} onClick={() => void run(async () => { if (!window.confirm('Delete this account, its current server backup and any households where you are the only member? Transfer or delete households with other members first. Download an export and any shared packs you need. Local and downloaded copies remain.')) return; await accountRequest('', 'DELETE', { password: secret, confirm: true }, account.csrf); setAccount(current => ({ ...current, profile: null, csrf: null })); setVault(undefined); setIssuedRecovery(''); setDeleteConsent(false); clearSecrets(); setNotice('Account and current server records deleted. Local packing records remain.'); device.accountEnded(); })}>Delete my account</button>
      </details>
      <button className="button button-secondary" disabled={busy} onClick={() => void run(async () => { let confirmed=false;try {await accountRequest('/session', 'DELETE', undefined, account.csrf);confirmed=true;} finally {device.accountEnded(confirmed?undefined:'Protected workspace locked. Server sign-out was not confirmed. Reconnect, unlock this workspace and sign out again.');} setAccount(current => ({ ...current, profile: null, csrf: null })); setVault(undefined); setIssuedRecovery(''); setDeleteConsent(false); clearSecrets(); setNotice('Signed out. Locally saved packing records remain on this device.'); })}>Sign out of my account</button>
      {!issuedRecovery && account.csrf && <HouseholdPanel key={`household:${account.profile.id}`} data={data} profile={account.profile} csrf={account.csrf} onOpen={onOpenShared} onPublished={onPublished} onExpired={() => {setAccount(current=>({...current,profile:null,csrf:null}));setVault(undefined);setIssuedRecovery('');clearSecrets();setNotice('Sign in to use this account.');device.accountEnded();}}/>}
    </>}
    {native && serviceOrigin && <div className="account-actions">{!account.available && <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void run(async () => { const result = await accountRequest<PackingAccountState>('/session'); if (result.profile && !device.accountKnown(result.profile.id)) return; const summary = result.profile ? await accountRequest<AccountVaultSummary>('/vault') : undefined; setAccount(result); setVault(summary); setNotice(result.available ? 'Account connection checked.' : 'Accounts are disabled on this server.'); })}>Check account connection</button>}<p>If server sign-out cannot be confirmed, forgetting this device sign-in removes its saved session locally. The server session remains until revoked or expired. Guest packing records stay visible.</p><button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void run(async () => { await forgetNativeAccount(); device.accountEnded('Device sign-in forgotten. Your protected workspace is locked; guest copies remain visible.'); setAccount(current => ({ ...current, profile: null, csrf: null })); setVault(undefined); setIssuedRecovery(''); setDeleteConsent(false); clearSecrets(); setNotice('Device sign-in forgotten. Server revocation was not requested. Guest packing records remain visible.'); })}>Forget this device sign-in</button></div>}
    {busy && <p role="status">Working on your account request…</p>}{notice && <p role="status" className="account-notice">{notice}</p>}
  </section>;
}
