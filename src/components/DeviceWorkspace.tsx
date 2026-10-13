import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {Capacitor} from '@capacitor/core';
import {accountRequest,type PackingAccountState,type PackingAccountProfile} from '../account-client';
import {createWorkspace,emptyWorkspace,listWorkspaces,unlockWorkspace,type AttachWorkspace,type ProtectedSession,type WorkspaceDescriptor} from '../protected-storage';
import {captureClient,getCaptureStorageState,lockCaptureStorage,openCaptureWorkspace,onCaptureWorkspaceLocked,selectGuestCaptureStorage,type CaptureClient,type CaptureStorageState} from '../scanning/native';
import {workspaceStorage} from '../storage';
import type {AppData} from '../types';
import {nativeBackupFilesAvailable,pickNativeBackup,saveNativeBackup,readNativeBackup,discardNativeBackup,type BackupSelection} from '../native-files';
import {nativeItemPhotosAvailable,pickNativeItemPhoto,readNativeItemPhoto,discardNativeItemPhoto,type ItemPhotoSelection} from '../native-item-photo';
import type {ItemEditorDraft} from '../item-photo-draft';

interface DeviceControls {
  session?:ProtectedSession;
  native:boolean;
  protectionSupported:boolean;
  capture:CaptureClient;
  filesSupported:boolean;
  fileBusy:boolean;
  fileNotice:string;
  pendingBackup?:BackupSelection;
  backupMatches:boolean;
  pickBackup:()=>Promise<void>;
  saveBackup:(text:string)=>Promise<void>;
  reviewBackup:()=>Promise<File>;
  discardBackup:(restored?:boolean)=>Promise<void>;
  checkActive:()=>void;
  confirmInteraction:()=>Promise<void>;
  photosSupported:boolean;
  photoNotice:string;
  pendingPhoto?:ItemPhotoSelection;
  photoMatches:boolean;
  pickItemPhoto:(draft:ItemEditorDraft,source:'camera'|'library')=>Promise<boolean>;
  resumeItemPhoto:()=>Promise<{draft:ItemEditorDraft;photo?:Blob}>;
  discardItemPhoto:(saved?:boolean)=>Promise<void>;
  lock:()=>void;
  choose:()=>Promise<void>;
  accountKnown:(id:string,announce?:boolean)=>boolean;
  accountEnded:(notice?:string)=>void;
  create:(profile:PackingAccountProfile,label:string,passphrase:string,data:AppData,copy:boolean)=>Promise<void>;
}
const DeviceContext=createContext<DeviceControls|null>(null);
export function useDeviceWorkspace(){const value=useContext(DeviceContext);if(!value)throw new Error('Device workspace context is missing.');return value;}
export function DeviceWorkspace({children}:{children:ReactNode}){
  const [mode,setMode]=useState<'boot'|'guest'|'locked'|'open'>('boot'),[session,setSession]=useState<ProtectedSession>();
  const [workspaces,setWorkspaces]=useState<WorkspaceDescriptor[]>([]),[selected,setSelected]=useState(''),[passphrase,setPassphrase]=useState('');
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [captureLease,setCaptureLease]=useState<string>(),[nativeProtection,setNativeProtection]=useState(false);
  const [pendingBackup,setPendingBackup]=useState<BackupSelection>(),[fileBusy,setFileBusy]=useState(false),[fileNotice,setFileNotice]=useState('');
  const pendingRef=useRef<BackupSelection|undefined>(undefined),fileOperation=useRef(false);
  const filesSupported=nativeProtection&&nativeBackupFilesAvailable();
  const [pendingPhoto,setPendingPhoto]=useState<ItemPhotoSelection>(),[photoNotice,setPhotoNotice]=useState('');
  const photoRef=useRef<ItemPhotoSelection|undefined>(undefined);
  const photosSupported=nativeProtection&&nativeItemPhotosAvailable();
  const captureState=useRef<CaptureStorageState|undefined>(undefined);
  const nativeHandshake=useRef(false);
  const capture=useMemo(()=>captureClient(captureLease),[captureLease,session,mode]);
  const captureRef=useRef(capture);captureRef.current=capture;
  const active=useRef<ProtectedSession|undefined>(undefined),generation=useRef(0),channel=useRef<BroadcastChannel|undefined>(undefined);
  const renewInteraction=useRef<(()=>Promise<void>)|undefined>(undefined);
  const native=Capacitor.isNativePlatform();
  const close=useCallback((announce=true)=>{const current=active.current;active.current=undefined;captureRef.current.revoke();current?.close();const epoch=++generation.current;
    const state=captureState.current;if(state)void lockCaptureStorage(state.revision).then(next=>{if(epoch===generation.current)captureState.current=next;}).catch(()=>{if(epoch===generation.current)setNotice('The workspace is hidden, but native capture locking could not be confirmed. Reload before unlocking again.');});
    setSession(undefined);setCaptureLease(undefined);setPassphrase('');setMode('locked');if(announce&&current)channel.current?.postMessage({type:'lock',id:current.descriptor.id});},[]);
  const choose=useCallback(async()=>{close();try{if(native){let state=await getCaptureStorageState();if(state){state=await lockCaptureStorage(state.revision);captureState.current=state;setNativeProtection(true);}nativeHandshake.current=true;if(!state){setWorkspaces([]);setNotice('Protected workspaces are unavailable in this native installation. You can choose guest packs.');return;}}const list=await listWorkspaces();setWorkspaces(list);setSelected(current=>list.some(w=>w.id===current)?current:list[0]?.id??'');}catch{setNotice('Saved workspace information could not be opened. Your records have not been replaced.');}},[close,native]);
  useEffect(()=>{
    let mounted=true;
    void (async()=>{
      let state=await getCaptureStorageState();if(!mounted)return;
      if(state){state=await lockCaptureStorage(state.revision);if(!mounted)return;captureState.current=state;setNativeProtection(true);}
      nativeHandshake.current=true;
      if(native&&!state){setMode('guest');return;}
      const list=await listWorkspaces();if(!mounted)return;setWorkspaces(list);setSelected(list[0]?.id??'');
      if(!list.length&&state){const guest=await selectGuestCaptureStorage(state.revision);if(!mounted){void lockCaptureStorage(guest.revision);return;}captureState.current=guest;setCaptureLease(guest.lease??undefined);}
      setMode(list.length?'locked':'guest');
    })().catch(()=>{if(mounted){setMode('locked');setNotice('Saved workspace or native storage information could not be opened. Reload before continuing.');}});
    if(typeof BroadcastChannel!=='undefined'){
      const messages=new BroadcastChannel('packing-scanning-device-v1');channel.current=messages;
      messages.onmessage=event=>{const message=event.data as {type?:unknown;id?:unknown};const current=active.current;if(current&&(message?.type==='lock'&&message.id===current.descriptor.id||message?.type==='account'&&message.id!==current.descriptor.accountId))close(false);};
    }
    return()=>{mounted=false;captureRef.current.revoke();active.current?.close();active.current=undefined;const state=captureState.current;if(state)void lockCaptureStorage(state.revision).catch(()=>undefined);generation.current++;channel.current?.close();channel.current=undefined;};
  },[native,close]);
  useEffect(()=>{
    if(!session)return;
    let last=Date.now(),checking=false,alive=true;const verify=async()=>{if(!nativeProtection||checking)return;checking=true;try{const state=await getCaptureStorageState();if(!alive)return;if(state?.lease!==session.attachment?.captureLease)close();else if(!document.hidden)last=Date.now();}catch{if(alive)close();}finally{checking=false;}};
    const renew=async()=>{
      if(!alive||active.current!==session||document.hidden||Date.now()-last>=5*60*1000){
        if(alive&&active.current===session)close();
        throw new Error('The packing workspace is locked or no longer active.');
      }
      last=Date.now();
      try{if(nativeProtection)await capture.touch();}
      catch(error){if(alive&&active.current===session)close();throw error;}
      if(!alive||active.current!==session||document.hidden)throw new Error('The packing workspace changed before the command could run.');
    };
    renewInteraction.current=renew;
    const activity=()=>{void renew().catch(()=>undefined);};const hidden=()=>{if(document.hidden){if(!nativeProtection||!capture.isCapturing())close();}else void verify();};const leaving=()=>close();
    const interval=setInterval(()=>{if(capture.isCapturing())return;if(Date.now()-last>=5*60*1000)close();},1000);
    for(const type of ['pointerdown','keydown','touchstart'])window.addEventListener(type,activity,{passive:true});
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',leaving);
    let listener:Awaited<ReturnType<typeof onCaptureWorkspaceLocked>>|undefined;if(nativeProtection)void onCaptureWorkspaceLocked(event=>{if(alive&&event.lease===session.attachment?.captureLease)close(false);}).then(value=>{if(alive)listener=value;else void value.remove();}).catch(()=>{if(alive)close();});
    return()=>{alive=false;if(renewInteraction.current===renew)renewInteraction.current=undefined;void listener?.remove();clearInterval(interval);for(const type of ['pointerdown','keydown','touchstart'])window.removeEventListener(type,activity);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',leaving);};
  },[session,close,nativeProtection,capture]);
  const activate=(opened:ProtectedSession)=>{if(document.hidden){opened.close();close();return;}active.current=opened;setSession(opened);setCaptureLease(opened.attachment?.captureLease);setMode('open');setNotice('');};
  const refreshCapture=async()=>{if(native&&!nativeHandshake.current)throw new Error('Native capture storage has not been verified. Reload saved workspaces before continuing.');if(!nativeProtection)return;const state=await getCaptureStorageState();if(!state)throw new Error('Native protection is unavailable. Reload the app.');captureState.current=state;};
  const attachFor=(epoch:number):AttachWorkspace|undefined=>nativeProtection?async(descriptor,raw)=>{
    if(epoch!==generation.current||document.hidden)throw new Error('The workspace selection changed before unlocking.');const revision=captureState.current?.revision;if(!revision)throw new Error('Reload native capture storage first.');
    const state=await openCaptureWorkspace(revision,descriptor.id,descriptor.accountId,raw);if(!state.lease||!state.protectedWorkspace)throw new Error('The protected capture workspace was not selected.');
    if(epoch!==generation.current||document.hidden){await lockCaptureStorage(state.revision);throw new Error('The workspace selection changed before unlocking.');}
    captureState.current=state;const client=captureClient(state.lease);
    return {captureLease:state.lease,close:()=>{client.revoke();void lockCaptureStorage(state.revision).catch(()=>undefined);},clearCaptures:()=>client.clearScanCaptures()};
  }:undefined;
  const useGuest=async()=>{const epoch=++generation.current;setBusy(true);setNotice('');try{await refreshCapture();if(epoch!==generation.current)return;if(nativeProtection){const state=await selectGuestCaptureStorage(captureState.current!.revision);if(epoch!==generation.current){await lockCaptureStorage(state.revision);return;}captureState.current=state;setCaptureLease(state.lease??undefined);}setPassphrase('');setMode('guest');}catch(error){setNotice(error instanceof Error?error.message:'Guest storage could not be selected.');}finally{setBusy(false);}};
  const accountKnown=(id:string,announce=false)=>{if(announce)channel.current?.postMessage({type:'account',id});if(active.current&&active.current.descriptor.accountId!==id){close();setNotice('The signed-in account changed. Unlock its separate device workspace or use guest packs.');return false;}return true;};
  const accountEnded=(message?:string)=>{channel.current?.postMessage({type:'account',id:null});if(active.current){close();setNotice(message??'Your protected workspace is locked. The device passphrase can open its offline copy.');}};
  const create=async(profile:PackingAccountProfile,label:string,password:string,data:AppData,copy:boolean)=>{
    if(native&&!nativeProtection||active.current)throw new Error('This installation cannot create another protected workspace from here.');
    const current=await accountRequest<PackingAccountState>('/session');if(current.profile?.id!==profile.id)throw new Error('Sign in to this account again before creating its device workspace.');
    const epoch=generation.current;await refreshCapture();const guest=workspaceStorage(),photos=copy?await guest.photoRecords():[];
    let opened:ProtectedSession;try{opened=await createWorkspace(profile.id,label,password,copy?data:emptyWorkspace(data),photos,attachFor(epoch));}catch(error){await choose();throw error;}
    if(epoch!==generation.current){opened.close();return;}setWorkspaces(await listWorkspaces());setSelected(opened.descriptor.id);activate(opened);
  };
  const target=session?.descriptor.id??'guest';
  const backupMatches=pendingBackup?.target===target;
  const fileJob=async(job:()=>Promise<void>)=>{if(fileOperation.current)return;fileOperation.current=true;setFileBusy(true);setFileNotice('');try{await job();}catch(error){setFileNotice(error instanceof Error?error.message:'The backup operation was not confirmed. Packing records have not changed.');}finally{fileOperation.current=false;setFileBusy(false);}};
  const discardBackup=async(restored=false)=>{const current=pendingRef.current;if(!current)return;await discardNativeBackup(current);if(pendingRef.current?.ticket===current.ticket){pendingRef.current=undefined;setPendingBackup(undefined);setFileNotice(restored?'Selected backup cleared after restore.':'Selected backup discarded. Packing records have not changed.');}};
  const pickBackup=()=>fileJob(async()=>{if(pendingRef.current)throw new Error('Review or discard the selected backup before choosing another file.');const picked=await pickNativeBackup(captureLease);if(picked){pendingRef.current=picked;setPendingBackup(picked);setFileNotice('Backup selected. Open the workspace that selected it, then use Settings to review and confirm the restore.');}else setFileNotice('File selection cancelled. Packing records have not changed.');});
  const saveBackup=(text:string)=>fileJob(async()=>{const saved=await saveNativeBackup(text,captureLease);setFileNotice(saved?'Backup saved to the selected provider. The file is unencrypted and may include personal photos; keep it private.':'Backup saving cancelled.');});
  const reviewBackup=async()=>{const current=pendingRef.current;if(!current||current.target!==target)throw new Error('Open the workspace that selected this backup first.');const epoch=generation.current;const file=await readNativeBackup(current,captureLease);if(epoch!==generation.current||active.current!==session||document.hidden)throw new Error('The workspace locked before backup review. Unlock it again.');return file;};
  const controlsEpoch=generation.current;
  const checkActive=()=>{if(controlsEpoch!==generation.current||active.current!==session||document.hidden&&!!session)throw new Error('The workspace locked or changed before the backup operation finished. Open it again before retrying.');};
  const confirmInteraction=async()=>{
    checkActive();if(document.hidden)throw new Error('Voice commands require the visible packing screen.');
    const renew=renewInteraction.current;
    if(session&&!renew)throw new Error('The packing workspace is not ready for a voice command.');
    if(renew)await renew();
    checkActive();if(document.hidden)throw new Error('The packing screen became hidden before the command could run.');
  };
  const photoMatches=pendingPhoto?.target===target;
  const pickItemPhoto=async(draft:ItemEditorDraft,source:'camera'|'library')=>{if(fileOperation.current)return false;if(photoRef.current){setPhotoNotice('Resume or discard the pending item photo draft before selecting another photo.');return false;}fileOperation.current=true;setFileBusy(true);setPhotoNotice('');try{const picked=await pickNativeItemPhoto(draft,source,captureLease);photoRef.current=picked;setPendingPhoto(picked);setPhotoNotice(picked.notice);return true;}catch(error){setPhotoNotice(error instanceof Error?error.message:'The photo selection was not confirmed.');return false;}finally{fileOperation.current=false;setFileBusy(false);}};
  const resumeItemPhoto=async()=>{const selection=photoRef.current;if(!selection||selection.target!==target)throw new Error('Open the workspace that prepared this item photo draft first.');const epoch=generation.current;const result=await readNativeItemPhoto(selection,captureLease);if(epoch!==generation.current||active.current!==session||document.hidden)throw new Error('The workspace locked before its photo draft could be resumed.');return result;};
  const discardItemPhoto=async(saved=false)=>{const selection=photoRef.current;if(!selection)return;await discardNativeItemPhoto(selection);if(photoRef.current?.ticket===selection.ticket){photoRef.current=undefined;setPendingPhoto(undefined);setPhotoNotice(saved?'Encrypted photo draft cleared after saving the item.':'Encrypted photo draft discarded. Saved packing records have not changed.');}};
  const controls:DeviceControls={session,native,protectionSupported:!native||nativeProtection,capture,filesSupported,fileBusy,fileNotice,pendingBackup,backupMatches,pickBackup,saveBackup,reviewBackup,discardBackup,checkActive,confirmInteraction,photosSupported,photoNotice,pendingPhoto,photoMatches,pickItemPhoto,resumeItemPhoto,discardItemPhoto,lock:()=>close(),choose,accountKnown,accountEnded,create};
  if(mode==='boot')return <div className="boot-screen"><div className="brand-mark">P</div><p>Checking your saved packing spaces…</p></div>;
  if(mode==='locked')return <main className="device-lock" aria-label="Locked device workspace"><div className="brand-mark">P</div><p className="eyebrow">SAVED ON THIS DEVICE</p><h1>Protected packing space</h1><p>Use its device passphrase to open saved packs and photos, including offline. Signing in to the server does not unlock them.</p>
    {!!workspaces.length&&<form className="account-form" onSubmit={event=>{event.preventDefault();const epoch=generation.current;setBusy(true);setNotice('');void refreshCapture().then(()=>unlockWorkspace(selected,passphrase,attachFor(epoch))).then(opened=>{if(epoch===generation.current)activate(opened);else opened.close();}).catch(error=>{if(epoch===generation.current)setNotice(error instanceof Error?error.message:'The workspace could not be opened.');}).finally(()=>{setPassphrase('');setBusy(false);});}}><label className="field"><span>Saved device workspace</span><select aria-label="Saved device workspace" value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setPassphrase('');}}>{workspaces.map(workspace=><option value={workspace.id} key={workspace.id}>{workspace.label}</option>)}</select></label><label className="field"><span>Device passphrase</span><input type="password" required minLength={15} maxLength={128} autoComplete="off" disabled={busy} value={passphrase} onChange={event=>setPassphrase(event.target.value)}/></label><button className="button button-primary" disabled={busy}>Unlock saved workspace</button></form>}
    <div className="account-actions"><button className="button button-secondary" disabled={busy} onClick={()=>void choose()}>Reload saved workspaces</button><button className="button button-secondary" disabled={busy} onClick={()=>void useGuest()}>Use guest packs</button></div>
    {pendingBackup&&<section aria-label="Selected backup"><p>A backup is waiting for review. {pendingBackup.target==='guest'?'Choose guest packs':'Unlock the same protected workspace that selected it'}, then open Settings. Temporary selections expire after ten minutes and are lost when the native process restarts.</p><button className="button button-secondary" disabled={fileBusy} onClick={()=>void fileJob(discardBackup)}>Discard selected backup</button></section>}
    {fileNotice&&<p role="status" className="account-notice">{fileNotice}</p>}
    {pendingPhoto&&<section aria-label="Pending item photo"><p>Your item draft {pendingPhoto.selected?'and selected photo are':'is'} held encrypted for its original workspace. {pendingPhoto.target==='guest'?'Choose guest packs':'Unlock that protected workspace'}, then use Resume item photo draft. Nothing has been saved to the item library. The draft expires after ten minutes or native process restart.</p><button className="button button-secondary" disabled={fileBusy} onClick={()=>void discardItemPhoto().catch(error=>setPhotoNotice(error instanceof Error?error.message:'Discard failed.'))}>Discard item photo draft</button></section>}
    {photoNotice&&<p role="status" className="account-notice">{photoNotice}</p>}
    <p>Guest packs are separate and stay visible to anyone using this {native?'device':'browser'}. Device labels are visible while locked. Keep your passphrase safely: account recovery cannot recover it. Locking hides this workspace and forgets its key; it does not sign out the server account.</p>{notice&&<p role="status" className="account-notice">{notice}</p>}
  </main>;
  return <DeviceContext.Provider key={session?.descriptor.id??'guest'} value={controls}>{children}</DeviceContext.Provider>;
}

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
