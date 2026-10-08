package com.packingscanning.app.scanning;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import static org.junit.Assert.*;

public class VoxelSolidTest {
    interface Shape { boolean contains(int x,int y,int z); }
    private static List<double[]> shell(int nx,int ny,int nz,Shape shape) {
        List<double[]> points=new ArrayList<>();int[][] dirs={{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}};
        for(int z=0;z<nz;z++)for(int y=0;y<ny;y++)for(int x=0;x<nx;x++)if(shape.contains(x,y,z)){
            boolean boundary=false;for(int[] d:dirs)boundary|=!shape.contains(x+d[0],y+d[1],z+d[2]);
            if(boundary)points.add(new double[]{x*10+5,y*10+5,z*10+5});
        }
        return points;
    }
    private static Shape box(int nx,int ny,int nz){return (x,y,z)->x>=0&&x<nx&&y>=0&&y<ny&&z>=0&&z<nz;}

    @Test public void fillsClosedShellWithExactVolumeAndOutwardClosedManifoldSurface() {
        VoxelSolid solid=VoxelSolid.reconstruct(shell(6,6,6,box(6,6,6)),new double[]{60,60,60});
        assertEquals(216,solid.occupiedCells.length);assertEquals(152,solid.observedCellCount);assertEquals(64,solid.enclosedCellCount);assertEquals(216,solid.faceCount);assertEquals(10,solid.resolutionMm,0);
    }
    @Test public void preservesExteriorConnectedUConcavityRatherThanFillingItsBox() {
        Shape outer=box(12,10,6),u=(x,y,z)->outer.contains(x,y,z)&&(x<4||x>=8||y<3);
        VoxelSolid solid=VoxelSolid.reconstruct(shell(12,10,6,u),new double[]{120,100,60});
        assertEquals(552,solid.occupiedCells.length);
        assertTrue(Arrays.binarySearch(solid.occupiedCells,5+12*(1+10*3))>=0);
        assertTrue(Arrays.binarySearch(solid.occupiedCells,5+12*(5+10*3))<0);
    }
    @Test public void leavesSourceAndOrderUnchangedAndReturnsRepeatableGeometry() {
        List<double[]> source=shell(6,6,6,box(6,6,6));List<double[]> reversed=new ArrayList<>(source);Collections.reverse(reversed);
        VoxelSolid a=VoxelSolid.reconstruct(source,new double[]{60,60,60}),b=VoxelSolid.reconstruct(reversed,new double[]{60,60,60});
        assertArrayEquals(a.occupiedCells,b.occupiedCells);assertEquals(5,source.get(0)[0],0);assertSame(source.get(source.size()-1),reversed.get(0));
    }
    @Test public void doesNotPatchAnOpenFaceOrInventInteriorFromSparsePoints() {
        List<double[]> points=shell(6,6,6,box(6,6,6));points.removeIf(p->p[2]>50);
        try {VoxelSolid.reconstruct(points,new double[]{60,60,60});fail("Open shell accepted");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("does not enclose"));}
    }
    @Test public void rejectsSeveralDisconnectedObjectsWithoutRemovingAnyComponent() {
        Shape both=(x,y,z)->y>=0&&y<6&&z>=0&&z<6&&((x>=0&&x<6)||(x>=9&&x<15));
        try {VoxelSolid.reconstruct(shell(15,6,6,both),new double[]{150,60,60});fail("Disconnected source accepted");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("disconnected"));}
    }
    @Test public void boundsGridMemoryAndReportsCoarserSamplingRatherThanClaimingOriginalResolution() {
        List<double[]> points=shell(6,6,6,box(6,6,6));for(double[] p:points)for(int i=0;i<3;i++)p[i]*=20;
        // Sparse observations at this coarser spacing are not a sealed shell.
        try {VoxelSolid.reconstruct(points,new double[]{1200,1200,1200});fail("Sparse source accepted");}catch(IllegalStateException expected){assertTrue(expected.getMessage().contains("does not enclose"));}
    }
    @Test public void rejectsMalformedBoundsPointsAndOverlargeSources() {
        List<double[]> points=shell(6,6,6,box(6,6,6));
        assertThrows(IllegalArgumentException.class,()->VoxelSolid.reconstruct(Collections.nCopies(DepthCloud.MAX_POINTS+1,new double[]{5,5,5}),new double[]{60,60,60}));
        for(double[] bounds:new double[][]{{Double.NaN,60,60},{0,60,60},{10001,60,60}}){try{VoxelSolid.reconstruct(points,bounds);fail("Invalid bounds accepted");}catch(IllegalArgumentException expected){}}
        points.set(0,new double[]{Double.POSITIVE_INFINITY,1,1});
        try{VoxelSolid.reconstruct(points,new double[]{60,60,60});fail("Invalid point accepted");}catch(IllegalArgumentException expected){}
    }
    @Test public void rejectsNonManifoldEdgeContactInAnOtherwiseConnectedShell() {
        Shape outer=box(6,6,6),shape=(x,y,z)->outer.contains(x,y,z)&&!((x==2&&y==2)||(x==3&&y==3));
        VoxelSolid.ReconstructionRejected error=assertThrows(VoxelSolid.ReconstructionRejected.class,()->VoxelSolid.reconstruct(shell(6,6,6,shape),new double[]{60,60,60}));
        assertTrue(error.getMessage().contains("edge contacts"));
    }
}
