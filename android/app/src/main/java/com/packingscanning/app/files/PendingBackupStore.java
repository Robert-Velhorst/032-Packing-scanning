package com.packingscanning.app.files;

import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.*;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/** Encrypted, temporary document selections. Keys and tickets never survive this process. */
public final class PendingBackupStore implements AutoCloseable {
    public enum Purpose { BACKUP("packing-backup-pending"), ITEM_PHOTO("packing-photo-pending"); final String directory;Purpose(String directory){this.directory=directory;} }
    public static final int MAX_BYTES = 80 * 1024 * 1024;
    public static final long TTL_MS = 10 * 60 * 1000;
    private static final byte[] MAGIC = {'P','B','K','1'};
    private static final SecureRandom RANDOM = new SecureRandom();
    interface Clock { long now(); }
    public static final class Scope {
        public final String workspace, account;
        public Scope(String workspace, String account) throws IOException {
            if ((workspace == null) != (account == null)) throw new IOException("Invalid backup workspace.");
            this.workspace = workspace == null ? null : id(workspace);
            this.account = account == null ? null : id(account);
        }
        public String target() { return workspace == null ? "guest" : workspace; }
        private String identity() { return workspace == null ? "guest" : workspace + ":" + account; }
    }
    public static final class Receipt {
        public final String ticket, target;
        private Receipt(String ticket, Scope scope) { this.ticket=ticket;target=scope.target(); }
    }
    private static final class Entry {
        final String ticket; final Scope scope; final byte[] key; final long created;
        Entry(String ticket,Scope scope,byte[] key,long created) { this.ticket=ticket;this.scope=scope;this.key=key;this.created=created; }
    }
    private final File root;
    private final Clock clock;
    private final int maximum;
    private final Map<String,Entry> entries = new LinkedHashMap<>();
    private boolean closed;

    public PendingBackupStore(File cacheDir) throws IOException { this(cacheDir,MAX_BYTES,()->System.nanoTime()/1_000_000); }
    public PendingBackupStore(File cacheDir,Purpose purpose) throws IOException { this(cacheDir,MAX_BYTES,()->System.nanoTime()/1_000_000,purpose); }
    PendingBackupStore(File cacheDir,int maximum,Clock clock) throws IOException {
        this(cacheDir,maximum,clock,Purpose.BACKUP);
    }
    private PendingBackupStore(File cacheDir,int maximum,Clock clock,Purpose purpose) throws IOException {
        File parent=cacheDir.getCanonicalFile();
        if(!parent.isDirectory() || maximum<1)throw new IOException("Private backup storage is unavailable.");
        root=child(parent,purpose.directory);
        if(!root.isDirectory()&&!root.mkdir())throw new IOException("Private backup storage could not be prepared.");
        this.maximum=maximum;this.clock=clock;
        // Only our flat UUID encrypted files are disposable. Unknown files and directories remain.
        File[] files=root.listFiles();if(files==null)throw new IOException("Private backup storage could not be opened.");
        for(File file:files)if(file.getName().matches("[0-9a-f-]{36}\\.(sealed|partial)")&&file.isFile()){
            File owned=child(root,file.getName());if(!owned.delete())throw new IOException("An old temporary backup could not be removed.");
        }
    }
    public synchronized Receipt stage(Scope scope,InputStream input) throws IOException {
        available();expire();if(entries.size()>=2)throw new IOException("Discard an earlier selected backup first.");
        String ticket=UUID.randomUUID().toString();byte[] key=new byte[32],nonce=new byte[12],buffer=new byte[32*1024];
        RANDOM.nextBytes(key);RANDOM.nextBytes(nonce);Entry entry=new Entry(ticket,scope,key,clock.now());
        File partial=child(root,ticket+".partial"),finished=child(root,ticket+".sealed");boolean committed=false;
        try {
            Cipher cipher=cipher(Cipher.ENCRYPT_MODE,entry,nonce);
            try(FileOutputStream output=new FileOutputStream(partial)){
                output.write(MAGIC);output.write(nonce);int total=0,count;
                while((count=input.read(buffer))!=-1){
                    if(count==0){int single=input.read();if(single<0)break;buffer[0]=(byte)single;count=1;}
                    if(count>maximum-total)throw new IOException("This backup is over 80 MB. Choose a smaller backup file.");
                    total+=count;byte[] encrypted=cipher.update(buffer,0,count);if(encrypted!=null)output.write(encrypted);
                    Arrays.fill(buffer,(byte)0);
                }
                if(total==0)throw new IOException("The selected backup is empty.");
                output.write(cipher.doFinal());output.getFD().sync();
            }
            if(!partial.renameTo(finished))throw new IOException("The temporary backup could not be saved.");
            entries.put(ticket,entry);committed=true;return new Receipt(ticket,scope);
        }catch(GeneralSecurityException error){throw new IOException("The temporary backup could not be encrypted.");}
        finally{Arrays.fill(buffer,(byte)0);if(!committed){Arrays.fill(key,(byte)0);if(partial.exists())partial.delete();if(finished.exists())finished.delete();}}
    }
    public synchronized byte[] read(String ticket,Scope scope) throws IOException {
        available();expire();Entry entry=entries.get(id(ticket));
        if(entry==null)throw new IOException("The selected backup expired. Choose the file again.");
        if(!entry.scope.identity().equals(scope.identity()))throw new IOException("Unlock the workspace that selected this backup first.");
        File file=child(root,entry.ticket+".sealed");
        if(!file.isFile()||file.length()<32||file.length()>maximum+32L)throw new IOException("Invalid temporary backup.");
        byte[] sealed=new byte[(int)file.length()];
        try(FileInputStream input=new FileInputStream(file)){
            int offset=0;while(offset<sealed.length){int count=input.read(sealed,offset,sealed.length-offset);if(count<0)throw new IOException("Incomplete temporary backup.");offset+=count;}
            if(input.read()!=-1)throw new IOException("Temporary backup changed while opening.");
            for(int i=0;i<4;i++)if(sealed[i]!=MAGIC[i])throw new IOException("Unsupported temporary backup.");
            return cipher(Cipher.DECRYPT_MODE,entry,Arrays.copyOfRange(sealed,4,16)).doFinal(sealed,16,sealed.length-16);
        }catch(GeneralSecurityException error){throw new IOException("Temporary backup authentication failed.");}
        finally{Arrays.fill(sealed,(byte)0);}
    }
    public static String utf8(byte[] bytes) throws IOException {
        try{return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();}
        catch(CharacterCodingException error){throw new IOException("The selected backup is not valid UTF-8 JSON.");}
    }
    public synchronized void discard(String ticket) throws IOException {
        Entry entry=entries.remove(id(ticket));if(entry==null)return;
        Arrays.fill(entry.key,(byte)0);File file=child(root,entry.ticket+".sealed");
        if(file.exists()&&!file.delete())throw new IOException("The encrypted temporary backup could not be removed.");
    }
    public synchronized void expire() throws IOException {
        for(Entry entry:new ArrayList<>(entries.values()))if(clock.now()-entry.created>=TTL_MS)discard(entry.ticket);
    }
    @Override public synchronized void close() throws IOException {
        closed=true;IOException failure=null;for(String ticket:new ArrayList<>(entries.keySet()))try{discard(ticket);}catch(IOException error){failure=error;}
        if(failure!=null)throw failure;
    }
    private void available() throws IOException { if(closed)throw new IOException("Backup access has closed."); }
    private Cipher cipher(int mode,Entry entry,byte[] nonce) throws GeneralSecurityException {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(mode,new SecretKeySpec(entry.key,"AES"),new GCMParameterSpec(128,nonce));
        cipher.updateAAD(("packing-pending-backup-v1:"+entry.ticket+":"+entry.scope.identity()+":"+root.getName()).getBytes(StandardCharsets.UTF_8));return cipher;
    }
    private static String id(String value) throws IOException {
        if(value==null||!value.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))throw new IOException("Invalid backup identity.");return UUID.fromString(value).toString();
    }
    private static File child(File parent,String name) throws IOException {
        File file=new File(parent,name).getCanonicalFile();if(!parent.equals(file.getParentFile())||!name.equals(file.getName()))throw new IOException("Invalid temporary backup location.");return file;
    }
}
