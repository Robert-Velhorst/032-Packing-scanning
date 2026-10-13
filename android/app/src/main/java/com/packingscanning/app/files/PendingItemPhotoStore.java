package com.packingscanning.app.files;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Encrypted editor drafts and selected photos; saving an item remains a separate user action. */
public final class PendingItemPhotoStore implements AutoCloseable {
    public static final int MAX_PHOTO_BYTES=12*1024*1024;
    public static final int MAX_DRAFT_BYTES=PendingBackupStore.MAX_BYTES-MAX_PHOTO_BYTES-8;
    public static final class Receipt {
        public final String ticket,target;public final boolean selected;
        private Receipt(String ticket,String target,boolean selected){this.ticket=ticket;this.target=target;this.selected=selected;}
    }
    public static final class Content implements AutoCloseable {
        public final String draftJson,mime;public final byte[] photo;
        private Content(String draft,byte[] photo)throws IOException{this.draftJson=draft;this.photo=photo;mime=photo.length==0?null:imageMime(photo);}
        @Override public void close(){Arrays.fill(photo,(byte)0);}
    }
    private static final class Entry {
        final PendingBackupStore.Scope scope;final long created;final String request;boolean ready,selected;
        Entry(PendingBackupStore.Scope scope,long created,String request){this.scope=scope;this.created=created;this.request=request;}
    }
    private final PendingBackupStore encrypted;
    private final Map<String,Entry> entries=new HashMap<>();
    private final Map<String,String> results=new HashMap<>();
    private final PendingBackupStore.Clock clock;
    private final int photoMaximum;
    public PendingItemPhotoStore(File cacheDir)throws IOException{this(cacheDir,MAX_PHOTO_BYTES,()->System.nanoTime()/1_000_000);}
    PendingItemPhotoStore(File cacheDir,int photoMaximum,PendingBackupStore.Clock clock)throws IOException{
        encrypted=new PendingBackupStore(cacheDir,PendingBackupStore.Purpose.ITEM_PHOTO);this.photoMaximum=photoMaximum;this.clock=clock;
    }
    public synchronized Receipt prepare(PendingBackupStore.Scope scope,String draftJson)throws IOException{
        expire();if(!entries.isEmpty())throw new IOException("Resume or discard the previous photo draft first.");
        byte[] draft=draftJson==null?new byte[0]:draftJson.getBytes(StandardCharsets.UTF_8);
        try{if(draft.length==0||draft.length>MAX_DRAFT_BYTES)throw new IOException("The item draft is too large for a photo selection.");
            PendingBackupStore.Receipt receipt=encrypted.stage(scope,bundle(draft,new ByteArrayInputStream(new byte[0])));
            entries.put(receipt.ticket,new Entry(scope,clock.now(),receipt.ticket));return new Receipt(receipt.ticket,receipt.target,false);
        }finally{Arrays.fill(draft,(byte)0);}
    }
    public synchronized void checkRequest(String ticket)throws IOException{Entry entry=entry(ticket);if(entry.ready)throw new IOException("This photo request already finished.");}
    public synchronized Receipt cancelled(String ticket)throws IOException{
        if(results.containsKey(ticket))return result(ticket,results.get(ticket));
        Entry entry=entry(ticket);entry.ready=true;return new Receipt(ticket,entry.scope.target(),false);
    }
    public synchronized Receipt complete(String ticket,InputStream image)throws IOException{
        Entry entry=entry(ticket);if(entry.ready)throw new IOException("This photo request already finished.");
        byte[] plain=encrypted.read(ticket,entry.scope),draft=null;
        try(Content content=parse(plain)){draft=content.draftJson.getBytes(StandardCharsets.UTF_8);
            PushbackInputStream input=new PushbackInputStream(image,16);byte[] prefix=new byte[16];int count=0;
            while(count<prefix.length){int read=input.read(prefix,count,prefix.length-count);if(read<0)break;if(read==0){int single=input.read();if(single<0)break;prefix[count++]=(byte)single;}else count+=read;}
            imageMime(Arrays.copyOf(prefix,count));input.unread(prefix,0,count);
            InputStream limited=new FilterInputStream(input){int total;private void add(int n)throws IOException{if(n>0&&(total+=n)>photoMaximum)throw new IOException("Choose a photo under 12 MB.");}
                @Override public int read()throws IOException{int value=in.read();if(value!=-1)add(1);return value;}
                @Override public int read(byte[] b,int off,int len)throws IOException{int count=in.read(b,off,len);add(count);return count;}};
            PendingBackupStore.Receipt next=encrypted.stage(entry.scope,bundle(draft,limited));
            entries.put(next.ticket,new Entry(entry.scope,entry.created,entry.request));entries.get(next.ticket).ready=true;entries.get(next.ticket).selected=true;
            results.put(entry.request,next.ticket);entries.remove(ticket);encrypted.discard(ticket);return new Receipt(next.ticket,next.target,true);
        }finally{Arrays.fill(plain,(byte)0);if(draft!=null)Arrays.fill(draft,(byte)0);}
    }
    public synchronized Content read(String ticket,PendingBackupStore.Scope scope)throws IOException{
        Entry entry=entry(ticket);if(!entry.ready)throw new IOException("Finish the photo request first.");byte[] bytes=encrypted.read(ticket,scope);
        try{return parse(bytes);}finally{Arrays.fill(bytes,(byte)0);}
    }
    public synchronized Receipt result(String request,String ticket)throws IOException{Entry entry=entry(ticket);if(!entry.ready||!entry.request.equals(request))throw new IOException("Invalid photo result.");return new Receipt(ticket,entry.scope.target(),entry.selected);}
    public synchronized void discard(String ticket)throws IOException{encrypted.discard(ticket);entries.remove(ticket);results.values().removeAll(Collections.singleton(ticket));}
    public synchronized void expire()throws IOException{
        encrypted.expire();for(String ticket:new ArrayList<>(entries.keySet()))if(clock.now()-entries.get(ticket).created>=PendingBackupStore.TTL_MS)discard(ticket);
    }
    private Entry entry(String ticket)throws IOException{expire();Entry entry=entries.get(ticket);if(entry==null)throw new IOException("The photo draft expired. Start a new photo selection.");return entry;}
    private static InputStream bundle(byte[] draft,InputStream photo)throws IOException{
        ByteArrayOutputStream header=new ByteArrayOutputStream(8);DataOutputStream data=new DataOutputStream(header);data.writeInt(0x50495031);data.writeInt(draft.length);
        return new SequenceInputStream(Collections.enumeration(Arrays.asList(new ByteArrayInputStream(header.toByteArray()),new ByteArrayInputStream(draft),photo)));
    }
    private Content parse(byte[] bytes)throws IOException{
        DataInputStream input=new DataInputStream(new ByteArrayInputStream(bytes));if(input.readInt()!=0x50495031)throw new IOException("Invalid photo draft.");int length=input.readInt();
        if(length<=0||length>MAX_DRAFT_BYTES||length>bytes.length-8||bytes.length-8-length>photoMaximum)throw new IOException("Invalid photo draft size.");
        byte[] draft=Arrays.copyOfRange(bytes,8,8+length);String text;try{text=PendingBackupStore.utf8(draft);}finally{Arrays.fill(draft,(byte)0);}
        return new Content(text,Arrays.copyOfRange(bytes,8+length,bytes.length));
    }
    public static String imageMime(byte[] bytes)throws IOException{
        if(bytes.length>=8&&bytes[0]==(byte)0x89&&bytes[1]=='P'&&bytes[2]=='N'&&bytes[3]=='G'&&bytes[4]==13&&bytes[5]==10&&bytes[6]==26&&bytes[7]==10)return "image/png";
        if(bytes.length>=3&&bytes[0]==(byte)0xff&&bytes[1]==(byte)0xd8&&bytes[2]==(byte)0xff)return "image/jpeg";
        if(bytes.length>=6&&bytes[0]=='G'&&bytes[1]=='I'&&bytes[2]=='F'&&bytes[3]=='8'&&(bytes[4]=='7'||bytes[4]=='9')&&bytes[5]=='a')return "image/gif";
        if(bytes.length>=12&&bytes[0]=='R'&&bytes[1]=='I'&&bytes[2]=='F'&&bytes[3]=='F'&&bytes[8]=='W'&&bytes[9]=='E'&&bytes[10]=='B'&&bytes[11]=='P')return "image/webp";
        throw new IOException("Choose a JPEG, PNG, GIF or WebP photo. SVG and unsupported formats cannot be attached.");
    }
    @Override public synchronized void close()throws IOException{entries.clear();results.clear();encrypted.close();}
}
