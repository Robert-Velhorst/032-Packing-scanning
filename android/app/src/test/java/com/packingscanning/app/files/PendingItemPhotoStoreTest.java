package com.packingscanning.app.files;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import static org.junit.Assert.*;
public class PendingItemPhotoStoreTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private PendingItemPhotoStore store;private long time;
    private final String draft="{\"name\":\"private partial draft\",\"length\":\"\",\"unit\":\"imperial\"}";
    private final PendingBackupStore.Scope guest=scope(null,null),a=scope("11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222");
    private static PendingBackupStore.Scope scope(String a,String b){try{return new PendingBackupStore.Scope(a,b);}catch(IOException error){throw new AssertionError(error);}}
    private static byte[] png(){return Base64.getDecoder().decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");}
    @Before public void prepare()throws Exception{store=new PendingItemPhotoStore(temporary.getRoot(),100,()->time);}
    @After public void finish()throws Exception{store.close();}
    @Test public void cancellationKeepsAnEncryptedPartialDraftWithoutSavingAPhoto()throws Exception{
        PendingItemPhotoStore.Receipt request=store.prepare(a,draft);assertThrows(IOException.class,()->store.read(request.ticket,a));
        byte[] file=Files.readAllBytes(new File(temporary.getRoot(),"packing-photo-pending/"+request.ticket+".sealed").toPath());assertFalse(new String(file,StandardCharsets.UTF_8).contains("private partial"));
        PendingItemPhotoStore.Receipt cancelled=store.cancelled(request.ticket);assertFalse(cancelled.selected);assertEquals(a.workspace,cancelled.target);
        try(PendingItemPhotoStore.Content content=store.read(cancelled.ticket,a)){assertEquals(draft,content.draftJson);assertEquals(0,content.photo.length);assertNull(content.mime);}
    }
    @Test public void completionTransfersOnlyItsOwnDraftAndSupportsCancelledActivityAfterSuccessfulStaging()throws Exception{
        PendingItemPhotoStore.Receipt request=store.prepare(a,draft),result=store.complete(request.ticket,new ByteArrayInputStream(png()));assertTrue(result.selected);assertNotEquals(request.ticket,result.ticket);
        assertEquals(result.ticket,store.result(request.ticket,result.ticket).ticket);assertEquals(result.ticket,store.cancelled(request.ticket).ticket);
        assertThrows(IOException.class,()->store.result(UUID.randomUUID().toString(),result.ticket));
        try(PendingItemPhotoStore.Content content=store.read(result.ticket,scope(a.workspace,a.account))){assertEquals(draft,content.draftJson);assertArrayEquals(png(),content.photo);assertEquals("image/png",content.mime);}
        assertEquals(1,Objects.requireNonNull(new File(temporary.getRoot(),"packing-photo-pending").list()).length);
    }
    @Test public void refusesOtherWorkspacesAccountsAndBackupReaders()throws Exception{
        PendingItemPhotoStore.Receipt result=store.complete(store.prepare(a,draft).ticket,new ByteArrayInputStream(png()));assertThrows(IOException.class,()->store.read(result.ticket,guest));assertThrows(IOException.class,()->store.read(result.ticket,scope(a.workspace,UUID.randomUUID().toString())));
        try(PendingBackupStore backups=new PendingBackupStore(temporary.getRoot())){assertThrows(IOException.class,()->backups.read(result.ticket,a));assertTrue(new File(temporary.getRoot(),"packing-photo-pending/"+result.ticket+".sealed").exists());}
    }
    @Test public void invalidOversizedAndThrowingSelectionsLeaveTheOriginalDraftResumable()throws Exception{
        PendingItemPhotoStore.Receipt request=store.prepare(guest,draft);assertThrows(IOException.class,()->store.complete(request.ticket,new ByteArrayInputStream("<svg/>".getBytes(StandardCharsets.UTF_8))));
        byte[] huge=Arrays.copyOf(png(),101);assertThrows(IOException.class,()->store.complete(request.ticket,new ByteArrayInputStream(huge)));
        assertThrows(IOException.class,()->store.complete(request.ticket,new InputStream(){@Override public int read()throws IOException{throw new IOException();}}));store.cancelled(request.ticket);
        try(PendingItemPhotoStore.Content content=store.read(request.ticket,guest)){assertEquals(draft,content.draftJson);assertEquals(0,content.photo.length);}
    }
    @Test public void handlesShortAndZeroReadsWithoutChangingTheEncodedPhoto()throws Exception{
        ByteArrayInputStream input=new ByteArrayInputStream(png()){boolean zero=true;@Override public synchronized int read(byte[] b,int off,int len){if(zero){zero=false;return 0;}return super.read(b,off,Math.min(len,2));}};
        PendingItemPhotoStore.Receipt result=store.complete(store.prepare(guest,draft).ticket,input);try(PendingItemPhotoStore.Content content=store.read(result.ticket,guest)){assertArrayEquals(png(),content.photo);}
    }
    @Test public void expiryDoesNotRenewOnCompletionReadOrCancellationAndAllowsANewRequest()throws Exception{
        PendingItemPhotoStore.Receipt request=store.prepare(a,draft);time=PendingBackupStore.TTL_MS-2;PendingItemPhotoStore.Receipt result=store.complete(request.ticket,new ByteArrayInputStream(png()));time++;store.read(result.ticket,a).close();time++;store.expire();assertThrows(IOException.class,()->store.read(result.ticket,a));store.prepare(guest,draft);
    }
    @Test public void discardDropsThePhotoAndDraftWhilePreservingUnknownFiles()throws Exception{
        PendingItemPhotoStore.Receipt result=store.complete(store.prepare(a,draft).ticket,new ByteArrayInputStream(png()));File unknown=new File(temporary.getRoot(),"packing-photo-pending/keep.txt");Files.write(unknown.toPath(),new byte[]{1});store.discard(result.ticket);assertTrue(unknown.exists());assertThrows(IOException.class,()->store.read(result.ticket,a));store.discard(result.ticket);
    }
    @Test public void rejectsDuplicatePreparationAndCompletingACancelledRequest()throws Exception{
        PendingItemPhotoStore.Receipt request=store.prepare(a,draft);assertThrows(IOException.class,()->store.prepare(guest,draft));store.cancelled(request.ticket);assertThrows(IOException.class,()->store.complete(request.ticket,new ByteArrayInputStream(png())));store.discard(request.ticket);assertThrows(IOException.class,()->store.prepare(guest,""));
    }
}
