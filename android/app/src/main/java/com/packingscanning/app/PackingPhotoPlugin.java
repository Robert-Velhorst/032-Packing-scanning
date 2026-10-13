package com.packingscanning.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.packingscanning.app.files.*;
import com.packingscanning.app.scanning.*;
import java.io.*;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

@CapacitorPlugin(name="PackingPhoto",permissions={@Permission(alias="camera",strings={Manifest.permission.CAMERA})})
public final class PackingPhotoPlugin extends Plugin {
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean selecting=new AtomicBoolean();private final AtomicInteger queued=new AtomicInteger();
    private PendingItemPhotoStore store;private volatile boolean closed;
    @Override public void load(){try{store=ItemPhotoRuntime.store(getContext().getCacheDir());}catch(IOException ignored){store=null;}}
    private CaptureScopeManager.Access access(PluginCall call)throws IOException{return CaptureRuntime.manager(getContext().getFilesDir()).access(call.getString("lease"));}
    private static PendingBackupStore.Scope scope(CaptureScopeManager.Access access)throws IOException{access.check();return new PendingBackupStore.Scope(access.workspaceId(),access.accountId());}
    @PluginMethod public void pickItemPhoto(PluginCall call){
        if(store==null||closed){call.reject("Native item photos are unavailable.","photo_unavailable");return;}
        if(!selecting.compareAndSet(false,true)){call.reject("Finish the current photo selection.","photo_busy");return;}
        try{CaptureScopeManager.Access access=access(call);PendingBackupStore.Scope target=scope(access);String draft=call.getString("draftJson"),source=call.getString("source");call.getData().remove("draftJson");
            if(!"camera".equals(source)&&!"library".equals(source))throw new IOException();
            worker.execute(()->{try{access.check();PendingItemPhotoStore.Receipt receipt=store.prepare(target,draft);call.getData().put("photoRequest",receipt.ticket);access.check();
                getActivity().runOnUiThread(()->{try{if(closed||getActivity().isFinishing())throw new IOException();
                    if("camera".equals(source)&&getPermissionState("camera")!=PermissionState.GRANTED)requestPermissionForAlias("camera",call,"cameraPermission");else launch(call);
                }catch(Exception error){preserve(call,"The photo screen could not open. Your encrypted draft can be resumed.");}});
            }catch(Exception error){if(call.getString("photoRequest")!=null){preserve(call,"The workspace locked while preparing the photo. Your encrypted draft can be resumed.");return;}selecting.set(false);call.reject("The photo draft could not be prepared. Resume or discard an earlier selection, or unlock this workspace again.","photo_failed");}});
        }catch(Exception error){selecting.set(false);call.reject("Unlock the selected workspace before adding a photo.","photo_locked");}
    }
    @PermissionCallback private void cameraPermission(PluginCall call){if(getPermissionState("camera")==PermissionState.GRANTED)launch(call);else preserve(call,"Camera permission was not granted. Your encrypted draft can be resumed.");}
    private void launch(PluginCall call){
        try{store.checkRequest(call.getString("photoRequest"));if(closed||getActivity().isFinishing())throw new IOException();
            Intent intent;if("camera".equals(call.getString("source")))intent=new Intent(getContext(),ReferencePhotoActivity.class).putExtra("photoRequest",call.getString("photoRequest"));
            else intent=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
            startActivityForResult(call,intent,"photoChosen");
        }catch(Exception error){preserve(call,"The photo screen could not open. Your encrypted draft can be resumed.");}
    }
    @ActivityCallback private void photoChosen(PluginCall call,ActivityResult result){
        if(call==null){selecting.set(false);return;}
        if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null){preserve(call,"Photo selection cancelled. Your encrypted item draft can be resumed.");return;}
        if(!enqueue(call,()->{try{String request=call.getString("photoRequest");PendingItemPhotoStore.Receipt receipt;
            if("camera".equals(call.getString("source")))receipt=store.result(request,result.getData().getStringExtra("photoTicket"));
            else{Uri uri=result.getData().getData();if(uri==null||!"content".equals(uri.getScheme()))throw new IOException();try(InputStream input=getContext().getContentResolver().openInputStream(uri)){if(input==null)throw new IOException();receipt=store.complete(request,input);}}
            resolve(call,receipt,"Photo ready. Unlock its original workspace and resume the item draft; saving is still your choice.");
        }catch(Exception error){preserve(call,"The selected photo could not be opened. Your encrypted item draft can be resumed; choose a JPEG, PNG, GIF or WebP under 12 MB.");}finally{selecting.set(false);}}))selecting.set(false);
    }
    private void preserve(PluginCall call,String message){if(!enqueue(call,()->{try{PendingItemPhotoStore.Receipt receipt=store.cancelled(call.getString("photoRequest"));resolve(call,receipt,receipt.selected?"Photo ready. Resume its encrypted item draft after unlocking.":message);}catch(IOException error){call.reject("The photo draft expired or the native process restarted. Saved packing records have not changed.","photo_expired");}finally{selecting.set(false);}}))selecting.set(false);}
    private void resolve(PluginCall call,PendingItemPhotoStore.Receipt receipt,String message){if(closed){call.reject("Native photo access closed; reopen the app.","photo_unavailable");return;}JSObject value=new JSObject();value.put("ticket",receipt.ticket);value.put("target",receipt.target);value.put("selected",receipt.selected);value.put("notice",message);call.resolve(value);}
    @PluginMethod public void readItemPhoto(PluginCall call){
        try{CaptureScopeManager.Access access=access(call);PendingBackupStore.Scope target=scope(access);enqueue(call,()->{byte[] photo=null;try{access.check();try(PendingItemPhotoStore.Content content=store.read(call.getString("ticket"),target)){
                JSObject value=new JSObject();value.put("draftJson",content.draftJson);if(content.photo.length>0){photo=ReferencePhotoDecoder.jpeg(content.photo);value.put("dataUrl","data:image/jpeg;base64,"+Base64.encodeToString(photo,Base64.NO_WRAP));}access.check();if(closed)throw new IOException();call.resolve(value);
            }}catch(Exception error){call.reject("Unlock the original workspace to resume this draft. If the photo cannot be decoded or the draft expired, discard it and choose a supported photo again.","photo_locked");}finally{if(photo!=null)Arrays.fill(photo,(byte)0);}});
        }catch(Exception error){call.reject("Unlock the workspace that selected this photo draft first.","photo_locked");}
    }
    @PluginMethod public void discardItemPhoto(PluginCall call){enqueue(call,()->{try{store.discard(call.getString("ticket"));call.resolve();}catch(Exception error){call.reject("The encrypted photo draft could not be discarded.","photo_failed");}});}
    private boolean enqueue(PluginCall call,Runnable job){
        if(store==null||closed){call.reject("Native photo access is unavailable.","photo_unavailable");return false;}
        if(queued.incrementAndGet()>4){queued.decrementAndGet();call.reject("Wait for the current photo operation.","photo_busy");return false;}
        try{worker.execute(()->{try{if(closed){selecting.set(false);call.reject("Photo access closed.","photo_unavailable");}else job.run();}finally{queued.decrementAndGet();}});return true;}
        catch(RejectedExecutionException error){queued.decrementAndGet();call.reject("Photo access closed.","photo_unavailable");return false;}
    }
    @Override protected void handleOnDestroy(){closed=true;worker.shutdown();super.handleOnDestroy();}
}
