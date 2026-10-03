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

const directions = [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
const quads = [
  [[0,0,0],[0,0,1],[0,1,1],[0,1,0]],[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  [[0,0,0],[1,0,0],[1,0,1],[0,0,1]],[[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],
];
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
  const cells=new Set(occupiedCells), index=(x:number,y:number,z:number)=>x+grid.x*(y+grid.y*z);
  const occupied=(x:number,y:number,z:number)=>x>=0&&x<grid.x&&y>=0&&y<grid.y&&z>=0&&z<grid.z&&cells.has(index(x,y,z));
  const reached=new Set<number>(),pending=[occupiedCells[0]];
  for(let i=0;i<pending.length;i++){
    const cell=pending[i];if(reached.has(cell))continue;reached.add(cell);
    const x=cell%grid.x,y=Math.floor(cell/grid.x)%grid.y,z=Math.floor(cell/(grid.x*grid.y));
    for(const d of directions)if(occupied(x+d[0],y+d[1],z+d[2])){const next=index(x+d[0],y+d[1],z+d[2]);if(!reached.has(next))pending.push(next);}
  }
  if(reached.size!==occupiedCells.length)return fail();
  const verticesMm:number[]=[],triangles:number[]=[],vertexIds=new Map<number,number>();
  const edges=new Map<number,{count:number;orientation:number}>(),links=new Map<number,Array<[number,number]>>();let faceCount=0;
  for(const cell of occupiedCells){
    const x=cell%grid.x,y=Math.floor(cell/grid.x)%grid.y,z=Math.floor(cell/(grid.x*grid.y));
    for(let side=0;side<6;side++){
      const d=directions[side];if(occupied(x+d[0],y+d[1],z+d[2]))continue;
      if(++faceCount>20000)return fail();
      const ids=quads[side].map(c=>{
        const a=x+c[0],b=y+c[1],cZ=z+c[2],key=a+64*(b+64*cZ);
        if(!vertexIds.has(key)){vertexIds.set(key,verticesMm.length/3);verticesMm.push(a*resolutionMm,b*resolutionMm,cZ*resolutionMm);}
        return key;
      });
      triangles.push(vertexIds.get(ids[0])!,vertexIds.get(ids[1])!,vertexIds.get(ids[2])!,vertexIds.get(ids[0])!,vertexIds.get(ids[2])!,vertexIds.get(ids[3])!);
      for(let i=0;i<4;i++){
        const a=ids[i],b=ids[(i+1)%4],key=Math.min(a,b)*262144+Math.max(a,b),edge=edges.get(key)??{count:0,orientation:0};
        edge.count++;edge.orientation+=a<b?1:-1;edges.set(key,edge);
        const fan=links.get(a)??[];fan.push([ids[(i+3)%4],b]);links.set(a,fan);
      }
    }
  }
  if([...edges.values()].some(e=>e.count!==2||e.orientation!==0))return fail();
  for(const pairs of links.values()){
    const graph=new Map<number,Set<number>>();for(const [a,b]of pairs){if(!graph.has(a))graph.set(a,new Set());if(!graph.has(b))graph.set(b,new Set());graph.get(a)!.add(b);graph.get(b)!.add(a);}
    if([...graph.values()].some(set=>set.size!==2))return fail();
    const visited=new Set<number>(),queue=[graph.keys().next().value!];
    for(let i=0;i<queue.length;i++){const current=queue[i];if(!visited.has(current)){visited.add(current);queue.push(...graph.get(current)!);}}
    if(visited.size!==graph.size)return fail();
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
