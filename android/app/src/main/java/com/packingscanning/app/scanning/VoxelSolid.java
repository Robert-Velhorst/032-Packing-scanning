package com.packingscanning.app.scanning;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    private static long vertex(int x,int y,int z){return x+64L*(y+64L*z);}
    static int validateSurface(boolean[] solid,int nx,int ny,int nz){
        Map<Long,int[]> edges=new HashMap<>();Map<Long,List<long[]>> links=new HashMap<>();int faces=0;
        for(int cell=0;cell<solid.length;cell++)if(solid[cell]){
            int x=cell%nx,y=(cell/nx)%ny,z=cell/(nx*ny);
            for(int side=0;side<6;side++){
                int[] d=DIRS[side];if(occupied(solid,x+d[0],y+d[1],z+d[2],nx,ny,nz))continue;
                if(++faces>MAX_FACES)throw new ReconstructionRejected("The reconstructed surface is too complex for this preview. Capture a simpler isolated object or use its envelope.");
                long[] ids=new long[4];for(int i=0;i<4;i++){int[] c=QUADS[side][i];ids[i]=vertex(x+c[0],y+c[1],z+c[2]);}
                for(int i=0;i<4;i++){
                    long a=ids[i],b=ids[(i+1)%4],key=Math.min(a,b)*262144L+Math.max(a,b);
                    int[] edge=edges.computeIfAbsent(key,k->new int[2]);edge[0]++;edge[1]+=a<b?1:-1;
                    links.computeIfAbsent(a,k->new ArrayList<>()).add(new long[]{ids[(i+3)%4],b});
                }
            }
        }
        for(int[] edge:edges.values())if(edge[0]!=2||edge[1]!=0)throw new ReconstructionRejected("The surface contains ambiguous edge contacts. Its watertight topology could not be established; keep the envelope estimate.");
        // A closed edge count alone misses two surface fans touching at one vertex.
        for(List<long[]> pairs:links.values()){
            Map<Long,Set<Long>> graph=new HashMap<>();for(long[] pair:pairs){graph.computeIfAbsent(pair[0],k->new HashSet<>()).add(pair[1]);graph.computeIfAbsent(pair[1],k->new HashSet<>()).add(pair[0]);}
            for(Set<Long> neighbours:graph.values())if(neighbours.size()!=2)throw new ReconstructionRejected("The surface contains an ambiguous vertex contact.");
            Set<Long> reached=new HashSet<>();List<Long> pending=new ArrayList<>();pending.add(graph.keySet().iterator().next());
            for(int i=0;i<pending.size();i++){long current=pending.get(i);if(reached.add(current))pending.addAll(graph.get(current));}
            if(reached.size()!=graph.size())throw new ReconstructionRejected("The surface has disconnected vertex fans; keep the envelope estimate.");
        }
        return faces;
    }
}
