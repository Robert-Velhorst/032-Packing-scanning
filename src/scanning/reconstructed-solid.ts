import type { DimensionsMm } from '../types.ts';
import type { SavedGeometryPreview } from './saved-geometry.ts';

export interface ReconstructedSolid {
  id: string; target: 'item'; format: 'voxel_solid_v1'; units: 'millimetres';
  sourceHash: string; sourcePointCount: number; method: 'observed_voxel_shell_fill_v1';
  resolutionMm: number; grid: { x: number; y: number; z: number };
  occupiedCells: number[]; observedCellCount: number; enclosedCellCount: number;
  surfaceFaceCount: number; dimensionsMm: DimensionsMm; warnings: string[];
}
export interface SolidSurface {
  verticesMm: number[]; triangles: number[]; faceCount: number; volumeMm3: number;
}
export interface ReconstructedGeometry { solid: ReconstructedSolid; surface: SolidSurface }

const quads = [
  [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
];
// Vertex keys use a fixed 64-cell stride, so each link edge maps to one axis direction.
const linkDirection = (delta:number) => delta===1?0:delta===-1?1:delta===64?2:delta===-64?3:delta===4096?4:delta===-4096?5:-1;
const fail = (): never => { throw new Error('The reconstructed surface is incomplete or inconsistent with its source. Recorded dimensions are unchanged.'); };

export function parseReconstructedSolid(value: unknown, source: SavedGeometryPreview): ReconstructedGeometry {
  if (!value || typeof value !== 'object' || source.target !== 'item') return fail();
  const solid = value as ReconstructedSolid, bounds = source.envelope.dimensionsMm;
  const resolution = Math.max(10, Math.ceil(Math.max(bounds.length,bounds.width,bounds.height)/46));
  if (solid.id !== source.id || solid.target !== 'item' || solid.format !== 'voxel_solid_v1' || solid.units !== 'millimetres'
    || solid.sourceHash !== source.sourceHash || solid.sourcePointCount !== source.pointCount || solid.sourcePointCount < 300 || solid.sourcePointCount >= 60000
    || solid.method !== 'observed_voxel_shell_fill_v1' || solid.resolutionMm !== resolution || !solid.grid
    || solid.grid.x !== Math.ceil(bounds.length/resolution) || solid.grid.y !== Math.ceil(bounds.width/resolution) || solid.grid.z !== Math.ceil(bounds.height/resolution)
    || !solid.dimensionsMm || solid.dimensionsMm.length !== solid.grid.x*resolution || solid.dimensionsMm.width !== solid.grid.y*resolution || solid.dimensionsMm.height !== solid.grid.z*resolution
    || !Number.isInteger(solid.observedCellCount) || solid.observedCellCount < 1 || !Number.isInteger(solid.enclosedCellCount) || solid.enclosedCellCount < 8
    || !Array.isArray(solid.occupiedCells) || solid.observedCellCount+solid.enclosedCellCount !== solid.occupiedCells.length
    || !Array.isArray(solid.warnings) || solid.warnings.length > 8 || !solid.warnings.every(w => typeof w === 'string' && w.length <= 600)) return fail();
  const surface = voxelSurface(solid);
  if (solid.surfaceFaceCount !== surface.faceCount) return fail();
  return { solid, surface };
}

/** Shared block-boundary representation, retaining exterior-connected concavities. */
export function voxelSurface(solid: Pick<ReconstructedSolid,'grid'|'resolutionMm'|'occupiedCells'>): SolidSurface {
  const {grid,resolutionMm,occupiedCells}=solid;
  if (!grid || ![grid.x,grid.y,grid.z].every(n => Number.isInteger(n) && n>=1 && n<=46)
    || !Number.isFinite(resolutionMm) || resolutionMm<10 || resolutionMm>218 || !Array.isArray(occupiedCells)
    || occupiedCells.length<1 || occupiedCells.length>grid.x*grid.y*grid.z
    || occupiedCells.some((n,i) => !Number.isInteger(n) || n<0 || n>=grid.x*grid.y*grid.z || (i>0 && n<=occupiedCells[i-1]))) return fail();
  // 0 is empty, 1 is occupied and unvisited, and 2 is occupied and reached.
  // Reusing this byte map avoids both the occupied-cell Set and a second bitmap.
  const total=grid.x*grid.y*grid.z,plane=grid.x*grid.y,cellState=new Uint8Array(total);
  for(const cell of occupiedCells)cellState[cell]=1;
  const pending=new Int32Array(occupiedCells.length);
  let head=0,tail=1;pending[0]=occupiedCells[0];cellState[pending[0]]=2;
  const enqueue=(cell:number)=>{if(cellState[cell]===1){cellState[cell]=2;pending[tail++]=cell;}};
  while(head<tail){
    const cell=pending[head++],x=cell%grid.x,y=Math.floor(cell/grid.x)%grid.y,z=Math.floor(cell/plane);
    if(x>0)enqueue(cell-1);if(x+1<grid.x)enqueue(cell+1);
    if(y>0)enqueue(cell-grid.x);if(y+1<grid.y)enqueue(cell+grid.x);
    if(z>0)enqueue(cell-plane);if(z+1<grid.z)enqueue(cell+plane);
  }
  if(tail!==occupiedCells.length)return fail();
  const verticesMm:number[]=[],triangles:number[]=[],vertexIds=new Map<number,number>();
  const edges=new Map<number,{count:number;orientation:number}>();
  // A vertex link only connects its six axis-neighbor directions; byte masks
  // avoid per-face tuples plus a Map and Set for every surface vertex.
  const vertexCapacity=(grid.x+1)*(grid.y+1)*(grid.z+1),linkNeighbors=new Uint8Array(vertexCapacity*6),linkSeen=new Uint8Array(vertexCapacity),linkedVertices:number[]=[];
  let faceCount=0;
  for(const cell of occupiedCells){
    const x=cell%grid.x,y=Math.floor(cell/grid.x)%grid.y,z=Math.floor(cell/(grid.x*grid.y));
    const exposed=(x===0||cellState[cell-1]!==2?1:0)|(x+1===grid.x||cellState[cell+1]!==2?2:0)
      |(y===0||cellState[cell-grid.x]!==2?4:0)|(y+1===grid.y||cellState[cell+grid.x]!==2?8:0)
      |(z===0||cellState[cell-plane]!==2?16:0)|(z+1===grid.z||cellState[cell+plane]!==2?32:0);
    if(!exposed)continue;
    for(let side=0;side<6;side++){
      if((exposed&(1<<side))===0)continue;
      if(++faceCount>20000)return fail();
      const ids=quads[side].map(c=>{
        const a=x+c[0],b=y+c[1],cZ=z+c[2],key=a+64*(b+64*cZ);
        if(!vertexIds.has(key)){vertexIds.set(key,verticesMm.length/3);verticesMm.push(a*resolutionMm,b*resolutionMm,cZ*resolutionMm);}
        return key;
      });
      const vertex0=vertexIds.get(ids[0])!,vertex1=vertexIds.get(ids[1])!,vertex2=vertexIds.get(ids[2])!,vertex3=vertexIds.get(ids[3])!;
      triangles.push(vertex0,vertex1,vertex2,vertex0,vertex2,vertex3);
      for(let i=0;i<4;i++){
        const a=ids[i],b=ids[(i+1)%4],key=Math.min(a,b)*262144+Math.max(a,b),edge=edges.get(key)??{count:0,orientation:0};
        edge.count++;edge.orientation+=a<b?1:-1;edges.set(key,edge);
        const previousDirection=linkDirection(ids[(i+3)%4]-a),nextDirection=linkDirection(b-a),vertexIndex=i===0?vertex0:i===1?vertex1:i===2?vertex2:vertex3;
        if(previousDirection<0||nextDirection<0)return fail();
        if(!linkSeen[vertexIndex]){linkSeen[vertexIndex]=1;linkedVertices.push(vertexIndex);}
        const base=vertexIndex*6,previousBit=1<<previousDirection,nextBit=1<<nextDirection;
        if((linkNeighbors[base+previousDirection]&nextBit)===0){
          linkNeighbors[base+previousDirection]|=nextBit;
          linkNeighbors[base+nextDirection]|=previousBit;
        }
      }
    }
  }
  if([...edges.values()].some(e=>e.count!==2||e.orientation!==0))return fail();
  const linkQueue=new Uint8Array(6),linkVisited=new Uint8Array(6);
  for(const vertex of linkedVertices){
    const base=vertex*6;let start=-1,nodeCount=0;
    for(let direction=0;direction<6;direction++){
      const neighbors=linkNeighbors[base+direction];let degree=0;
      for(let adjacent=0;adjacent<6;adjacent++)if(neighbors&(1<<adjacent))degree++;
      if(neighbors){if(degree!==2)return fail();nodeCount++;if(start<0)start=direction;}
    }
    if(start<0)return fail();
    linkVisited.fill(0);linkVisited[start]=1;linkQueue[0]=start;let tail=1;
    for(let head=0;head<tail;head++){
      const neighbors=linkNeighbors[base+linkQueue[head]];
      for(let adjacent=0;adjacent<6;adjacent++)if((neighbors&(1<<adjacent))&&!linkVisited[adjacent]){linkVisited[adjacent]=1;linkQueue[tail++]=adjacent;}
    }
    if(tail!==nodeCount)return fail();
  }
  let signedVolume=0;
  for(let i=0;i<triangles.length;i+=3){
    const a=triangles[i]*3,b=triangles[i+1]*3,c=triangles[i+2]*3,v=verticesMm;
    signedVolume+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])+v[a+1]*(v[b+2]*v[c]-v[b]*v[c+2])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6;
  }
  const expected=occupiedCells.length*resolutionMm**3;
  if(!Number.isFinite(signedVolume)||Math.abs(signedVolume-expected)>Math.max(0.001,expected*1e-8))return fail();
  return {verticesMm,triangles,faceCount,volumeMm3:expected};
}
