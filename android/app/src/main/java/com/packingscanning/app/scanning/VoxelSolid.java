package com.packingscanning.app.scanning;

import java.util.ArrayList;
import java.util.List;

/** Bounded observed-shell reconstruction. Unknown/open surfaces are not silently sealed. */
public final class VoxelSolid {
    public static final class ReconstructionRejected extends IllegalStateException {
        public ReconstructionRejected(String message){super(message);}
    }
    public static final String METHOD = "observed_voxel_shell_fill_v1";
    public static final int MAX_AXIS = 46, MAX_FACES = 20000;
    public final int nx, ny, nz, observedCellCount, enclosedCellCount, faceCount;
    public final double resolutionMm;
    public final int[] occupiedCells;
    private static final int[][] DIRS={{-1,0,0},{1,0,0},{0,-1,0},{0,1,0},{0,0,-1},{0,0,1}};
    // Winding is outward in right-handed x,y,z coordinates.
    private static final int[][][] QUADS={
        {{0,0,0},{0,0,1},{0,1,1},{0,1,0}}, {{1,0,0},{1,1,0},{1,1,1},{1,0,1}},
        {{0,0,0},{1,0,0},{1,0,1},{0,0,1}}, {{0,1,0},{0,1,1},{1,1,1},{1,1,0}},
        {{0,0,0},{0,1,0},{1,1,0},{1,0,0}}, {{0,0,1},{1,0,1},{1,1,1},{0,1,1}}
    };

    private VoxelSolid(int nx,int ny,int nz,double resolution,boolean[] solid,int observed,int enclosed) {
        this.nx=nx;this.ny=ny;this.nz=nz;this.resolutionMm=resolution;
        this.observedCellCount=observed;this.enclosedCellCount=enclosed;
        int count=0;for(boolean cell:solid)if(cell)count++;
        occupiedCells=new int[count];int offset=0;for(int i=0;i<solid.length;i++)if(solid[i])occupiedCells[offset++]=i;
        connected(solid,nx,ny,nz,count);
        faceCount=validateSurface(solid,nx,ny,nz);
    }

    public static VoxelSolid reconstruct(List<double[]> points,double[] boundsMm) {
        if(points==null||points.size()<4||points.size()>DepthCloud.MAX_POINTS||boundsMm==null||boundsMm.length!=3)throw new IllegalArgumentException("Invalid source geometry.");
        double maximum=0;
        for(double side:boundsMm){if(!Double.isFinite(side)||side<=0||side>10000)throw new IllegalArgumentException("Invalid source bounds.");maximum=Math.max(maximum,side);}
        double resolution=Math.max(10,Math.ceil(maximum/MAX_AXIS));
        int nx=(int)Math.ceil(boundsMm[0]/resolution),ny=(int)Math.ceil(boundsMm[1]/resolution),nz=(int)Math.ceil(boundsMm[2]/resolution);
        int px=nx+2,py=ny+2,pz=nz+2,total=px*py*pz;
        boolean[] observed=new boolean[total];int observedCount=0;
        for(double[] point:points){
            if(point==null||point.length!=3)throw new IllegalArgumentException("Invalid source point.");
            for(int axis=0;axis<3;axis++)if(!Double.isFinite(point[axis])||point[axis]<-0.001||point[axis]>boundsMm[axis]+0.001)throw new IllegalArgumentException("Source point is outside its envelope.");
            int x=1+Math.min(nx-1,Math.max(0,(int)Math.floor(point[0]/resolution)));
            int y=1+Math.min(ny-1,Math.max(0,(int)Math.floor(point[1]/resolution)));
            int z=1+Math.min(nz-1,Math.max(0,(int)Math.floor(point[2]/resolution)));
            int cell=index(x,y,z,px,py);if(!observed[cell]){observed[cell]=true;observedCount++;}
        }
        // The extra empty border ensures every external void is reached from one seed.
        boolean[] exterior=new boolean[total];int[] queue=new int[total];int head=0,tail=1;queue[0]=0;exterior[0]=true;
        while(head<tail){int current=queue[head++],x=current%px,y=(current/px)%py,z=current/(px*py);
            for(int[] direction:DIRS){int a=x+direction[0],b=y+direction[1],c=z+direction[2];if(a<0||a>=px||b<0||b>=py||c<0||c>=pz)continue;
                int next=index(a,b,c,px,py);if(!observed[next]&&!exterior[next]){exterior[next]=true;queue[tail++]=next;}}
        }
        boolean[] solid=new boolean[nx*ny*nz];int enclosed=0;
        for(int z=0;z<nz;z++)for(int y=0;y<ny;y++)for(int x=0;x<nx;x++){
            int source=index(x+1,y+1,z+1,px,py);if(!exterior[source]){solid[index(x,y,z,nx,ny)]=true;if(!observed[source])enclosed++;}}
        if(enclosed<8)throw new ReconstructionRejected("The observed shell does not enclose enough interior cells. Capture missing sides or keep the rectangular estimate; no gaps were automatically closed.");
        return new VoxelSolid(nx,ny,nz,resolution,solid,observedCount,enclosed);
    }

    private static int index(int x,int y,int z,int nx,int ny){return x+nx*(y+ny*z);}
    private static boolean occupied(boolean[] solid,int x,int y,int z,int nx,int ny,int nz){return x>=0&&x<nx&&y>=0&&y<ny&&z>=0&&z<nz&&solid[index(x,y,z,nx,ny)];}
    private static void connected(boolean[] solid,int nx,int ny,int nz,int expected){
        boolean[] visited=new boolean[solid.length];int[] queue=new int[solid.length];int head=0,tail=1;
        for(int i=0;i<solid.length;i++)if(solid[i]){queue[0]=i;visited[i]=true;break;}
        while(head<tail){int current=queue[head++],x=current%nx,y=(current/nx)%ny,z=current/(nx*ny);
            for(int[] d:DIRS){int a=x+d[0],b=y+d[1],c=z+d[2];if(!occupied(solid,a,b,c,nx,ny,nz))continue;int next=index(a,b,c,nx,ny);if(!visited[next]){visited[next]=true;queue[tail++]=next;}}}
        if(tail!=expected)throw new ReconstructionRejected("Several disconnected shapes were observed. Isolate one object and capture it again; no source components were discarded.");
    }
    static int validateSurface(boolean[] solid,int nx,int ny,int nz){
        int ex=nx*(ny+1)*(nz+1),ey=(nx+1)*ny*(nz+1),ez=(nx+1)*(ny+1)*nz;
        byte[] edgeCountsX=new byte[ex],edgeWindingX=new byte[ex];
        byte[] edgeCountsY=new byte[ey],edgeWindingY=new byte[ey];
        byte[] edgeCountsZ=new byte[ez],edgeWindingZ=new byte[ez];
        int vx=nx+1,vy=ny+1,vz=nz+1,vertexCount=vx*vy*vz;
        byte[] vertexNeighbours=new byte[vertexCount],fanLinks=new byte[vertexCount*6];int faces=0;
        for(int cell=0;cell<solid.length;cell++)if(solid[cell]){
            int x=cell%nx,y=(cell/nx)%ny,z=cell/(nx*ny);
            for(int side=0;side<6;side++){
                int[] d=DIRS[side];if(occupied(solid,x+d[0],y+d[1],z+d[2],nx,ny,nz))continue;
                if(++faces>MAX_FACES)throw new ReconstructionRejected("The reconstructed surface is too complex for this preview. Capture a simpler isolated object or use its envelope.");
                for(int i=0;i<4;i++){
                    int[] a=QUADS[side][i],b=QUADS[side][(i+1)%4],previous=QUADS[side][(i+3)%4];
                    int ax=x+a[0],ay=y+a[1],az=z+a[2],bx=x+b[0],by=y+b[1],bz=z+b[2];
                    int dx=bx-ax,dy=by-ay,dz=bz-az;
                    // Grid topology limits each edge to four incident faces, so byte counters cannot overflow.
                    if(dx!=0){int key=Math.min(ax,bx)+nx*(ay+(ny+1)*az);edgeCountsX[key]=(byte)(edgeCountsX[key]+1);edgeWindingX[key]=(byte)(edgeWindingX[key]+dx);}
                    else if(dy!=0){int key=ax+(nx+1)*(Math.min(ay,by)+ny*az);edgeCountsY[key]=(byte)(edgeCountsY[key]+1);edgeWindingY[key]=(byte)(edgeWindingY[key]+dy);}
                    else {int key=ax+(nx+1)*(ay+(ny+1)*Math.min(az,bz));edgeCountsZ[key]=(byte)(edgeCountsZ[key]+1);edgeWindingZ[key]=(byte)(edgeWindingZ[key]+dz);}

                    int px=x+previous[0],py=y+previous[1],pz=z+previous[2];
                    int vertex=ax+vx*(ay+vy*az),first=directionSlot(px-ax,py-ay,pz-az),second=directionSlot(bx-ax,by-ay,bz-az);
                    vertexNeighbours[vertex]|=(byte)((1<<first)|(1<<second));
                    fanLinks[vertex*6+first]|=(byte)(1<<second);fanLinks[vertex*6+second]|=(byte)(1<<first);
                }
            }
        }
        if(!closedEdges(edgeCountsX,edgeWindingX)||!closedEdges(edgeCountsY,edgeWindingY)||!closedEdges(edgeCountsZ,edgeWindingZ))
            throw new ReconstructionRejected("The surface contains ambiguous edge contacts. Its watertight topology could not be established; keep the envelope estimate.");
        // A closed edge count alone misses two surface fans touching at one vertex.
        for(int vertex=0;vertex<vertexCount;vertex++){
            int neighbours=vertexNeighbours[vertex]&0xff;if(neighbours==0)continue;
            for(int direction=0;direction<6;direction++)if((neighbours&(1<<direction))!=0&&Integer.bitCount(fanLinks[vertex*6+direction]&0xff)!=2)
                throw new ReconstructionRejected("The surface contains an ambiguous vertex contact.");
            int reached=0,frontier=Integer.lowestOneBit(neighbours);
            while(frontier!=0){int bit=Integer.lowestOneBit(frontier);frontier^=bit;if((reached&bit)!=0)continue;reached|=bit;
                int direction=Integer.numberOfTrailingZeros(bit);frontier|=(fanLinks[vertex*6+direction]&0xff)&~reached;}
            if(reached!=neighbours)throw new ReconstructionRejected("The surface has disconnected vertex fans; keep the envelope estimate.");
        }
        return faces;
    }
    private static boolean closedEdges(byte[] counts,byte[] winding){
        for(int i=0;i<counts.length;i++)if(counts[i]!=0&&(counts[i]!=2||winding[i]!=0))return false;
        return true;
    }
    private static int directionSlot(int x,int y,int z){
        if(x<0)return 0;if(x>0)return 1;if(y<0)return 2;if(y>0)return 3;if(z<0)return 4;return 5;
    }
}
