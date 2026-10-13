package com.packingscanning.app.scanning;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

public class ProtectedCaptureStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private final String workspace = UUID.randomUUID().toString(), account = UUID.randomUUID().toString();
    private final byte[] key = new byte[32];
    public ProtectedCaptureStoreTest() { new SecureRandom().nextBytes(key); }
    private CaptureScopeManager manager() throws Exception { return new CaptureScopeManager(temporary.getRoot()); }
    private CaptureScopeManager.Access open(CaptureScopeManager manager) throws Exception { return manager.openWorkspace(manager.revision(),workspace,account,key); }
    private CaptureStore store(CaptureScopeManager.Access access) throws Exception { return new CaptureStore(temporary.getRoot(),access); }
    private File file(String ws,String id,String name) { return new File(temporary.getRoot(),"packing-scans-protected/"+ws+"/"+id+"/"+name); }
    private String save(CaptureStore store, String target, DepthCloud.Snapshot snapshot) throws Exception { return store.save(target,snapshot).getJSONObject("record").getString("id"); }

    /** Actual depth-cloud and envelope code; synthetic points do not claim physical scan acceptance. */
    private static DepthCloud.Snapshot shell(boolean openTop) {
        DepthCloud cloud=new DepthCloud(.5);int side=40;float[] points=new float[side*side*side*4];int n=0;
        for(int z=0;z<side;z++)for(int y=0;y<side;y++)for(int x=0;x<side;x++)
            if(x==0||x==side-1||y==0||y==side-1||z==0||(!openTop&&z==side-1)) {
                points[n++]=.0025f+x*.005f;points[n++]=.0025f+y*.005f;points[n++]=.0025f+z*.005f;points[n++]=.95f;
            }
        points=Arrays.copyOf(points,n);
        for(int frame=0;frame<6;frame++)cloud.addFrame(frame+1,points,new float[]{(float)Math.sin(frame*Math.PI/3),0,(float)Math.cos(frame*Math.PI/3)});
        return cloud.snapshot();
    }

    @Test public void encryptsBothFilesAndPreservesEveryPointAndReconstructionProvenance() throws Exception {
        CaptureScopeManager manager=manager();CaptureStore store=store(open(manager));String id=save(store,"item",shell(false));
        File ply=file(workspace,id,"points.ply.sealed"), metadata=file(workspace,id,"capture.json.sealed");
        byte[] before=Files.readAllBytes(ply.toPath()), beforeMetadata=Files.readAllBytes(metadata.toPath());
        assertEquals("PSC1",new String(before,0,4,StandardCharsets.US_ASCII));
        assertFalse(new String(before,StandardCharsets.UTF_8).contains("element vertex"));
        assertFalse(new String(beforeMetadata,StandardCharsets.UTF_8).contains("dimensionsMm"));
        assertFalse(file(workspace,id,"points.ply").exists());assertFalse(file(workspace,id,"capture.json").exists());
        assertEquals(2,ply.getParentFile().list().length);
        JSONObject preview=store.preview(id), solid=store.reconstruct(id);
        assertEquals(8000,preview.getInt("samplePointCount"));assertTrue(preview.getInt("pointCount")>8000);
        assertEquals(preview.getInt("pointCount"),solid.getInt("sourcePointCount"));
        assertEquals(preview.getString("sourceHash"),solid.getString("sourceHash"));
        assertTrue(solid.getJSONArray("occupiedCells").length()>8);
        assertEquals(solid.toString(),store.reconstruct(id).toString());
        assertArrayEquals(before,Files.readAllBytes(ply.toPath()));assertArrayEquals(beforeMetadata,Files.readAllBytes(metadata.toPath()));
        assertFalse(solid.toString().contains(temporary.getRoot().getPath()));
    }

    @Test public void encryptedInteriorUsesAllVerifiedPointsWithoutEditingOriginals() throws Exception {
        DepthCloud.Snapshot snapshot=shell(true);CaptureStore store=store(open(manager()));String id=save(store,"container_interior",snapshot);
        double[] seed=snapshot.envelope.projectMm(new float[]{.1f,.1f,.1f}), top=snapshot.envelope.projectMm(new float[]{.1f,.1f,.1975f});
        int axis=0;for(int a=1;a<3;a++)if(Math.abs(top[a]-seed[a])>Math.abs(top[axis]-seed[axis]))axis=a;
        byte[] before=Files.readAllBytes(file(workspace,id,"points.ply.sealed").toPath());
        JSONObject preview=store.preview(id), cavity=store.reconstructInterior(id,axis,top[axis]>seed[axis]?1:-1,seed);
        assertEquals(preview.getString("sourceHash"),cavity.getString("sourceHash"));
        assertEquals(preview.getInt("pointCount"),cavity.getInt("sourcePointCount"));
        assertTrue(cavity.getJSONArray("freeCells").length()>8);assertFalse(cavity.has("occupiedCells"));
        assertArrayEquals(before,Files.readAllBytes(file(workspace,id,"points.ply.sealed").toPath()));
    }

    @Test public void freshNoncesAreUsedForEveryFileAndCapture() throws Exception {
        CaptureStore store=store(open(manager()));String a=save(store,"item",shell(false)), b=save(store,"item",shell(false));
        byte[] first=Files.readAllBytes(file(workspace,a,"points.ply.sealed").toPath()), second=Files.readAllBytes(file(workspace,b,"points.ply.sealed").toPath());
        byte[] metadata=Files.readAllBytes(file(workspace,a,"capture.json.sealed").toPath());
        assertFalse(Arrays.equals(Arrays.copyOfRange(first,4,16),Arrays.copyOfRange(second,4,16)));
        assertFalse(Arrays.equals(Arrays.copyOfRange(first,4,16),Arrays.copyOfRange(metadata,4,16)));
        assertEquals(store.preview(a).getString("sourceHash"),store.preview(b).getString("sourceHash"));
    }

    @Test public void anyEnvelopeRegionTamperingTruncationOrOversizeFailsBeforeGeometry() throws Exception {
        CaptureStore store=store(open(manager()));String id=save(store,"item",shell(false));
        for(String name:new String[]{"points.ply.sealed","capture.json.sealed"}) {
            File file=file(workspace,id,name);byte[] original=Files.readAllBytes(file.toPath());
            for(int offset:new int[]{0,3,4,15,16,original.length/2,original.length-1}) {
                byte[] altered=original.clone();altered[offset]^=1;Files.write(file.toPath(),altered);
                assertThrows(IOException.class,()->store.preview(id));
                assertThrows(IOException.class,()->store.reconstruct(id));
            }
            for(int length:new int[]{0,3,16,31,original.length-1}) {
                Files.write(file.toPath(),Arrays.copyOf(original,length));assertThrows(IOException.class,()->store.preview(id));
            }
            try(RandomAccessFile out=new RandomAccessFile(file,"rw")) { out.setLength((name.startsWith("points")?8000000:20000)+CaptureScopeManager.SEALED_OVERHEAD+1L); }
            assertThrows(IOException.class,()->store.preview(id));
            Files.write(file.toPath(),original);
        }
        assertNotNull(store.preview(id));
    }

    @Test public void ciphertextCannotBeMovedAcrossWorkspaceAccountCaptureOrFileIdentity() throws Exception {
        CaptureScopeManager manager=manager();CaptureStore first=store(open(manager));String id=save(first,"item",shell(false));
        byte[] ply=Files.readAllBytes(file(workspace,id,"points.ply.sealed").toPath()), metadata=Files.readAllBytes(file(workspace,id,"capture.json.sealed").toPath());
        String anotherWorkspace=UUID.randomUUID().toString();CaptureStore another=store(manager.openWorkspace(manager.revision(),anotherWorkspace,account,key));
        File destination=file(anotherWorkspace,id,"points.ply.sealed").getParentFile();assertTrue(destination.mkdir());
        Files.write(new File(destination,"points.ply.sealed").toPath(),ply);Files.write(new File(destination,"capture.json.sealed").toPath(),metadata);
        assertThrows(IOException.class,()->another.preview(id));
        CaptureStore otherAccount=store(manager.openWorkspace(manager.revision(),workspace,UUID.randomUUID().toString(),key));
        assertThrows(IOException.class,()->otherAccount.preview(id));
        CaptureScopeManager.Access access=open(manager);CaptureStore original=store(access);
        byte[] plain="capture body".getBytes(StandardCharsets.UTF_8), sealed=access.seal(id,"points.ply",plain);
        assertThrows(IOException.class,()->access.unseal(UUID.randomUUID().toString(),"points.ply",sealed));
        assertThrows(IOException.class,()->access.unseal(id,"capture.json",sealed));
        String differentId=UUID.randomUUID().toString();File moved=file(workspace,differentId,"points.ply.sealed").getParentFile();assertTrue(moved.mkdir());
        Files.write(new File(moved,"points.ply.sealed").toPath(),ply);Files.write(new File(moved,"capture.json.sealed").toPath(),metadata);
        assertThrows(IOException.class,()->original.preview(differentId));
        assertNotNull(original.preview(id));
    }

    @Test public void wrongKeyHasNoPlaintextFallbackAndOriginalKeyCanReopen() throws Exception {
        CaptureScopeManager manager=manager();CaptureStore first=store(open(manager));String id=save(first,"item",shell(false));String hash=first.preview(id).getString("sourceHash");
        byte[] wrong=key.clone();wrong[0]^=1;
        CaptureStore wrongStore=store(manager.openWorkspace(manager.revision(),workspace,account,wrong));
        assertThrows(IOException.class,()->wrongStore.preview(id));
        // Even a valid-looking plaintext sibling cannot bypass authentication.
        Files.write(file(workspace,id,"capture.json").toPath(),"{}".getBytes(StandardCharsets.UTF_8));
        assertThrows(IOException.class,()->wrongStore.preview(id));
        manager.lock();CaptureStore reopened=store(open(manager));assertEquals(hash,reopened.preview(id).getString("sourceHash"));
    }

    @Test public void clearAndDeleteStayWithinTheSelectedWorkspaceAndPreserveGuestBytes() throws Exception {
        CaptureStore guest=new CaptureStore(temporary.getRoot());String guestId=save(guest,"item",shell(false));
        File guestFile=new File(temporary.getRoot(),"packing-scans/"+guestId+"/points.ply");byte[] guestBytes=Files.readAllBytes(guestFile.toPath());
        CaptureScopeManager manager=manager();CaptureStore first=store(open(manager));String firstId=save(first,"item",shell(false));
        String secondWorkspace=UUID.randomUUID().toString(), secondAccount=UUID.randomUUID().toString();CaptureStore second=store(manager.openWorkspace(manager.revision(),secondWorkspace,secondAccount,key));
        String secondId=save(second,"item",shell(false));byte[] secondBytes=Files.readAllBytes(file(secondWorkspace,secondId,"points.ply.sealed").toPath());
        CaptureStore current=store(open(manager));assertFalse(current.delete(secondId));assertFalse(current.delete(guestId));
        File note=new File(file(workspace,firstId,"capture.json.sealed").getParentFile().getParentFile(),"note.txt");Files.write(note.toPath(),"preserve".getBytes(StandardCharsets.UTF_8));
        assertEquals(1,current.clear());assertTrue(note.exists());assertFalse(file(workspace,firstId,"points.ply.sealed").exists());
        assertArrayEquals(guestBytes,Files.readAllBytes(guestFile.toPath()));assertArrayEquals(secondBytes,Files.readAllBytes(file(secondWorkspace,secondId,"points.ply.sealed").toPath()));
        CaptureStore secondAgain=store(manager.openWorkspace(manager.revision(),secondWorkspace,secondAccount,key));assertNotNull(secondAgain.preview(secondId));
    }

    @Test public void closingOrSwitchingRefusesEveryOldOperationAndLateCallbacksCannotLockNewScope() throws Exception {
        CaptureScopeManager manager=manager();CaptureScopeManager.Access access=open(manager);CaptureStore first=store(access);String id=save(first,"item",shell(false));
        String old=access.lease();CaptureScopeManager.Access next=manager.selectGuest(manager.revision());
        assertFalse(manager.lock(old));assertSame(next,manager.access(next.lease()));
        assertThrows(IOException.class,()->first.preview(id));assertThrows(IOException.class,()->first.reconstruct(id));
        assertThrows(IOException.class,()->first.reconstructInterior(id,0,1,new double[]{1,1,1}));
        assertThrows(IOException.class,()->first.delete(id));assertThrows(IOException.class,first::clear);
        assertThrows(IOException.class,()->first.save("item",shell(false)));assertThrows(IOException.class,access::touch);
        assertThrows(IOException.class,()->manager.openWorkspace(old,workspace,account,key));
        assertTrue(file(workspace,id,"points.ply.sealed").isFile());
        assertTrue(manager.lock(next.lease()));assertThrows(IOException.class,()->manager.access(next.lease()));
    }

    @Test public void aQueuedOldStoreCannotReadDeleteOrWriteIntoTheNextSelection() throws Exception {
        CaptureScopeManager manager=manager();CaptureStore first=store(open(manager));String id=save(first,"item",shell(false));
        ExecutorService executor=Executors.newSingleThreadExecutor();CountDownLatch release=new CountDownLatch(1);
        try {
            Future<?> blocker=executor.submit(()->{ try { assertTrue(release.await(10,TimeUnit.SECONDS)); } catch(InterruptedException error) { throw new RuntimeException(error); } });
            Future<?> late=executor.submit(()->{
                assertThrows(IOException.class,()->first.preview(id));assertThrows(IOException.class,()->first.delete(id));
                assertThrows(IOException.class,()->first.save("item",shell(false)));
            });
            String otherWorkspace=UUID.randomUUID().toString();CaptureStore second=store(manager.openWorkspace(manager.revision(),otherWorkspace,account,key));String otherId=save(second,"item",shell(false));
            release.countDown();blocker.get(10,TimeUnit.SECONDS);late.get(10,TimeUnit.SECONDS);
            assertTrue(file(workspace,id,"points.ply.sealed").isFile());assertNotNull(second.preview(otherId));
        } finally { release.countDown();executor.shutdownNow(); }
    }

    @Test public void invalidSelectionDoesNotRevokeAnOpenedScopeAndProcessRestartStartsLocked() throws Exception {
        CaptureScopeManager manager=manager();CaptureScopeManager.Access access=open(manager);String lease=access.lease();
        assertThrows(IOException.class,()->manager.openWorkspace(lease,"../private",account,key));
        assertThrows(IOException.class,()->manager.openWorkspace(lease,workspace,"not-an-account",key));
        assertThrows(IOException.class,()->manager.openWorkspace(lease,workspace,account,new byte[31]));
        assertThrows(IOException.class,()->manager.openWorkspace(lease,workspace,account,null));
        assertSame(access,manager.access(lease));
        CaptureScopeManager restarted=manager();assertThrows(IOException.class,()->restarted.access(lease));
        assertThrows(IOException.class,()->restarted.selectGuest(lease));
        assertThrows(IOException.class,()->new CaptureStore(temporary.newFolder(),access));
        assertThrows(IOException.class,()->new CaptureStore(temporary.getRoot(),null));
    }

    @Test public void idleExpiryErasesOwnedKeyAndOnlyExplicitInteractionRenewsIt() throws Exception {
        final long[] now={100};CaptureScopeManager manager=new CaptureScopeManager(temporary.getRoot(),()->now[0]);CaptureScopeManager.Access access=open(manager);
        Field field=access.getClass().getDeclaredField("key");field.setAccessible(true);byte[] owned=(byte[])field.get(access);
        assertNotSame(key,owned);assertArrayEquals(key,owned);
        now[0]+=CaptureScopeManager.IDLE_TIMEOUT_MS-1;access.check();access.touch();
        now[0]+=CaptureScopeManager.IDLE_TIMEOUT_MS-1;access.check();
        now[0]++;assertThrows(IOException.class,access::check);assertArrayEquals(new byte[32],owned);
        assertFalse(manager.lock(access.lease()));assertFalse(Arrays.equals(key,owned));
        CaptureScopeManager.Access guest=manager.selectGuest(manager.revision());now[0]+=CaptureScopeManager.IDLE_TIMEOUT_MS*10;guest.check();
    }

    @Test public void copiedBorrowedKeySurvivesCallerWipingButIsErasedOnExplicitLock() throws Exception {
        CaptureScopeManager manager=manager();byte[] borrowed=key.clone();CaptureScopeManager.Access access=manager.openWorkspace(manager.revision(),workspace,account,borrowed);
        Arrays.fill(borrowed,(byte)0);CaptureStore store=store(access);String id=save(store,"item",shell(false));assertNotNull(store.preview(id));
        Field field=access.getClass().getDeclaredField("key");field.setAccessible(true);byte[] owned=(byte[])field.get(access);
        manager.lock();assertArrayEquals(new byte[32],owned);assertThrows(IOException.class,()->store.preview(id));
        assertNotNull(store(open(manager)).preview(id));
    }

    @Test public void expiryBetweenPointAndMetadataWritesRollsBackOnlyTheNewCapture() throws Exception {
        CaptureStore guest=new CaptureStore(temporary.getRoot());String guestId=save(guest,"item",shell(false));
        final boolean[] expireAfterPoints={false};
        CaptureScopeManager manager=new CaptureScopeManager(temporary.getRoot(),()->{
            File scope=new File(temporary.getRoot(),"packing-scans-protected/"+workspace);File[] folders=scope.listFiles();
            if(expireAfterPoints[0]&&folders!=null)for(File folder:folders)
                if(new File(folder,"points.ply.sealed").isFile())return CaptureScopeManager.IDLE_TIMEOUT_MS;
            return 0;
        });
        CaptureStore protectedStore=store(open(manager));expireAfterPoints[0]=true;
        assertThrows(IOException.class,()->protectedStore.save("item",shell(false)));
        assertEquals(0,new File(temporary.getRoot(),"packing-scans-protected/"+workspace).list().length);
        assertNotNull(guest.preview(guestId));
    }
}
