package com.packingscanning.app.scanning;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import static org.junit.Assert.*;

public class CaptureStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    private static DepthCloud.Snapshot fixture() { return fixture(null); }

    private static DepthCloud.Snapshot fixture(CaptureGuidance guidance) {
        DepthCloud cloud = guidance==null?new DepthCloud(0.5):new DepthCloud(0.5,guidance);
        for (int frame = 0; frame < 6; frame++) {
            float[] points = new float[20 * 20 * 4]; int n = 0;
            for (int x = 0; x < 20; x++) for (int y = 0; y < 20; y++) {
                points[n++] = x * 0.008f; points[n++] = y * 0.008f; points[n++] = x % 2 == 0 ? -0.03f : 0.03f; points[n++] = 0.9f;
            }
            if(guidance!=null)guidance.depth(frame+1,100,0);
            cloud.addFrame(frame + 1,points,new float[] {(float) Math.sin(frame * Math.PI / 3),0,(float) Math.cos(frame * Math.PI / 3)});
        }
        return cloud.snapshot();
    }

    @Test public void savesActualPlyAndMetadataAndDeletesOnlySelectedCapture() throws Exception {
        CaptureStore store = new CaptureStore(temporary.getRoot());
        JSONObject saved = store.save("item",fixture());
        String id = saved.getJSONObject("record").getString("id");
        File folder = new File(temporary.getRoot(),"packing-scans/" + id);
        String ply = new String(Files.readAllBytes(new File(folder,"points.ply").toPath()),StandardCharsets.UTF_8);
        assertTrue(ply.startsWith("ply\nformat ascii 1.0"));
        assertTrue(ply.contains("element vertex 400\n"));
        assertFalse(new File(folder,"points.ply.partial").exists());
        JSONObject stored = new JSONObject(new String(Files.readAllBytes(new File(folder,"capture.json").toPath()),StandardCharsets.UTF_8));
        assertEquals(400,stored.getJSONObject("record").getJSONObject("geometry").getInt("pointCount"));
        assertEquals(157,stored.getJSONObject("dimensionsMm").getDouble("length"),0.001);
        File unrelated = new File(temporary.getRoot(),"preserve.txt"); Files.write(unrelated.toPath(),"Keep me".getBytes(StandardCharsets.UTF_8));
        assertTrue(store.delete(id)); assertFalse(folder.exists()); assertTrue(unrelated.exists());
        assertFalse(store.delete(id));
    }

    @Test public void rejectsTraversalAndDoesNotClearUnrelatedFiles() throws Exception {
        CaptureStore store = new CaptureStore(temporary.getRoot());
        assertThrows(java.io.IOException.class,() -> store.delete("../../preserve"));
        assertThrows(java.io.IOException.class,() -> store.delete("00000000-0-0-0-000000000000"));
        File note = new File(temporary.getRoot(),"packing-scans/note.txt"); Files.write(note.toPath(),"Keep me".getBytes(StandardCharsets.UTF_8));
        File malformed = new File(temporary.getRoot(),"packing-scans/" + "-".repeat(36)); assertTrue(malformed.mkdir());
        File uuidNamedNote = new File(temporary.getRoot(),"packing-scans/" + UUID.randomUUID()); Files.write(uuidNamedNote.toPath(),"Keep me too".getBytes(StandardCharsets.UTF_8));
        store.save("container_interior",fixture());
        assertEquals(1,store.clear()); assertTrue(note.exists()); assertTrue(malformed.exists()); assertTrue(uuidNamedNote.exists());
    }

    @Test public void invalidTargetCreatesNoCapture() throws Exception {
        CaptureStore store = new CaptureStore(temporary.getRoot());
        assertThrows(java.io.IOException.class,() -> store.save("outer_bag",fixture()));
        assertEquals(0,new File(temporary.getRoot(),"packing-scans").list().length);
    }

    @Test public void previewReadsTheOriginalSourceAndReportsItsUneditedEnvelope() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());
        JSONObject saved=store.save("item",fixture());String id=saved.getJSONObject("record").getString("id");
        JSONObject preview=store.preview(id);
        assertEquals(id,preview.getString("id"));assertEquals("item",preview.getString("target"));
        assertEquals(400,preview.getInt("pointCount"));assertEquals(1600,preview.getJSONArray("pointsMm").length());
        assertEquals(ScanEnvelope.METHOD,preview.getJSONObject("envelope").getString("method"));
        assertEquals(2.5,preview.getJSONObject("envelope").getDouble("paddingMm"),0);
        assertTrue(preview.getString("sourceHash").matches("[0-9a-f]{64}"));
        assertEquals(157,preview.getJSONObject("envelope").getJSONObject("dimensionsMm").getDouble("length"),.01);
        byte[] before=Files.readAllBytes(new File(temporary.getRoot(),"packing-scans/"+id+"/points.ply").toPath());
        assertEquals(preview.toString(),store.preview(id).toString());
        assertArrayEquals(before,Files.readAllBytes(new File(temporary.getRoot(),"packing-scans/"+id+"/points.ply").toPath()));
        store.delete(id);assertThrows(java.io.IOException.class,()->store.preview(id));
    }
    @Test public void previewDoesNotReadTraversalMismatchedTargetsOrAlteredPointFiles() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());
        assertThrows(java.io.IOException.class,()->store.preview("../private"));
        JSONObject saved=store.save("item",fixture());String id=saved.getJSONObject("record").getString("id");
        File ply=new File(temporary.getRoot(),"packing-scans/"+id+"/points.ply");
        String original=new String(Files.readAllBytes(ply.toPath()),StandardCharsets.UTF_8);
        Files.write(ply.toPath(),original.replace("element vertex 400","element vertex 60001").getBytes(StandardCharsets.UTF_8));
        assertThrows(java.io.IOException.class,()->store.preview(id));
        Files.write(ply.toPath(),original.replaceFirst("0.9","NaN").getBytes(StandardCharsets.UTF_8));
        assertThrows(java.io.IOException.class,()->store.preview(id));
        Files.write(ply.toPath(),original.getBytes(StandardCharsets.UTF_8));
        File metadata=new File(temporary.getRoot(),"packing-scans/"+id+"/capture.json");
        saved.getJSONObject("record").put("id",UUID.randomUUID().toString());Files.write(metadata.toPath(),saved.toString().getBytes(StandardCharsets.UTF_8));
        assertThrows(java.io.IOException.class,()->store.preview(id));
    }
    private static DepthCloud.Snapshot closedShell() {
        DepthCloud cloud=new DepthCloud(.5);int side=40,count=side*side*side-(side-2)*(side-2)*(side-2);float[] points=new float[count*4];int n=0;
        for(int z=0;z<side;z++)for(int y=0;y<side;y++)for(int x=0;x<side;x++)if(x==0||x==side-1||y==0||y==side-1||z==0||z==side-1){
            points[n++]=.0025f+x*.005f;points[n++]=.0025f+y*.005f;points[n++]=.0025f+z*.005f;points[n++]=.95f;
        }
        for(int frame=0;frame<6;frame++)cloud.addFrame(frame+1,points,new float[]{(float)Math.sin(frame*Math.PI/3),0,(float)Math.cos(frame*Math.PI/3)});
        return cloud.snapshot();
    }
    @Test public void reconstructionUsesFullPrivateSourceRatherThanEightThousandPointPreview() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());JSONObject saved=store.save("item",closedShell());String id=saved.getJSONObject("record").getString("id");
        File ply=new File(temporary.getRoot(),"packing-scans/"+id+"/points.ply"),metadata=new File(ply.getParentFile(),"capture.json");byte[] before=Files.readAllBytes(ply.toPath()),beforeMetadata=Files.readAllBytes(metadata.toPath());
        JSONObject preview=store.preview(id),solid=store.reconstruct(id);
        assertEquals(8000,preview.getInt("samplePointCount"));assertTrue(solid.getInt("sourcePointCount")>8000);
        assertEquals(preview.getInt("pointCount"),solid.getInt("sourcePointCount"));assertEquals(preview.getString("sourceHash"),solid.getString("sourceHash"));
        assertEquals(VoxelSolid.METHOD,solid.getString("method"));assertTrue(solid.getInt("enclosedCellCount")>=8);assertEquals("voxel_solid_v1",solid.getString("format"));
        assertEquals(solid.toString(),store.reconstruct(id).toString());assertArrayEquals(before,Files.readAllBytes(ply.toPath()));assertArrayEquals(beforeMetadata,Files.readAllBytes(metadata.toPath()));
        assertFalse(solid.toString().contains(temporary.getRoot().getPath()));
    }
    @Test public void reconstructionRejectsBagWallsTraversalAndUnavailableSource() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());JSONObject saved=store.save("container_interior",fixture());String id=saved.getJSONObject("record").getString("id");
        assertThrows(java.io.IOException.class,()->store.reconstruct(id));assertThrows(java.io.IOException.class,()->store.reconstruct("../private"));store.delete(id);assertThrows(java.io.IOException.class,()->store.reconstruct(id));
    }
    @Test public void oldCapturesCanBePreviewedWithoutRewritingTheirHistoricalDimensions() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());
        JSONObject saved=store.save("container_interior",fixture());String id=saved.getJSONObject("record").getString("id");
        saved.getJSONObject("record").getJSONObject("geometry").remove("envelope");
        saved.put("dimensionsMm",new JSONObject().put("length",152).put("width",152).put("height",60));
        File metadata=new File(temporary.getRoot(),"packing-scans/"+id+"/capture.json");Files.write(metadata.toPath(),saved.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject preview=store.preview(id);
        assertEquals("capture_aligned_legacy",preview.getJSONObject("envelope").getString("method"));
        assertEquals(152,preview.getJSONObject("envelope").getJSONObject("dimensionsMm").getDouble("length"),.01);
        assertEquals(saved.toString(),new String(Files.readAllBytes(metadata.toPath()),StandardCharsets.UTF_8));
    }
    @Test public void savesObservedDiagnosticsSeparatelyFromDimensionsAndOriginalPoints() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());
        JSONObject result=store.save("item",fixture(new CaptureGuidance()));
        JSONObject g=result.getJSONObject("record").getJSONObject("quality").getJSONObject("coverage");
        assertEquals(CaptureGuidance.METHOD,g.getString("method"));assertEquals(6,g.getInt("freshFrames"));
        assertEquals(600,g.getInt("examinedPixels"));assertEquals(0,g.getInt("confidentPixels"));assertEquals(15,g.getInt("sideMask"));
        assertEquals(157,result.getJSONObject("dimensionsMm").getDouble("length"),.001);
        assertTrue(result.getJSONArray("warnings").toString().contains("Few central sampled pixels"));
        assertTrue(result.getJSONArray("warnings").toString().contains("Higher or lower"));
        String id=result.getJSONObject("record").getString("id");
        JSONObject saved=new JSONObject(new String(Files.readAllBytes(new File(temporary.getRoot(),"packing-scans/"+id+"/capture.json").toPath()),StandardCharsets.UTF_8));
        assertEquals(g.toString(),saved.getJSONObject("record").getJSONObject("quality").getJSONObject("coverage").toString());
        assertEquals(2,new File(temporary.getRoot(),"packing-scans/"+id).list().length);
    }

}
