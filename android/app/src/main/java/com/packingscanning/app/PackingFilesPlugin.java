package com.packingscanning.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.packingscanning.app.files.PendingBackupStore;
import com.packingscanning.app.scanning.CaptureRuntime;
import com.packingscanning.app.scanning.CaptureScopeManager;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Explicit system document dialogs. Picking a file never relaxes the workspace lifecycle lock. */
@CapacitorPlugin(name="PackingFiles")
public final class PackingFilesPlugin extends Plugin {
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private final AtomicInteger queued=new AtomicInteger();
    private PendingBackupStore store;
    private PendingBackupStore.Scope selecting;
    private String exporting;
    private volatile boolean closed;
    @Override public void load(){
        try{store=new PendingBackupStore(getContext().getCacheDir());worker.scheduleWithFixedDelay(()->{try{store.expire();}catch(IOException ignored){}},1,1,TimeUnit.MINUTES);}catch(IOException ignored){store=null;}
    }
    private CaptureScopeManager.Access access(PluginCall call)throws IOException{return CaptureRuntime.manager(getContext().getFilesDir()).access(call.getString("lease"));}
    private static PendingBackupStore.Scope scope(CaptureScopeManager.Access access)throws IOException{access.check();return new PendingBackupStore.Scope(access.workspaceId(),access.accountId());}
    @PluginMethod public void pickBackup(PluginCall call){begin(call,false);}
    @PluginMethod public void saveBackup(PluginCall call){begin(call,true);}
    private void begin(PluginCall call,boolean saving){
        if(store==null||closed){call.reject("Native backup storage is unavailable.","backup_unavailable");return;}
        if(!busy.compareAndSet(false,true)){call.reject("Finish the current backup operation first.","backup_busy");return;}
        try{
            CaptureScopeManager.Access access=access(call);PendingBackupStore.Scope target=scope(access);
            String text=saving?call.getString("text"):null;call.getData().remove("text");
            if(saving&&(text==null||text.length()>PendingBackupStore.MAX_BYTES))throw new IOException("Choose a packing backup under 80 MB.");
            worker.execute(()->{
                try{
                    if(saving){byte[] bytes=text.getBytes(StandardCharsets.UTF_8);try{exporting=store.stage(target,new ByteArrayInputStream(bytes)).ticket;}finally{Arrays.fill(bytes,(byte)0);}}
                    access.check();if(closed)throw new IOException();
                    getActivity().runOnUiThread(()->{
                        try{
                            access.check();if(closed||getActivity().isFinishing()||getActivity().isDestroyed())throw new IOException();
                            selecting=target;Intent intent=new Intent(saving?Intent.ACTION_CREATE_DOCUMENT:Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE);
                            if(saving)intent.setType("application/json").putExtra(Intent.EXTRA_TITLE,"packing-scanning-backup.json");
                            else intent.setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"application/json","text/plain","application/octet-stream"});
                            startActivityForResult(call,intent,"documentChosen");
                        }catch(Exception error){finishFailure(call,"The system backup dialog could not open. Your packing records have not changed.");}
                    });
                }catch(Exception error){finishFailure(call,"The backup could not be prepared. Check its size and unlock this workspace again.");}
            });
        }catch(Exception error){busy.set(false);call.reject("Unlock the selected workspace and choose a backup under 80 MB.","backup_failed");}
    }
    @ActivityCallback private void documentChosen(PluginCall call,ActivityResult result){
        if(call==null){cleanup();return;}
        Uri uri=result.getData()==null?null:result.getData().getData();
        if(result.getResultCode()!=Activity.RESULT_OK||uri==null){cleanup();JSObject value=new JSObject();value.put("saved",false);value.put("selected",false);call.resolve(value);return;}
        if(!"content".equals(uri.getScheme())){finishFailure(call,"The file provider returned an unsupported document.");return;}
        try{worker.execute(()->{
            boolean saving=exporting!=null;byte[] bytes=null;
            try{
                if(closed||selecting==null)throw new IOException();JSObject value=new JSObject();
                if(saving){
                    // This specific plaintext export was explicitly requested before the picker locked the workspace.
                    bytes=store.read(exporting,selecting);
                    try(OutputStream output=getContext().getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new IOException();output.write(bytes);output.flush();}
                    value.put("saved",true);
                }else{
                    PendingBackupStore.Receipt receipt;
                    try(InputStream input=getContext().getContentResolver().openInputStream(uri)){if(input==null)throw new IOException();receipt=store.stage(selecting,input);}
                    value.put("selected",true);value.put("ticket",receipt.ticket);value.put("target",receipt.target);
                }
                if(closed)throw new IOException();call.resolve(value);
            }catch(Exception error){call.reject(saving?"The backup could not be saved. The selected file may be incomplete; retry with another destination.":"The selected backup could not be opened. Choose a UTF-8 JSON backup under 80 MB. Packing records have not changed.","backup_failed");}
            finally{if(bytes!=null)Arrays.fill(bytes,(byte)0);cleanup();}
        });}catch(RejectedExecutionException error){finishFailure(call,"Backup access has closed.");}
    }
    @PluginMethod public void readBackup(PluginCall call){
        if(store==null||closed){call.reject("Backup access is unavailable.","backup_unavailable");return;}
        try{
            CaptureScopeManager.Access access=access(call);PendingBackupStore.Scope target=scope(access);String ticket=call.getString("ticket");
            enqueue(call,()->{byte[] bytes=null;try{access.check();bytes=store.read(ticket,target);String text=PendingBackupStore.utf8(bytes);access.check();if(closed)throw new IOException();JSObject value=new JSObject();value.put("text",text);call.resolve(value);}catch(Exception error){call.reject("Unlock the workspace that selected this backup, or choose the file again if it expired.","backup_locked");}finally{if(bytes!=null)Arrays.fill(bytes,(byte)0);}});
        }catch(Exception error){call.reject("Unlock the workspace that selected this backup first.","backup_locked");}
    }
    @PluginMethod public void discardBackup(PluginCall call){
        if(store==null||closed){call.resolve();return;}
        enqueue(call,()->{try{store.discard(call.getString("ticket"));call.resolve();}catch(IOException error){call.reject("The encrypted temporary backup could not be discarded.","backup_failed");}});
    }
    private void enqueue(PluginCall call,Runnable job){
        if(queued.incrementAndGet()>4){queued.decrementAndGet();call.reject("Wait for the current backup operation.","backup_busy");return;}
        try{worker.execute(()->{try{if(closed){call.reject("Backup access has closed.","backup_unavailable");return;}job.run();}finally{queued.decrementAndGet();}});}catch(RejectedExecutionException error){queued.decrementAndGet();call.reject("Backup access has closed.","backup_unavailable");}
    }
    private void finishFailure(PluginCall call,String message){cleanup();call.reject(message,"backup_failed");}
    private void cleanup(){
        String ticket=exporting;exporting=null;selecting=null;
        try{worker.execute(()->{try{if(ticket!=null&&store!=null)store.discard(ticket);}catch(IOException ignored){}finally{busy.set(false);}});}catch(RejectedExecutionException ignored){busy.set(false);}
    }
    @Override protected void handleOnDestroy(){closed=true;try{worker.execute(()->{try{if(store!=null)store.close();}catch(IOException ignored){}});}catch(RejectedExecutionException ignored){}worker.shutdown();super.handleOnDestroy();}
}
