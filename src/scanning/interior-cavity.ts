import type { DimensionsMm } from '../types.ts';
import type { SavedGeometryPreview } from './saved-geometry.ts';
import { voxelSurface, type SolidSurface } from './reconstructed-solid.ts';

export interface InteriorReview {
  openingAxis: 0 | 1 | 2;
  openingSign: 1 | -1;
  seedMm: { x: number; y: number; z: number };
}
export interface InteriorCavity {
  id: string; target: 'container_interior'; format: 'voxel_cavity_v1'; units: 'millimetres';
  sourceHash: string; sourcePointCount: number; method: 'seeded_observed_interior_v1';
  grid: { x: number; y: number; z: number }; boundsMm: DimensionsMm; cellSizeMm: DimensionsMm;
  seedMm: InteriorReview['seedMm']; opening: { axis: 0 | 1 | 2; sign: 1 | -1; planeMm: number; cells: number[] };
  freeCells: number[]; observedCells: number[]; wallCellCount: number; surfaceFaceCount: number; estimatedVolumeMm3: number; warnings: string[];
}
export interface ReconstructedInterior { cavity: InteriorCavity; surface: SolidSurface }
const fail=():never=>{throw new Error('The interior reconstruction is incomplete or inconsistent with its source and reviewed opening. Recorded bag dimensions are unchanged.');};
const axes=['length','width','height'] as const,coordinates=['x','y','z'] as const;
const same=(a:number,b:number)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-7,Math.abs(b)*1e-9);

/** Independent validation of a free component; it cannot be substituted for an occupied item shape. */
export function parseInteriorCavity(value:unknown,source:SavedGeometryPreview,review:InteriorReview):ReconstructedInterior {
  if(!value||typeof value!=='object'||source.target!=='container_interior')return fail();
  const cavity=value as InteriorCavity,bounds=source.envelope.dimensionsMm;
  if(!review||![0,1,2].includes(review.openingAxis)||![1,-1].includes(review.openingSign)||!review.seedMm
    ||!axes.every((axis,i)=>Number.isFinite(bounds[axis])&&bounds[axis]>0&&bounds[axis]<=10000&&Number.isFinite(review.seedMm[coordinates[i]])&&review.seedMm[coordinates[i]]>0&&review.seedMm[coordinates[i]]<bounds[axis]))return fail();
  const spacing=Math.max(10,Math.ceil(Math.max(bounds.length,bounds.width,bounds.height)/46));
  const dimensions=axes.map(axis=>Math.ceil(bounds[axis]/spacing)),total=dimensions.reduce((a,b)=>a*b,1);
  if(cavity.id!==source.id||cavity.sourceHash!==source.sourceHash||cavity.target!=='container_interior'||cavity.format!=='voxel_cavity_v1'||cavity.units!=='millimetres'
    ||cavity.method!=='seeded_observed_interior_v1'||cavity.sourcePointCount!==source.pointCount||!Number.isInteger(cavity.sourcePointCount)||cavity.sourcePointCount<300||cavity.sourcePointCount>=60000
    ||!cavity.grid||!cavity.boundsMm||!cavity.cellSizeMm||!cavity.seedMm||!cavity.opening
    ||!axes.every((axis,i)=>dimensions[i]>=3&&dimensions[i]<=46&&cavity.grid[coordinates[i]]===dimensions[i]&&same(cavity.boundsMm[axis],bounds[axis])&&same(cavity.cellSizeMm[axis],bounds[axis]/dimensions[i])&&same(cavity.seedMm[coordinates[i]],review.seedMm[coordinates[i]]))
    ||cavity.opening.axis!==review.openingAxis||cavity.opening.sign!==review.openingSign||!same(cavity.opening.planeMm,review.openingSign===1?bounds[axes[review.openingAxis]]:0)
    ||!Number.isInteger(cavity.wallCellCount)||cavity.wallCellCount<1||cavity.wallCellCount>source.pointCount
    ||!Array.isArray(cavity.observedCells)||cavity.observedCells.length!==cavity.wallCellCount||cavity.observedCells.length>total
    ||cavity.observedCells.some((cell,i)=>!Number.isInteger(cell)||cell<0||cell>=total||(i>0&&cell<=cavity.observedCells[i-1]))
    ||!Array.isArray(cavity.freeCells)||cavity.freeCells.length<8||cavity.freeCells.length>total-cavity.wallCellCount
    ||!Array.isArray(cavity.opening.cells)||cavity.opening.cells.length<4
    ||!Array.isArray(cavity.warnings)||cavity.warnings.length>8||!cavity.warnings.every(w=>typeof w==='string'&&w.length<=600))return fail();
  const {x:nx,y:ny}=cavity.grid,opening:number[]=[],cellState=new Uint8Array(total);
  for(const cell of cavity.observedCells)cellState[cell]=1;
  for(const [i,cell] of cavity.freeCells.entries()){
    if(!Number.isInteger(cell)||cell<0||cell>=total||cellState[cell]!==0||(i>0&&cell<=cavity.freeCells[i-1]))return fail();
    const x=cell%nx,y=Math.floor(cell/nx)%ny,z=Math.floor(cell/(nx*ny));
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1])if((axis===0?x:axis===1?y:z)===(sign===1?dimensions[axis]-1:0)){
      if(axis!==review.openingAxis||sign!==review.openingSign)return fail();opening.push(cell);
    }
  }
  if(opening.length!==cavity.opening.cells.length||opening.some((cell,i)=>cell!==cavity.opening.cells[i]))return fail();
  const seed=coordinates.map((coordinate,i)=>Math.min(dimensions[i]-1,Math.floor(review.seedMm[coordinate]/bounds[axes[i]]*dimensions[i]))),seedCell=seed[0]+nx*(seed[1]+ny*seed[2]);
  let low=0,high=cavity.freeCells.length;
  while(low<high){const middle=(low+high)>>>1;if(cavity.freeCells[middle]<seedCell)low=middle+1;else high=middle;}
  if(cavity.freeCells[low]!==seedCell)return fail();
  for(let i=0;i<source.pointsMm.length;i+=4){
    const x=Math.min(dimensions[0]-1,Math.max(0,Math.floor(source.pointsMm[i]/bounds.length*dimensions[0])));
    const y=Math.min(dimensions[1]-1,Math.max(0,Math.floor(source.pointsMm[i+1]/bounds.width*dimensions[1])));
    const z=Math.min(dimensions[2]-1,Math.max(0,Math.floor(source.pointsMm[i+2]/bounds.height*dimensions[2])));
    if(cellState[x+nx*(y+ny*z)]!==1)return fail();
  }
  // Independently traverse the empty complement of all observed cells. A subset
  // selected merely to look closed, or an unreviewed escape, cannot pass.
  const plane=nx*ny,start=seed[0]+nx*(seed[1]+ny*seed[2]),queue=new Int32Array(total);
  let head=0,tail=1;queue[0]=start;cellState[start]=2;
  const enqueue=(index:number)=>{if(cellState[index]===0){cellState[index]=2;queue[tail++]=index;}};
  while(head<tail){
    const cell=queue[head++],x=cell%nx,y=Math.floor(cell/nx)%ny,z=Math.floor(cell/plane);
    if(x===0&&(review.openingAxis!==0||review.openingSign!==-1)||x===nx-1&&(review.openingAxis!==0||review.openingSign!==1)
      ||y===0&&(review.openingAxis!==1||review.openingSign!==-1)||y===ny-1&&(review.openingAxis!==1||review.openingSign!==1)
      ||z===0&&(review.openingAxis!==2||review.openingSign!==-1)||z===dimensions[2]-1&&(review.openingAxis!==2||review.openingSign!==1))return fail();
    if(x>0)enqueue(cell-1);if(x+1<nx)enqueue(cell+1);
    if(y>0)enqueue(cell-nx);if(y+1<ny)enqueue(cell+nx);
    if(z>0)enqueue(cell-plane);if(z+1<dimensions[2])enqueue(cell+plane);
  }
  if(tail!==cavity.freeCells.length||cavity.freeCells.some(cell=>cellState[cell]!==2))return fail();
  // A 10 mm reference lattice validates topology/connectivity. Positive per-axis scaling
  // then fits its unchanged cells exactly inside the original source envelope.
  const reference=voxelSurface({grid:cavity.grid,resolutionMm:10,occupiedCells:cavity.freeCells});
  const size=axes.map(axis=>cavity.cellSizeMm[axis]),volume=cavity.freeCells.length*size[0]*size[1]*size[2];
  if(cavity.surfaceFaceCount!==reference.faceCount||!same(cavity.estimatedVolumeMm3,volume))return fail();
  const surface={...reference,verticesMm:reference.verticesMm.map((value,i)=>value*size[i%3]/10),volumeMm3:volume};
  return {cavity,surface};
}
