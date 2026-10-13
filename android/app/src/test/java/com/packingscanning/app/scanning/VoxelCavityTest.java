package com.packingscanning.app.scanning;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import static org.junit.Assert.*;

public class VoxelCavityTest {
    private static List<double[]> walls(int[] dimensions,double[] bounds,int axis,int sign) {
        List<double[]> result=new ArrayList<>();
        for(int z=0;z<dimensions[2];z++)for(int y=0;y<dimensions[1];y++)for(int x=0;x<dimensions[0];x++){
            int[] xyz={x,y,z};boolean wall=false;
            for(int a=0;a<3;a++)for(int s=-1;s<=1;s+=2)
                if(!(a==axis&&s==sign)&&xyz[a]==(s==1?dimensions[a]-1:0))wall=true;
            if(wall)result.add(new double[]{(x+.5)*bounds[0]/dimensions[0],(y+.5)*bounds[1]/dimensions[1],(z+.5)*bounds[2]/dimensions[2]});
        }
        return result;
    }
    private static List<double[]> box(){return walls(new int[]{12,10,8},new double[]{120,100,80},2,1);}
    private static VoxelCavity reconstruct(List<double[]> points){return VoxelCavity.reconstruct(points,new double[]{120,100,80},2,1,new double[]{85,55,45});}

    @Test public void everyReviewedEndBoundsOnlyTheSeededEmptyComponent() {
        int[] dims={12,10,8};double[] bounds={120,100,80};
        for(int axis=0;axis<3;axis++)for(int sign=-1;sign<=1;sign+=2){
            List<double[]> points=walls(dims,bounds,axis,sign);
            VoxelCavity cavity=VoxelCavity.reconstruct(points,bounds,axis,sign,new double[]{60,50,40});
            int[] sides={10,8,6};sides[axis]++;
            assertEquals(sides[0]*sides[1]*sides[2],cavity.freeCells.length);
            assertEquals(sides[(axis+1)%3]*sides[(axis+2)%3],cavity.openingCells.length);
            assertEquals(2*(sides[0]*sides[1]+sides[0]*sides[2]+sides[1]*sides[2]),cavity.surfaceFaceCount);
            assertEquals(cavity.freeCells.length*1000,cavity.estimatedVolumeMm3,.000001);
            for(int cell:cavity.openingCells){int[] xyz={cell%12,(cell/12)%10,cell/(12*10)};assertEquals(sign==1?dims[axis]-1:0,xyz[axis]);}
            assertEquals(points.size(),cavity.wallCellCount);
        }
    }
    @Test public void neverCountsObservedFloorWallsOrIntrusionsAsUsable() {
        List<double[]> points=box();for(int z=1;z<=4;z++)for(int y=3;y<=6;y++)for(int x=4;x<=6;x++)points.add(new double[]{x*10+5,y*10+5,z*10+5});
        VoxelCavity cavity=reconstruct(points);assertEquals(560-48,cavity.freeCells.length);
        for(double[] point:points){int cell=(int)(point[0]/10)+12*((int)(point[1]/10)+10*(int)(point[2]/10));assertTrue(Arrays.binarySearch(cavity.freeCells,cell)<0);}
    }
    @Test public void rejectsAnUnobservedFloorOrSideInsteadOfUsingEnvelopeFacesAsWalls() {
        for(int axis=0;axis<3;axis++){
            final int missingAxis=axis;List<double[]> points=box();points.removeIf(point->point[missingAxis]<10);
            VoxelCavity.ReconstructionRejected error=assertThrows(VoxelCavity.ReconstructionRejected.class,()->reconstruct(points));
            assertTrue(error.getMessage().contains("unreviewed boundary"));
        }
        List<double[]> hole=box();hole.removeIf(point->point[0]==5&&point[1]==35&&point[2]==35);
        assertThrows(VoxelCavity.ReconstructionRejected.class,()->reconstruct(hole));
    }
    @Test public void rejectsWrongOpeningAndSeedOnObservedGeometry() {
        assertThrows(VoxelCavity.ReconstructionRejected.class,()->VoxelCavity.reconstruct(box(),new double[]{120,100,80},2,-1,new double[]{85,55,45}));
        assertThrows(VoxelCavity.ReconstructionRejected.class,()->VoxelCavity.reconstruct(box(),new double[]{120,100,80},2,1,new double[]{5,55,45}));
    }
    @Test public void rejectsSealedPocketsWithoutEntryAndKeepsOnlyChosenCompartment() {
        List<double[]> closed=walls(new int[]{12,10,8},new double[]{120,100,80},-1,0);
        assertThrows(VoxelCavity.ReconstructionRejected.class,()->reconstruct(closed));
        List<double[]> partition=box();for(int y=1;y<9;y++)for(int z=1;z<8;z++)partition.add(new double[]{65,y*10+5,z*10+5});
        VoxelCavity cavity=VoxelCavity.reconstruct(partition,new double[]{120,100,80},2,1,new double[]{25,55,45});
        assertEquals(280,cavity.freeCells.length);assertEquals(40,cavity.openingCells.length);
        for(int cell:cavity.freeCells)assertTrue(cell%12<6);
    }
    @Test public void fitsCellsInsideNonIntegralBoundsRatherThanExpandingCapacity() {
        double[] bounds={117,93,77};int[] dims={12,10,8};
        VoxelCavity cavity=VoxelCavity.reconstruct(walls(dims,bounds,2,1),bounds,2,1,new double[]{85,55,45});
        assertArrayEquals(bounds,cavity.boundsMm,0);assertEquals(560,cavity.freeCells.length);
        assertEquals(117,cavity.nx*cavity.cellSizeMm[0],.0000001);assertEquals(93,cavity.ny*cavity.cellSizeMm[1],.0000001);assertEquals(77,cavity.nz*cavity.cellSizeMm[2],.0000001);
        assertEquals(560*(117.0/12)*(93.0/10)*(77.0/8),cavity.estimatedVolumeMm3,.000001);
    }
    @Test public void sourceOrderCoordinatesAndInputArraysRemainUnchanged() {
        List<double[]> points=box(),reversed=new ArrayList<>(points);Collections.reverse(reversed);
        double[] bounds={120,100,80},seed={85,55,45};
        VoxelCavity cavity=VoxelCavity.reconstruct(points,bounds,2,1,seed);assertArrayEquals(cavity.freeCells,reconstruct(reversed).freeCells);
        assertArrayEquals(new double[]{5,5,5},points.get(0),0);assertArrayEquals(new double[]{120,100,80},bounds,0);assertArrayEquals(new double[]{85,55,45},seed,0);
        bounds[0]=1;seed[0]=1;assertEquals(120,cavity.boundsMm[0],0);assertEquals(85,cavity.seedMm[0],0);
    }
    @Test public void rejectsInvalidOrUnboundedInputsAndThinSources() {
        for(double[] seed:new double[][]{{0,50,40},{120,50,40},{60,Double.NaN,40},{60,50,Double.POSITIVE_INFINITY}})
            assertThrows(IllegalArgumentException.class,()->VoxelCavity.reconstruct(box(),new double[]{120,100,80},2,1,seed));
        assertThrows(IllegalArgumentException.class,()->VoxelCavity.reconstruct(box(),new double[]{120,100,80},3,1,new double[]{60,50,40}));
        assertThrows(IllegalArgumentException.class,()->VoxelCavity.reconstruct(box(),new double[]{120,100,80},2,0,new double[]{60,50,40}));
        assertThrows(IllegalArgumentException.class,()->VoxelCavity.reconstruct(box(),new double[]{Double.NaN,100,80},2,1,new double[]{60,50,40}));
        assertThrows(IllegalArgumentException.class,()->VoxelCavity.reconstruct(Collections.nCopies(60001,new double[]{5,5,5}),new double[]{120,100,80},2,1,new double[]{60,50,40}));
        assertThrows(VoxelCavity.ReconstructionRejected.class,()->VoxelCavity.reconstruct(box(),new double[]{120,100,20},2,1,new double[]{60,50,10}));
        List<double[]> malformed=box();malformed.set(0,new double[]{-2,1,1});assertThrows(IllegalArgumentException.class,()->reconstruct(malformed));
        malformed.set(0,new double[]{Double.NaN,1,1});assertThrows(IllegalArgumentException.class,()->reconstruct(malformed));
    }
    @Test public void rejectsAmbiguousEdgesRatherThanSmoothingInteriorGeometry() {
        List<double[]> points=box();
        // Two columns meet at an edge, while the surrounding empty component stays connected.
        for(int z=1;z<8;z++){points.add(new double[]{45,45,z*10+5});points.add(new double[]{55,55,z*10+5});}
        VoxelCavity.ReconstructionRejected error=assertThrows(VoxelCavity.ReconstructionRejected.class,()->reconstruct(points));
        assertTrue(error.getMessage().contains("ambiguous"));
    }
}
