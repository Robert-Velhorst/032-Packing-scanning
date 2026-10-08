package com.packingscanning.app.scanning;

import java.io.File;
import java.io.IOException;

/** One process authority shared by the bridge and its private capture activity. Never persisted. */
public final class CaptureRuntime {
    private static CaptureScopeManager manager;
    private static File root;
    private static String foregroundCapture;
    private CaptureRuntime() {}
    public static synchronized CaptureScopeManager manager(File filesDir) throws IOException {
        File requested=filesDir.getCanonicalFile();
        if(manager==null) { manager=new CaptureScopeManager(requested);root=requested; }
        if(!root.equals(requested))throw new IOException("Capture runtime belongs to another app directory.");
        return manager;
    }
    public static synchronized void enterCapture(CaptureScopeManager.Access access) throws IOException { access.check();foregroundCapture=access.lease(); }
    public static synchronized void leaveCapture(CaptureScopeManager.Access access) { if(access!=null&&access.lease().equals(foregroundCapture))foregroundCapture=null; }
    public static synchronized boolean hasForegroundCapture(String lease) {
        if(lease==null||!lease.equals(foregroundCapture)||manager==null)return false;
        try{manager.access(lease).check();return true;}catch(IOException error){return false;}
    }
}
