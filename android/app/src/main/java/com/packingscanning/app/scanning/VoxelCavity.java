package com.packingscanning.app.scanning;

import java.util.List;

/** One seeded empty component bounded by observed cells and one explicitly reviewed opening plane. */
public final class VoxelCavity {
    public static final String METHOD="seeded_observed_interior_v1";
    public static final class ReconstructionRejected extends IllegalStateException {
        public ReconstructionRejected(String message){super(message);}
    }
    public final int nx,ny,nz,wallCellCount,surfaceFaceCount,openingAxis,openingSign;
    public final double[] boundsMm,cellSizeMm,seedMm;
    public final int[] freeCells,openingCells,observedCells;
    public final double estimatedVolumeMm3;
    private static final int[][] DIRS={{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}};

    private VoxelCavity(int[] dimensions,double[] bounds,double[] seed,int axis,int sign,
                        boolean[] free,boolean[] observed,int walls,int count,int openingCount) {
        nx=dimensions[0];ny=dimensions[1];nz=dimensions[2];boundsMm=bounds.clone();seedMm=seed.clone();
        openingAxis=axis;openingSign=sign;wallCellCount=walls;
        cellSizeMm=new double[]{bounds[0]/nx,bounds[1]/ny,bounds[2]/nz};
        observedCells=new int[walls];int observedOffset=0;for(int cell=0;cell<observed.length;cell++)if(observed[cell])observedCells[observedOffset++]=cell;
        freeCells=new int[count];openingCells=new int[openingCount];int offset=0,openingOffset=0;
        for(int cell=0;cell<free.length;cell++)if(free[cell]){
            freeCells[offset++]=cell;
            int coordinate=axis==0?cell%nx:axis==1?(cell/nx)%ny:cell/(nx*ny);
            if(coordinate==(sign==1?dimensions[axis]-1:0))openingCells[openingOffset++]=cell;
        }
        try{surfaceFaceCount=VoxelSolid.validateSurface(free,nx,ny,nz);}
        catch(VoxelSolid.ReconstructionRejected error){throw new ReconstructionRejected("The seeded cavity has an ambiguous or overly complex boundary. Capture a clearer interior; no cells were trimmed or gaps patched.");}
        estimatedVolumeMm3=count*cellSizeMm[0]*cellSizeMm[1]*cellSizeMm[2];
    }

    public static VoxelCavity reconstruct(List<double[]> points,double[] boundsMm,
                                         int openingAxis,int openingSign,double[] seedMm) {
        if(points==null||points.size()<4||points.size()>DepthCloud.MAX_POINTS||boundsMm==null||boundsMm.length!=3
            ||seedMm==null||seedMm.length!=3||openingAxis<0||openingAxis>2||(openingSign!=1&&openingSign!=-1))
            throw new IllegalArgumentException("Choose one valid source-end opening and an interior seed.");
        double maximum=0;
        for(int axis=0;axis<3;axis++){
            double bound=boundsMm[axis];
            if(!Double.isFinite(bound)||bound<=0||bound>10000||!Double.isFinite(seedMm[axis])||seedMm[axis]<=0||seedMm[axis]>=bound)
                throw new IllegalArgumentException("The interior seed must be strictly inside finite source bounds.");
            maximum=Math.max(maximum,bound);
        }
        // Fit cells exactly inside the source envelope: no rounded cells extend beyond its faces.
        double targetSpacing=Math.max(10,Math.ceil(maximum/VoxelSolid.MAX_AXIS));
        int[] dimensions=new int[3];for(int axis=0;axis<3;axis++){
            dimensions[axis]=(int)Math.ceil(boundsMm[axis]/targetSpacing);
            if(dimensions[axis]<3||dimensions[axis]>VoxelSolid.MAX_AXIS)
                throw new ReconstructionRejected("The source is too thin to distinguish walls from interior cells at this spacing.");
        }
        int nx=dimensions[0],ny=dimensions[1],nz=dimensions[2],total=nx*ny*nz,walls=0;
        boolean[] observed=new boolean[total];
        for(double[] point:points){
            if(point==null||point.length!=3)throw new IllegalArgumentException("Invalid source point.");
            for(int axis=0;axis<3;axis++)if(!Double.isFinite(point[axis])||point[axis]<-0.001||point[axis]>boundsMm[axis]+0.001)
                throw new IllegalArgumentException("A source point lies outside its recorded envelope.");
            int x=Math.min(nx-1,Math.max(0,(int)Math.floor(point[0]/boundsMm[0]*nx)));
            int y=Math.min(ny-1,Math.max(0,(int)Math.floor(point[1]/boundsMm[1]*ny)));
            int z=Math.min(nz-1,Math.max(0,(int)Math.floor(point[2]/boundsMm[2]*nz)));
            int cell=index(x,y,z,nx,ny);if(!observed[cell]){observed[cell]=true;walls++;}
        }
        int seedX=Math.min(nx-1,(int)Math.floor(seedMm[0]/boundsMm[0]*nx));
        int seedY=Math.min(ny-1,(int)Math.floor(seedMm[1]/boundsMm[1]*ny));
        int seedZ=Math.min(nz-1,(int)Math.floor(seedMm[2]/boundsMm[2]*nz));
        int start=index(seedX,seedY,seedZ,nx,ny);
        if(observed[start])throw new ReconstructionRejected("The selected seed touches an observed wall or object. Choose a point in the empty interior.");
        boolean[] free=new boolean[total];int[] queue=new int[total];int head=0,tail=1,openingCount=0;
        free[start]=true;queue[0]=start;
        while(head<tail){
            int cell=queue[head++],x=cell%nx,y=(cell/nx)%ny,z=cell/(nx*ny);
            if(x==0){if(openingAxis!=0||openingSign!=-1)throw unreviewedBoundary();openingCount++;}
            if(x==nx-1){if(openingAxis!=0||openingSign!=1)throw unreviewedBoundary();openingCount++;}
            if(y==0){if(openingAxis!=1||openingSign!=-1)throw unreviewedBoundary();openingCount++;}
            if(y==ny-1){if(openingAxis!=1||openingSign!=1)throw unreviewedBoundary();openingCount++;}
            if(z==0){if(openingAxis!=2||openingSign!=-1)throw unreviewedBoundary();openingCount++;}
            if(z==nz-1){if(openingAxis!=2||openingSign!=1)throw unreviewedBoundary();openingCount++;}
            for(int[] direction:DIRS){int a=x+direction[0],b=y+direction[1],c=z+direction[2];
                if(a<0||a>=nx||b<0||b>=ny||c<0||c>=nz)continue;
                int next=index(a,b,c,nx,ny);if(!observed[next]&&!free[next]){free[next]=true;queue[tail++]=next;}
            }
        }
        if(tail<8||openingCount<4)
            throw new ReconstructionRejected("The seed does not connect enough empty cells to the selected opening. Review the seed and entry end; a hidden sealed pocket is not usable entry space.");
        return new VoxelCavity(dimensions,boundsMm,seedMm,openingAxis,openingSign,free,observed,walls,tail,openingCount);
    }

    private static ReconstructionRejected unreviewedBoundary(){
        return new ReconstructionRejected("The seeded space reaches an unreviewed boundary. A wall or floor may be missing. Capture it again; only the selected opening may remain open.");
    }

    private static int index(int x,int y,int z,int nx,int ny){return x+nx*(y+ny*z);}
}
