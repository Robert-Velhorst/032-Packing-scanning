package com.packingscanning.app.scanning;

import org.json.JSONObject;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import java.io.File;
import java.nio.file.Files;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import static org.junit.Assert.*;

public class CaptureInteriorTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();

    private static DepthCloud.Snapshot openBag(boolean missingFloor) {
        DepthCloud cloud=new DepthCloud(.5);List<Float> values=new ArrayList<>();
        for(int z=0;z<36;z++)for(int y=0;y<44;y++)for(int x=0;x<50;x++){
            if(x==0||x==49||y==0||y==43||(!missingFloor&&z==0)){
                values.add(.0025f+x*.005f);values.add(.0025f+y*.005f);values.add(.0025f+z*.005f);values.add(.95f);
            }
        }
        float[] points=new float[values.size()];for(int i=0;i<points.length;i++)points[i]=values.get(i);
        for(int frame=0;frame<6;frame++)cloud.addFrame(frame+1,points,new float[]{(float)Math.sin(frame*Math.PI/3),0,(float)Math.cos(frame*Math.PI/3)});
        return cloud.snapshot();
    }
    private static int[] entry(ScanEnvelope envelope) {
        double[] seed=envelope.projectMm(new float[]{.125f,.11f,.09f});
        double[] top=envelope.projectMm(new float[]{.125f,.11f,.1775f});
        int axis=0;for(int a=1;a<3;a++)if(Math.abs(top[a]-seed[a])>Math.abs(top[axis]-seed[axis]))axis=a;
        return new int[]{axis,top[axis]>seed[axis]?1:-1};
    }
    @Test public void readsEveryPrivatePointPreservingSourceMetadataAndBytes() throws Exception {
        DepthCloud.Snapshot capture=openBag(false);CaptureStore store=new CaptureStore(temporary.getRoot());JSONObject saved=store.save("container_interior",capture);String id=saved.getJSONObject("record").getString("id");
        File folder=new File(temporary.getRoot(),"packing-scans/"+id),ply=new File(folder,"points.ply"),metadata=new File(folder,"capture.json");
        byte[] before=Files.readAllBytes(ply.toPath()),beforeMetadata=Files.readAllBytes(metadata.toPath());
        ScanEnvelope envelope=capture.envelope;int[] entry=entry(envelope);double[] seed=envelope.projectMm(new float[]{.125f,.11f,.09f});
        JSONObject preview=store.preview(id),cavity=store.reconstructInterior(id,entry[0],entry[1],seed);
        assertEquals(8000,preview.getInt("samplePointCount"));assertTrue(cavity.getInt("sourcePointCount")>8000);
        assertEquals(preview.getInt("pointCount"),cavity.getInt("sourcePointCount"));assertEquals(preview.getString("sourceHash"),cavity.getString("sourceHash"));
        assertEquals("voxel_cavity_v1",cavity.getString("format"));assertEquals(VoxelCavity.METHOD,cavity.getString("method"));assertEquals("container_interior",cavity.getString("target"));
        assertTrue(cavity.getJSONArray("freeCells").length()>8);assertTrue(cavity.getJSONObject("opening").getJSONArray("cells").length()>4);
        assertTrue(cavity.getInt("wallCellCount")>0);assertTrue(cavity.getDouble("estimatedVolumeMm3")>0);
        assertEquals(preview.getJSONObject("envelope").getJSONObject("dimensionsMm").toString(),cavity.getJSONObject("boundsMm").toString());
        assertFalse(cavity.has("occupiedCells"));assertFalse(cavity.toString().contains(temporary.getRoot().getPath()));
        assertEquals(cavity.toString(),store.reconstructInterior(id,entry[0],entry[1],seed).toString());
        assertArrayEquals(before,Files.readAllBytes(ply.toPath()));assertArrayEquals(beforeMetadata,Files.readAllBytes(metadata.toPath()));
    }
    @Test public void sourceMissingFloorIsRejectedWithoutRepairOrOverwrite() throws Exception {
        DepthCloud.Snapshot capture=openBag(true);CaptureStore store=new CaptureStore(temporary.getRoot());JSONObject saved=store.save("container_interior",capture);String id=saved.getJSONObject("record").getString("id");
        ScanEnvelope envelope=capture.envelope;int[] entry=entry(envelope);double[] seed=envelope.projectMm(new float[]{.125f,.11f,.09f});
        File ply=new File(temporary.getRoot(),"packing-scans/"+id+"/points.ply");byte[] before=Files.readAllBytes(ply.toPath());
        assertThrows(VoxelCavity.ReconstructionRejected.class,()->store.reconstructInterior(id,entry[0],entry[1],seed));assertArrayEquals(before,Files.readAllBytes(ply.toPath()));
    }
    @Test public void rejectsItemSourcesTraversalAndMissingSource() throws Exception {
        CaptureStore store=new CaptureStore(temporary.getRoot());JSONObject saved=store.save("item",openBag(false));String id=saved.getJSONObject("record").getString("id");
        assertThrows(java.io.IOException.class,()->store.reconstructInterior(id,2,1,new double[]{100,100,50}));
        assertThrows(java.io.IOException.class,()->store.reconstructInterior("../private",2,1,new double[]{100,100,50}));
        assertThrows(java.io.IOException.class,()->store.reconstructInterior("00000000-0000-0000-0000-000000000000",2,1,new double[]{100,100,50}));
    }
    @Test public void rejectsInsufficientCoverageAndChangedMetadataRatherThanAcceptingPreview() throws Exception {
        DepthCloud.Snapshot capture=openBag(false);CaptureStore store=new CaptureStore(temporary.getRoot());JSONObject saved=store.save("container_interior",capture);String id=saved.getJSONObject("record").getString("id");
        ScanEnvelope envelope=capture.envelope;int[] entry=entry(envelope);double[] seed=envelope.projectMm(new float[]{.125f,.11f,.09f});
        File metadata=new File(temporary.getRoot(),"packing-scans/"+id+"/capture.json");
        saved.getJSONObject("record").getJSONObject("quality").put("depthFrames",2);Files.write(metadata.toPath(),saved.toString().getBytes(StandardCharsets.UTF_8));
        assertThrows(java.io.IOException.class,()->store.reconstructInterior(id,entry[0],entry[1],seed));
        saved.getJSONObject("record").getJSONObject("quality").put("depthFrames",6);saved.getJSONObject("dimensionsMm").put("length",1);Files.write(metadata.toPath(),saved.toString().getBytes(StandardCharsets.UTF_8));
        assertThrows(java.io.IOException.class,()->store.reconstructInterior(id,entry[0],entry[1],seed));
    }
}
