import { useState } from 'react';
import type { PackingAccountProfile } from '../account-client';
import type { AppData } from '../types';
import { useDeviceWorkspace } from './DeviceWorkspace';

export function DeviceWorkspaceSetup({profile,data}:{profile:PackingAccountProfile;data:AppData}){
  const device=useDeviceWorkspace(),[label,setLabel]=useState(profile.name),[password,setPassword]=useState(''),[repeat,setRepeat]=useState(''),[copy,setCopy]=useState(false),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  if(!device.protectionSupported||device.session)return null;
  return <details className="device-setup"><summary>Protect this account’s packs on this device</summary><p>Create a separate encrypted workspace for {profile.username}. It locks on reload, when this page is hidden, after five minutes without interaction, and when signing out. Nothing uploads. Your existing guest packs stay unchanged and visible.</p>
    <form className="account-form" onSubmit={event=>{event.preventDefault();setNotice('');if(password!==repeat){setNotice('The device passphrases do not match.');return;}setBusy(true);void device.create(profile,label,password,data,copy).catch(error=>setNotice(error instanceof Error?error.message:'The device workspace could not be created.')).finally(()=>{setPassword('');setRepeat('');setConsent(false);setBusy(false);});}}>
      <label className="field"><span>Device workspace label</span><input required maxLength={70} value={label} onChange={event=>setLabel(event.target.value)}/></label>
      <label className="field"><span>New device passphrase</span><input type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>
      <label className="field"><span>Repeat device passphrase</span><input type="password" required minLength={15} maxLength={128} autoComplete="new-password" value={repeat} onChange={event=>setRepeat(event.target.value)}/></label>
      <label className="account-check"><input type="checkbox" checked={copy} onChange={event=>setCopy(event.target.checked)}/><span>Copy these {data.trips.length} guest packs, their library and reference photos into this protected workspace. Original guest copies stay visible; original native scan links are excluded.</span></label>
      <label className="account-check"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/><span>I saved this separate device passphrase safely. Losing it can make these local records unrecoverable. The device label and account identifier remain visible in storage.</span></label>
      <button className="button button-primary" disabled={busy||!consent}>Create protected device workspace</button>
    </form>{notice&&<p role="status" className="account-notice">{notice}</p>}
  </details>;
}

export function DeviceWorkspaceSettings(){
  const device=useDeviceWorkspace(),[current,setCurrent]=useState(''),[next,setNext]=useState(''),[repeat,setRepeat]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  if(!device.protectionSupported)return null;
  const session=device.session;
  return <section className="settings-section device-settings" aria-label="Device workspace"><h2>Device workspace</h2><p>{session?`Protected workspace: ${session.descriptor.label}. Its records and photos are encrypted on this device.`:'Guest packs use the original, unprotected local store. Sign in and create a protected account workspace to separate private packing work.'}</p><div className="account-actions"><button className="button button-secondary" onClick={()=>void device.choose()}>Choose saved device workspace</button>{session&&<button className="button button-secondary" onClick={device.lock}>Lock this workspace</button>}</div>
    {session&&<details><summary>Device passphrase and local removal</summary><p>Changing this passphrase does not change your server password. A downloaded ordinary packing backup is unencrypted; keep it private. Removing this workspace does not delete guest packs, other workspaces, your account or server records.</p>
      <label className="field"><span>Current device passphrase</span><input type="password" autoComplete="off" value={current} onChange={event=>setCurrent(event.target.value)}/></label><label className="field"><span>Changed device passphrase</span><input type="password" minLength={15} maxLength={128} autoComplete="new-password" value={next} onChange={event=>setNext(event.target.value)}/></label><label className="field"><span>Repeat changed device passphrase</span><input type="password" minLength={15} maxLength={128} autoComplete="new-password" value={repeat} onChange={event=>setRepeat(event.target.value)}/></label>
      <div className="account-actions"><button className="button button-secondary" disabled={busy||!current||!next} onClick={()=>{if(next!==repeat){setNotice('The device passphrases do not match.');return;}setBusy(true);void session.changePassphrase(current,next).then(()=>setNotice('Device passphrase changed. The old passphrase no longer opens this stored workspace.')).catch(error=>setNotice(error instanceof Error?error.message:'The change failed.')).finally(()=>{setCurrent('');setNext('');setRepeat('');setBusy(false);});}}>Change device passphrase</button><button className="button danger-button" disabled={busy||!current} onClick={()=>{if(!window.confirm(`Remove the protected workspace “${session.descriptor.label}” and all its local packs and photos? Save a private backup first. Other workspaces and server records remain.`))return;setBusy(true);void session.remove(current).then(()=>device.choose()).catch(error=>setNotice(error instanceof Error?error.message:'The workspace could not be removed.')).finally(()=>{setCurrent('');setBusy(false);});}}>Remove this protected workspace</button></div>
    </details>}{notice&&<p role="status" className="account-notice">{notice}</p>}
  </section>;
}
