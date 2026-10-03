package com.packingscanning.app.scanning;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class CaptureRetentionTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private long now=1790856000000L;
    private static final long DAY=86400000L;
    private DepthCloud.Snapshot fixture(){DepthCloud cloud=new DepthCloud(.5);for(int f=0;f<6;f++){float[] points=new float[1600];int n=0;for(int x=0;x<20;x++)for(int y=0;y<20;y++){points[n++]=x*.008f;points[n++]=y*.008f;points[n++]=x%2==0?-.03f:.03f;points[n++]=.9f;}cloud.addFrame(f+1,points,new float[]{(float)Math.sin(f*Math.PI/3),0,(float)Math.cos(f*Math.PI/3)});}return cloud.snapshot();}
    private CaptureScopeManager manager()throws Exception{return new CaptureScopeManager(temporary.getRoot());}
    private CaptureStore store(CaptureScopeManager.Access access)throws Exception{return new CaptureStore(temporary.getRoot(),access,()->now);}
    private String save(CaptureStore store)throws Exception{return store.save("item",fixture()).getJSONObject("record").getString("id");}
    private File file(String id,String name){return new File(temporary.getRoot(),"packing-scans/"+id+"/"+name);}
    private File protectedFile(String ws,String id,String name){return new File(temporary.getRoot(),"packing-scans-protected/"+ws+"/"+id+"/"+name);}

    @Test public void removesAtAgeBoundaryAndRetainsExactProvenanceAndRecentSources()throws Exception{
        CaptureScopeManager m=manager();CaptureStore s=store(m.selectGuest(m.revision()));String old=save(s);byte[] metadata=Files.readAllBytes(file(old,"capture.json").toPath());now+=DAY;String recent=save(s);now+=6*DAY;
        JSONObject r=s.pruneExpiredSources(7,null);assertEquals(1,r.getInt("deletedCount"));assertEquals(old,r.getJSONArray("removedIds").getString(0));assertFalse(file(old,"points.ply").exists());assertTrue(file(recent,"points.ply").isFile());assertArrayEquals(metadata,Files.readAllBytes(file(old,"capture.json").toPath()));
        assertEquals(0,r.getInt("skippedCount"));assertEquals(0,r.getInt("failedCount"));
    }
    @Test public void repeatsMissingSourceConfirmationsWithoutClaimingAnotherDeletion()throws Exception{
        CaptureScopeManager m=manager();CaptureStore s=store(m.selectGuest(m.revision()));String id=save(s);now+=8*DAY;
        assertEquals(1,s.pruneExpiredSources(7,null).getInt("deletedCount"));JSONObject again=s.pruneExpiredSources(7,null);assertEquals(0,again.getInt("deletedCount"));assertEquals(id,again.getJSONArray("removedIds").getString(0));assertThrows(Exception.class,()->s.preview(id));assertTrue(s.delete(id));
    }
    @Test public void neverUsesAnotherWorkspaceOrGuestForProtectedCleanup()throws Exception{
        CaptureScopeManager m=manager();CaptureStore guest=store(m.selectGuest(m.revision()));String guestId=save(guest),a=UUID.randomUUID().toString(),b=UUID.randomUUID().toString(),account=UUID.randomUUID().toString();byte[] key=new byte[32];
        CaptureStore first=store(m.openWorkspace(m.revision(),a,account,key));String firstId=save(first);byte[] provenance=Files.readAllBytes(protectedFile(a,firstId,"capture.json.sealed").toPath());
        CaptureStore second=store(m.openWorkspace(m.revision(),b,account,key));String secondId=save(second);now+=8*DAY;
        CaptureStore current=store(m.openWorkspace(m.revision(),a,account,key));assertEquals(1,current.pruneExpiredSources(7,null).getInt("deletedCount"));assertTrue(file(guestId,"points.ply").isFile());assertTrue(protectedFile(b,secondId,"points.ply.sealed").isFile());assertFalse(protectedFile(a,firstId,"points.ply.sealed").exists());assertArrayEquals(provenance,Files.readAllBytes(protectedFile(a,firstId,"capture.json.sealed").toPath()));assertThrows(IOException.class,()->first.pruneExpiredSources(7,null));
    }
    @Test public void authenticationAndLiveAuthorityAreRequiredWithoutGuestFallback()throws Exception{
        CaptureScopeManager m=manager();String ws=UUID.randomUUID().toString(),account=UUID.randomUUID().toString();byte[] key=new byte[32];CaptureStore original=store(m.openWorkspace(m.revision(),ws,account,key));String id=save(original);now+=8*DAY;
        CaptureStore wrongAccount=store(m.openWorkspace(m.revision(),ws,UUID.randomUUID().toString(),key));assertEquals(1,wrongAccount.pruneExpiredSources(7,null).getInt("skippedCount"));assertTrue(protectedFile(ws,id,"points.ply.sealed").isFile());
        key[0]=1;CaptureStore wrongKey=store(m.openWorkspace(m.revision(),ws,account,key));assertEquals(0,wrongKey.pruneExpiredSources(7,null).getInt("deletedCount"));m.lock();assertThrows(IOException.class,()->wrongKey.pruneExpiredSources(7,null));assertTrue(protectedFile(ws,id,"points.ply.sealed").isFile());
        assertThrows(IOException.class,()->new CaptureStore(temporary.getRoot()).pruneExpiredSources(7,null));
    }
    @Test public void refusesUnestablishedAgeAndIncompleteOrMismatchedMetadata()throws Exception{
        CaptureScopeManager m=manager();CaptureStore s=store(m.selectGuest(m.revision()));String id=save(s);byte[] original=Files.readAllBytes(file(id,"capture.json").toPath());now+=8*DAY;
        for(String date:new String[]{"2026-02-30T00:00:00.000Z","2100-01-01T00:00:00.000Z","2026-01-01T00:00:00.000Zjunk"}){JSONObject edited=new JSONObject(new String(original,StandardCharsets.UTF_8));edited.getJSONObject("record").put("createdAt",date);Files.write(file(id,"capture.json").toPath(),edited.toString().getBytes(StandardCharsets.UTF_8));assertEquals(1,s.pruneExpiredSources(7,null).getInt("skippedCount"));assertTrue(file(id,"points.ply").isFile());}
        JSONObject edited=new JSONObject(new String(original,StandardCharsets.UTF_8));edited.getJSONObject("record").put("id",UUID.randomUUID().toString());Files.write(file(id,"capture.json").toPath(),edited.toString().getBytes(StandardCharsets.UTF_8));assertEquals(0,s.pruneExpiredSources(7,null).getInt("deletedCount"));Files.write(file(id,"capture.json").toPath(),new byte[]{1});assertEquals(1,s.pruneExpiredSources(7,null).getInt("skippedCount"));assertTrue(file(id,"points.ply").isFile());
    }
    @Test public void validatesPeriodsCursorsAndCanonicalSourceLocationsBeforeRemoval()throws Exception{
        CaptureScopeManager m=manager();CaptureStore s=store(m.selectGuest(m.revision()));String id=save(s);now+=100*DAY;
        for(int days:new int[]{-1,0,1,6,8,100,Integer.MAX_VALUE})assertThrows(IOException.class,()->s.pruneExpiredSources(days,null));assertThrows(IOException.class,()->s.pruneExpiredSources(7,"../other"));assertTrue(file(id,"points.ply").isFile());
        Files.delete(file(id,"points.ply").toPath());assertTrue(file(id,"points.ply").mkdir());assertEquals(1,s.pruneExpiredSources(7,null).getInt("failedCount"));assertTrue(file(id,"points.ply").isDirectory());
    }
    @Test public void boundsEachPassAndContinuesWithoutDeletingUnrelatedFiles()throws Exception{
        CaptureScopeManager m=manager();CaptureStore s=store(m.selectGuest(m.revision()));for(int i=0;i<101;i++)save(s);File keep=new File(temporary.getRoot(),"keep.txt");Files.write(keep.toPath(),new byte[]{42});now+=91*DAY;
        JSONObject first=s.pruneExpiredSources(90,null);assertEquals(100,first.getInt("checkedCount"));assertEquals(100,first.getInt("deletedCount"));JSONObject second=s.pruneExpiredSources(90,first.getString("nextCursor"));assertEquals(1,second.getInt("deletedCount"));assertTrue(second.isNull("nextCursor"));assertArrayEquals(new byte[]{42},Files.readAllBytes(keep.toPath()));
    }
    @Test public void removesPointPartialsButDoesNotRenewTheWorkspaceIdleWindow()throws Exception{
        long[] tick={0};CaptureScopeManager m=new CaptureScopeManager(temporary.getRoot(),()->tick[0]);CaptureStore s=store(m.openWorkspace(m.revision(),UUID.randomUUID().toString(),UUID.randomUUID().toString(),new byte[32]));JSONObject r=s.save("item",fixture());String id=r.getJSONObject("record").getString("id"),ws=m.access(m.state().lease).workspaceId();File partial=protectedFile(ws,id,"points.ply.sealed.partial");Files.write(partial.toPath(),new byte[]{1});now+=8*DAY;
        assertEquals(1,s.pruneExpiredSources(7,null).getInt("deletedCount"));assertFalse(partial.exists());tick[0]=CaptureScopeManager.IDLE_TIMEOUT_MS;assertThrows(IOException.class,()->s.pruneExpiredSources(7,null));assertNull(m.state().lease);
    }
}
