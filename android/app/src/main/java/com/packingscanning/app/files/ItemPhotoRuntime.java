package com.packingscanning.app.files;
import java.io.*;
public final class ItemPhotoRuntime {
    private static File root;private static PendingItemPhotoStore store;
    private static java.util.concurrent.ScheduledExecutorService expiry;
    private ItemPhotoRuntime(){}
    public static synchronized PendingItemPhotoStore store(File cacheDir)throws IOException{
        File canonical=cacheDir.getCanonicalFile();if(store==null){store=new PendingItemPhotoStore(canonical);root=canonical;
            expiry=java.util.concurrent.Executors.newSingleThreadScheduledExecutor(job->{Thread thread=new Thread(job,"item-photo-expiry");thread.setDaemon(true);return thread;});
            expiry.scheduleWithFixedDelay(()->{try{store.expire();}catch(IOException ignored){}},1,1,java.util.concurrent.TimeUnit.MINUTES);
        }
        if(!root.equals(canonical))throw new IOException("Invalid private photo storage.");return store;
    }
}
