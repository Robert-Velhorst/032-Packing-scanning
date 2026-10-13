package com.packingscanning.app.files;

import java.io.*;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.junit.*;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class PendingBackupStoreTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private long time;
    private PendingBackupStore store;
    private final PendingBackupStore.Scope guest=scope(null,null),a=scope("11111111-1111-4111-8111-111111111111","22222222-2222-4222-8222-222222222222");
    private static PendingBackupStore.Scope scope(String workspace,String account){try{return new PendingBackupStore.Scope(workspace,account);}catch(IOException error){throw new AssertionError(error);}}
    @Before public void prepare()throws Exception{store=new PendingBackupStore(temporary.getRoot(),256,()->time);}
    @After public void finish()throws Exception{store.close();}
    private PendingBackupStore.Receipt stage(PendingBackupStore.Scope target,String text)throws Exception{return store.stage(target,new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)));}
    private File file(String ticket){return new File(temporary.getRoot(),"packing-backup-pending/"+ticket+".sealed");}
    @Test public void encryptsTheSelectionBeforeWritingAndRequiresTheSameWorkspaceAndAccount()throws Exception{
        String text="{\"private\":\"synthetic photo 東京\"}";PendingBackupStore.Receipt receipt=stage(a,text);
        byte[] sealed=Files.readAllBytes(file(receipt.ticket).toPath());assertEquals("PBK1",new String(sealed,0,4,StandardCharsets.US_ASCII));assertFalse(new String(sealed,StandardCharsets.UTF_8).contains("synthetic photo"));
        assertEquals(a.workspace,receipt.target);assertEquals(text,PendingBackupStore.utf8(store.read(receipt.ticket,a)));
        assertThrows(IOException.class,()->store.read(receipt.ticket,guest));
        assertThrows(IOException.class,()->store.read(receipt.ticket,scope(a.workspace,"33333333-3333-4333-8333-333333333333")));
    }
    @Test public void freshScopeIdentityCanReviewAfterUnlockWhileCrossWorkspaceReadsFail()throws Exception{
        PendingBackupStore.Receipt receipt=stage(a,"{}");assertArrayEquals("{}".getBytes(StandardCharsets.UTF_8),store.read(receipt.ticket,scope(a.workspace,a.account)));
        assertThrows(IOException.class,()->store.read(receipt.ticket,scope("33333333-3333-4333-8333-333333333333",a.account)));
    }
    @Test public void refusesOversizedEmptyAndThrowingStreamsWithoutLeavingTemporaryFiles()throws Exception{
        assertThrows(IOException.class,()->stage(guest,"x".repeat(257)));assertThrows(IOException.class,()->stage(guest,""));
        assertThrows(IOException.class,()->store.stage(guest,new InputStream(){public int read()throws IOException{throw new IOException("provider failed");}}));
        assertEquals(0,Objects.requireNonNull(new File(temporary.getRoot(),"packing-backup-pending").list()).length);
    }
    @Test public void handlesShortReadsAndZeroLengthReadsAndStrictUtf8()throws Exception{
        byte[] text="{\"name\":\"é\"}".getBytes(StandardCharsets.UTF_8);ByteArrayInputStream input=new ByteArrayInputStream(text){boolean zero=true;@Override public synchronized int read(byte[] b,int off,int len){if(zero){zero=false;return 0;}return super.read(b,off,Math.min(len,2));}};
        PendingBackupStore.Receipt receipt=store.stage(guest,input);assertArrayEquals(text,store.read(receipt.ticket,guest));assertThrows(IOException.class,()->PendingBackupStore.utf8(new byte[]{(byte)0xc3,0x28}));
    }
    @Test public void authenticatesEveryByteAndBindsCiphertextToItsTicket()throws Exception{
        PendingBackupStore.Receipt first=stage(guest,"{\"one\":1}"),second=stage(guest,"{\"two\":2}");byte[] original=Files.readAllBytes(file(first.ticket).toPath());
        Files.write(file(second.ticket).toPath(),original);assertThrows(IOException.class,()->store.read(second.ticket,guest));
        original[original.length-1]^=1;Files.write(file(first.ticket).toPath(),original);assertThrows(IOException.class,()->store.read(first.ticket,guest));
    }
    @Test public void expirationIsNotRenewedByReadingAndDiscardIsIdempotent()throws Exception{
        PendingBackupStore.Receipt receipt=stage(a,"{}");time=PendingBackupStore.TTL_MS-1;store.read(receipt.ticket,a);time++;store.expire();assertFalse(file(receipt.ticket).exists());assertThrows(IOException.class,()->store.read(receipt.ticket,a));store.discard(receipt.ticket);
    }
    @Test public void limitsPendingSelectionsAndDoesNotDeleteOtherFilesOnRestart()throws Exception{
        PendingBackupStore.Receipt first=stage(a,"{}"),second=stage(guest,"{}");assertThrows(IOException.class,()->stage(a,"{}"));store.discard(first.ticket);stage(a,"{}");
        File unknown=new File(temporary.getRoot(),"packing-backup-pending/keep.txt");Files.write(unknown.toPath(),"unrelated".getBytes(StandardCharsets.UTF_8));
        try(PendingBackupStore restarted=new PendingBackupStore(temporary.getRoot(),256,()->time)){assertFalse(file(second.ticket).exists());assertTrue(unknown.exists());assertThrows(IOException.class,()->restarted.read(second.ticket,guest));}
    }
    @Test public void refusesTraversalAndClosedStores()throws Exception{
        assertThrows(IOException.class,()->store.read("../../keep",guest));assertThrows(IOException.class,()->new PendingBackupStore.Scope(a.workspace,null));store.close();assertThrows(IOException.class,()->stage(a,"{}"));
    }
}
