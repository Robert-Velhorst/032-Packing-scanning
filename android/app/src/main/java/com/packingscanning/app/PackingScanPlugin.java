package com.packingscanning.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import com.packingscanning.app.scanning.CaptureStore;
import com.packingscanning.app.scanning.VoxelSolid;
import com.packingscanning.app.scanning.VoxelCavity;
import com.packingscanning.app.scanning.DepthCaptureActivity;
import com.packingscanning.app.scanning.CaptureRuntime;
import com.packingscanning.app.scanning.CaptureScopeManager;
import java.io.IOException;
import java.util.Arrays;
import org.json.JSONArray;

@CapacitorPlugin(name = "PackingScan", permissions = {
    @Permission(alias = "camera", strings = {Manifest.permission.CAMERA})
})
public class PackingScanPlugin extends Plugin {
    private volatile boolean captureActive;
    private volatile boolean captureHandoff;
    private volatile String selectedLease;
    private final java.util.concurrent.atomic.AtomicBoolean retentionBusy=new java.util.concurrent.atomic.AtomicBoolean();
    private CaptureScopeManager scopes() throws IOException { return CaptureRuntime.manager(getContext().getFilesDir()); }
    private CaptureScopeManager.Access bound(PluginCall call) throws IOException { return scopes().access(call.getString("lease")); }
    private JSObject storageState() throws IOException {
        CaptureScopeManager.State state=scopes().state();JSObject result=new JSObject();result.put("version",1);result.put("revision",state.revision);
        result.put("lease",state.lease==null?org.json.JSONObject.NULL:state.lease);result.put("protectedWorkspace",state.protectedWorkspace);return result;
    }
    @Override public void load() { try { scopes().lock(); } catch(IOException ignored) { /* Storage handshake will fail closed. */ } }
    @Override protected void handleOnPause() {
        if(captureHandoff){captureHandoff=false;return;}
        lockProtected();
    }
    @Override protected void handleOnResume() {
        try { if(selectedLease!=null&&!selectedLease.equals(scopes().state().lease)){JSObject event=new JSObject();event.put("lease",selectedLease);notifyListeners("captureWorkspaceLocked",event,true);} }
        catch(IOException ignored){lockProtected();}
    }
    @Override protected void handleOnStop() { if(!CaptureRuntime.hasForegroundCapture(selectedLease))lockProtected(); }
    @Override protected void handleOnDestroy() { try { scopes().lock(); } catch(IOException ignored) { /* Runtime authority cannot be reopened after process death. */ } }
    private void lockProtected() {
        try { CaptureScopeManager.State state=scopes().state();if(state.protectedWorkspace)scopes().lock(state.revision); }
        catch(IOException ignored) { /* No store can be opened without the handshake. */ }
    }
    @PluginMethod public void getStorageState(PluginCall call) { try{call.resolve(storageState());}catch(IOException error){call.reject("Private capture storage is unavailable.","STORAGE_UNAVAILABLE");} }
    @PluginMethod public void selectGuestStorage(PluginCall call) {
        if(captureActive){call.reject("Finish or cancel the current scan first.","CAPTURE_BUSY");return;}
        try { selectedLease=scopes().selectGuest(call.getString("revision")).lease();call.resolve(storageState()); }
        catch(IOException error){call.reject("The capture selection changed. Reload saved workspaces.","STORAGE_CHANGED");}
    }
    @PluginMethod public void openWorkspaceStorage(PluginCall call) {
        JSONArray values=call.getArray("keyBytes");call.getData().remove("keyBytes");byte[] key=new byte[32];
        try {
            if(captureActive||values==null||values.length()!=32)throw new IOException();
            for(int i=0;i<32;i++){Object value=values.get(i);if(!(value instanceof Number)||((Number)value).doubleValue()!=((Number)value).intValue()||((Number)value).intValue()<0||((Number)value).intValue()>255)throw new IOException();key[i]=(byte)((Number)value).intValue();}
            selectedLease=scopes().openWorkspace(call.getString("revision"),call.getString("workspaceId"),call.getString("accountId"),key).lease();call.resolve(storageState());
        }catch(Exception error){call.reject("The protected capture workspace could not be opened. Reload and unlock it again.","STORAGE_CHANGED");}
        finally { Arrays.fill(key,(byte)0);if(values!=null)for(int i=0;i<values.length();i++)try{values.put(i,0);}catch(Exception ignored){ /* Key field already removed from the bridge call. */ } }
    }
    @PluginMethod public void lockStorage(PluginCall call) { try{scopes().lock(call.getString("revision"));call.resolve(storageState());}catch(IOException error){call.reject("Capture locking could not be confirmed.","STORAGE_UNAVAILABLE");} }
    @PluginMethod public void touchStorage(PluginCall call) { try{bound(call).touch();call.resolve();}catch(IOException error){call.reject("The capture workspace is locked.","STORAGE_CHANGED");} }

    @PluginMethod
    public void getCapabilities(PluginCall call) {
        // The initial synchronous result can be UNKNOWN_CHECKING. Wait for the
        // provider's check so a supported device does not remain disabled in the UI.
        ArCoreApk.getInstance().checkAvailabilityAsync(getContext(),availability -> resolveCapabilities(call,availability));
    }

    private void resolveCapabilities(PluginCall call, ArCoreApk.Availability availability) {
        boolean supported = availability.isSupported();
        String reason = supported ? "Depth support is checked when capture starts. You may need to allow camera access or install Google Play Services for AR."
            : availability.isTransient() ? "Device support is still being checked. Try again shortly, or enter measurements manually."
            : "ARCore capture is unavailable. Enter or measure dimensions manually.";
        if (availability == ArCoreApk.Availability.SUPPORTED_INSTALLED && getPermissionState("camera") == PermissionState.GRANTED) {
            Session session = null;
            try {
                session = new Session(getContext());
                supported = session.isDepthModeSupported(Config.DepthMode.RAW_DEPTH_ONLY);
                reason = supported ? "" : "This Android device does not support raw depth. Enter measurements manually.";
            } catch (Exception error) {
                supported = false;
                reason = "Depth support could not be checked. Try capture again after checking camera permissions and Google Play Services for AR.";
            } finally { if (session != null) session.close(); }
        }
        JSObject result = new JSObject();
        result.put("supported",supported);
        result.put("platform","android");
        result.put("recognitionSupported",true);
        result.put("minimumOsVersion",24);
        result.put("reason",reason);
        call.resolve(result);
    }

    @PluginMethod
    public void scanObject(PluginCall call) {
        String target = call.getString("target");
        if (!"item".equals(target) && !"container_interior".equals(target)) { call.reject("Choose an item or bag-interior scan.","INVALID_TARGET"); return; }
        if (captureActive) { call.reject("Finish or cancel the current scan first.","CAPTURE_BUSY"); return; }
        try { bound(call).check(); } catch(IOException error){call.reject("Unlock or select the capture workspace first.","STORAGE_CHANGED");return;}
        captureActive = true;
        if (getPermissionState("camera") != PermissionState.GRANTED) requestPermissionForAlias("camera",call,"cameraReady");
        else launchCapture(call);
    }

    @PermissionCallback
    private void cameraReady(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            captureActive = false;
            call.reject("Camera permission was not granted. You can enter dimensions manually.","CAMERA_DENIED");
        } else launchCapture(call);
    }

    private void launchCapture(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                bound(call).check();
                Intent intent = new Intent(getContext(),DepthCaptureActivity.class);
                intent.putExtra("target",call.getString("target"));
                intent.putExtra("recognize", "item".equals(call.getString("target")) && Boolean.TRUE.equals(call.getData().opt("recognize")));
                intent.putExtra("captureLease",call.getString("lease"));captureHandoff=true;
                startActivityForResult(call,intent,"captureFinished");
            } catch (Exception error) {
                captureActive = false;
                captureHandoff = false;
                call.reject("The capture screen could not be opened.","PRESENTATION_FAILED",error);
            }
        });
    }

    @ActivityCallback
    private void captureFinished(PluginCall call, ActivityResult result) {
        captureActive = false;
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject(data == null ? "Scan cancelled." : data.getStringExtra("error"),"SCAN_CANCELLED");
            return;
        }
        try { bound(call).check();call.resolve(new JSObject(data.getStringExtra("result"))); }
        catch (Exception error) { call.reject("The scanner returned incomplete capture details.","INVALID_RESULT",error); }
    }

    @PluginMethod
    public void getCapturePreview(PluginCall call) {
        if(captureActive){call.reject("Finish or cancel the current scan first.","CAPTURE_BUSY");return;}
        final CaptureScopeManager.Access access;try{access=bound(call);}catch(IOException error){call.reject("The capture workspace is locked.","STORAGE_CHANGED");return;}
        execute(() -> {
            try {JSObject result=new JSObject(new CaptureStore(getContext().getFilesDir(),access).preview(call.getString("id")).toString());access.check();call.resolve(result);}
            catch(Exception error){call.reject("The original saved geometry is unavailable or invalid. You can still use or edit the recorded dimensions.","PREVIEW_UNAVAILABLE");}
        });
    }

    @PluginMethod
    public void reconstructCapture(PluginCall call) {
        if(captureActive){call.reject("Finish or cancel the current scan first.","CAPTURE_BUSY");return;}
        final CaptureScopeManager.Access access;try{access=bound(call);}catch(IOException error){call.reject("The capture workspace is locked.","STORAGE_CHANGED");return;}
        execute(() -> {
            try {JSObject result=new JSObject(new CaptureStore(getContext().getFilesDir(),access).reconstruct(call.getString("id")).toString());access.check();call.resolve(result);}
            catch(VoxelSolid.ReconstructionRejected error){call.reject("Reconstruction unavailable. " + error.getMessage(),"RECONSTRUCTION_UNAVAILABLE");}
            catch(Exception error){call.reject("Reconstruction unavailable. The source must be an intact individual-object capture with sufficient coverage. Its rectangular dimensions remain available.","RECONSTRUCTION_UNAVAILABLE");}
        });
    }

    @PluginMethod
    public void reconstructInterior(PluginCall call) {
        if(captureActive){call.reject("Finish or cancel the current scan first.","CAPTURE_BUSY");return;}
        final CaptureScopeManager.Access access;try{access=bound(call);}catch(IOException error){call.reject("The capture workspace is locked.","STORAGE_CHANGED");return;}
        execute(() -> {
            try {
                Integer axis=call.getInt("openingAxis"),sign=call.getInt("openingSign");JSObject seed=call.getObject("seedMm");
                if(axis==null||sign==null||seed==null)throw new IllegalArgumentException("Review an entry end and interior seed first.");
                double[] point={seed.getDouble("x"),seed.getDouble("y"),seed.getDouble("z")};
                JSObject result=new JSObject(new CaptureStore(getContext().getFilesDir(),access).reconstructInterior(call.getString("id"),axis,sign,point).toString());access.check();call.resolve(result);
            }catch(VoxelCavity.ReconstructionRejected error){call.reject("Interior reconstruction unavailable. "+error.getMessage(),"INTERIOR_UNAVAILABLE");}
            catch(Exception error){call.reject("Interior reconstruction unavailable. Choose valid source coordinates in an intact empty bag capture with sufficient coverage. Recorded bag dimensions remain unchanged.","INTERIOR_UNAVAILABLE");}
        });
    }

    @PluginMethod
    public void deleteCapture(PluginCall call) {
        try {
            JSObject result = new JSObject();
            CaptureScopeManager.Access access=bound(call);result.put("deleted",new CaptureStore(getContext().getFilesDir(),access).delete(call.getString("id")));access.check();
            call.resolve(result);
        } catch (Exception error) { call.reject("The saved scan could not be removed.","DELETE_FAILED",error); }
    }

    @PluginMethod
    public void clearCaptures(PluginCall call) {
        if (captureActive) { call.reject("Finish or cancel the current scan first.","CAPTURE_BUSY"); return; }
        try {
            JSObject result = new JSObject();
            CaptureScopeManager.Access access=bound(call);result.put("deleted",new CaptureStore(getContext().getFilesDir(),access).clear());access.check();
            call.resolve(result);
        } catch (Exception error) { call.reject("The saved scans could not be removed.","DELETE_FAILED",error); }
    }

    @PluginMethod public void getRetentionCapabilities(PluginCall call) {
        JSObject result=new JSObject();result.put("supported",true);result.put("version",1);call.resolve(result);
    }

    @PluginMethod public void pruneExpiredSources(PluginCall call) {
        if(captureActive||CaptureRuntime.hasForegroundCapture(selectedLease)||!retentionBusy.compareAndSet(false,true)){call.reject("Finish the active scan or cleanup first.","CAPTURE_BUSY");return;}
        final CaptureScopeManager.Access access;
        final int days;
        try{
            Object value=call.getData().opt("days");
            if(!(value instanceof Number)||((Number)value).doubleValue()!=((Number)value).intValue())throw new IOException();
            days=((Number)value).intValue();if(days!=7&&days!=30&&days!=90)throw new IOException();
            access=bound(call);
        }catch(Exception error){retentionBusy.set(false);call.reject("Choose a supported retention period in the unlocked workspace.","RETENTION_INVALID");return;}
        try{execute(()->{
            try{JSObject result=JSObject.fromJSONObject(new CaptureStore(getContext().getFilesDir(),access).pruneExpiredSources(days,call.getString("afterId")));access.check();call.resolve(result);}
            catch(Exception error){call.reject("Raw scan cleanup could not be completed. Unlock this workspace and retry; saved planning geometry is retained.","RETENTION_FAILED");}
            finally{retentionBusy.set(false);}
        });}catch(RuntimeException error){retentionBusy.set(false);call.reject("Raw scan cleanup is unavailable. Reopen the workspace.","RETENTION_FAILED");}
    }
}
