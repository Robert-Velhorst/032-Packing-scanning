import type { Container, DimensionsMm, Evidence } from './types.ts';
import { openingEvidenceError } from './property-evidence.ts';
import { interiorGeometry,packingInteriorError } from './packing-interior.ts';
import { compartmentError,packingRegions,fitsCompartment } from './compartments.ts';

export const MAX_UNAVAILABLE_SPACES=16;
const EPSILON=.01;
type SpaceInput=Pick<Container,'inside'|'unavailableSpaces'|'lidClearanceMm'|'lidClearanceEvidence'|'packingInterior'|'compartments'|'openingEvidence'>;
export type SpaceBox=DimensionsMm&{x:number;y:number;z:number};

function validEvidence(value:Evidence|undefined):boolean {
  return !!value&&['measured','known','estimated','user_confirmed','provider'].includes(value.source)
    &&Number.isFinite(value.confidence)&&value.confidence>=0&&value.confidence<=1
    &&typeof value.collectedAt==='string'&&Number.isFinite(Date.parse(value.collectedAt));
}
/** Same boundary for forms, imported backups and the deterministic planner. */
export function containerSpaceError(bag:SpaceInput):string|undefined {
  const openingError=openingEvidenceError(bag);if(openingError)return openingError;
  if(!bag.inside||![bag.inside.length,bag.inside.width,bag.inside.height].every(v=>Number.isFinite(v)&&v>0&&v<=10000))return 'Enter finite positive inside dimensions up to 10,000 mm.';
  const interiorError=packingInteriorError(bag);if(interiorError)return interiorError;
  const regionError=compartmentError(bag);if(regionError)return regionError;
  const lid=bag.lidClearanceMm??0;
  if(!Number.isFinite(lid)||lid<0||lid>bag.inside.height)return 'Lid clearance must be between zero and the inside height.';
  if((lid>0||bag.lidClearanceEvidence!==undefined)&&!validEvidence(bag.lidClearanceEvidence))return 'Record how you know the lid clearance.';
  if(bag.unavailableSpaces===undefined)return;
  if(!Array.isArray(bag.unavailableSpaces)||bag.unavailableSpaces.length>MAX_UNAVAILABLE_SPACES)return `Record at most ${MAX_UNAVAILABLE_SPACES} unavailable spaces.`;
  const ids=new Set<string>();
  for(const space of bag.unavailableSpaces){
    if(!space||typeof space.id!=='string'||!space.id||space.id.length>100||ids.has(space.id)
      ||typeof space.name!=='string'||!space.name.trim()||space.name.length>80)return 'Give each unavailable space a name and a unique identifier.';
    ids.add(space.id);
    if(![space.x,space.y,space.z].every(v=>Number.isFinite(v)&&v>=0)
      ||![space.length,space.width,space.height].every(v=>Number.isFinite(v)&&v>0)
      ||space.x+space.length>bag.inside.length+1e-6||space.y+space.width>bag.inside.width+1e-6||space.z+space.height>bag.inside.height+1e-6)return `Keep “${space.name}” within the recorded inside dimensions, with a positive size.`;
    if(!validEvidence(space.evidence))return `Record how you know the size of “${space.name}”.`;
  }
}
export function boxesOverlap(a:SpaceBox,b:SpaceBox):boolean {
  return a.x<b.x+b.length-EPSILON&&a.x+a.length>b.x+EPSILON
    &&a.y<b.y+b.width-EPSILON&&a.y+a.width>b.y+EPSILON
    &&a.z<b.z+b.height-EPSILON&&a.z+a.height>b.z+EPSILON;
}
export function usableContainerHeight(bag:SpaceInput):number {
  return containerSpaceError(bag)?0:bag.inside.height-(bag.lidClearanceMm??0);
}
export function fitsUsableContainer(box:SpaceBox&{compartmentId?:string},bag:SpaceInput):boolean {
  if(containerSpaceError(bag))return false;
  if(![box.x,box.y,box.z].every(value=>Number.isFinite(value)&&value>=0)||![box.length,box.width,box.height].every(value=>Number.isFinite(value)&&value>0))return false;
  return fitsCompartment(box,bag)&&box.x>=0&&box.y>=0&&box.z>=0&&box.x+box.length<=bag.inside.length+EPSILON
    &&box.y+box.width<=bag.inside.width+EPSILON&&box.z+box.height<=usableContainerHeight(bag)+EPSILON
    &&!containerBlockedBoxes(bag).some(space=>boxesOverlap(box,space));
}
/** Recorded keep-free boxes plus the exact complement of the adopted empty component. */
export function containerBlockedBoxes(bag:SpaceInput):SpaceBox[]{
  return [...(bag.unavailableSpaces??[]),...(bag.packingInterior?interiorGeometry(bag.packingInterior).blockedBoxes:[])];
}
/** Exact union of the recorded orthogonal boxes, clipped beneath lid clearance. */
export function usableContainerVolume(bag:SpaceInput):number {
  const height=usableContainerHeight(bag);
  if(height<=0)return 0;
  if(bag.compartments){
    const free=bag.packingInterior?interiorGeometry(bag.packingInterior).freeBoxes:[{x:0,y:0,z:0,...bag.inside,height}];
    let total=0;
    for(const region of packingRegions(bag))for(const source of free){
      const box=intersection(region,source);if(!box)continue;
      const blocked=(bag.unavailableSpaces??[]).map(b=>intersection(box,b)).filter((b):b is SpaceBox=>!!b);
      total+=Math.max(0,box.length*box.width*box.height-boxUnionVolume(blocked));
    }
    return total;
  }
  if(bag.packingInterior)return interiorGeometry(bag.packingInterior).freeBoxes.reduce((sum,free)=>{
    const top=Math.min(free.z+free.height,height);if(top<=free.z)return sum;
    const box={...free,height:top-free.z},blocks=(bag.unavailableSpaces??[]).map(block=>{
      const x=Math.max(box.x,block.x),y=Math.max(box.y,block.y),z=Math.max(box.z,block.z);
      return {x,y,z,length:Math.min(box.x+box.length,block.x+block.length)-x,width:Math.min(box.y+box.width,block.y+block.width)-y,height:Math.min(box.z+box.height,block.z+block.height)-z};
    }).filter(b=>b.length>0&&b.width>0&&b.height>0);
    return sum+Math.max(0,box.length*box.width*box.height-boxUnionVolume(blocks));
  },0);
  const blocks=(bag.unavailableSpaces??[]).filter(b=>b.z<height).map(b=>({...b,length:Math.max(0,Math.min(b.length,bag.inside.length-b.x)),width:Math.max(0,Math.min(b.width,bag.inside.width-b.y)),height:Math.min(b.height,height-b.z)})).filter(b=>b.length>0&&b.width>0);
  const sorted=(values:number[])=>[...new Set(values)].sort((a,b)=>a-b);
  const xs=sorted([0,bag.inside.length,...blocks.flatMap(b=>[b.x,b.x+b.length])]);
  const ys=sorted([0,bag.inside.width,...blocks.flatMap(b=>[b.y,b.y+b.width])]);
  const zs=sorted([0,height,...blocks.flatMap(b=>[b.z,b.z+b.height])]);
  let blocked=0;
  for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++)for(let k=1;k<zs.length;k++){
    const x=(xs[i-1]+xs[i])/2,y=(ys[j-1]+ys[j])/2,z=(zs[k-1]+zs[k])/2;
    if(blocks.some(b=>x>=b.x&&x<=b.x+b.length&&y>=b.y&&y<=b.y+b.width&&z>=b.z&&z<=b.z+b.height))blocked+=(xs[i]-xs[i-1])*(ys[j]-ys[j-1])*(zs[k]-zs[k-1]);
  }
  return Math.max(0,bag.inside.length*bag.inside.width*height-blocked);
}

function intersection(a:SpaceBox,b:SpaceBox):SpaceBox|undefined{
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),z=Math.max(a.z,b.z),length=Math.min(a.x+a.length,b.x+b.length)-x,width=Math.min(a.y+a.width,b.y+b.width)-y,height=Math.min(a.z+a.height,b.z+b.height)-z;
  return length>0&&width>0&&height>0?{x,y,z,length,width,height}:undefined;
}

function boxUnionVolume(blocks:SpaceBox[]):number{
  if(!blocks.length)return 0;
  const sorted=(values:number[])=>[...new Set(values)].sort((a,b)=>a-b);
  const xs=sorted(blocks.flatMap(b=>[b.x,b.x+b.length])),ys=sorted(blocks.flatMap(b=>[b.y,b.y+b.width])),zs=sorted(blocks.flatMap(b=>[b.z,b.z+b.height]));
  let volume=0;
  for(let i=1;i<xs.length;i++)for(let j=1;j<ys.length;j++)for(let k=1;k<zs.length;k++){
    const x=(xs[i-1]+xs[i])/2,y=(ys[j-1]+ys[j])/2,z=(zs[k-1]+zs[k])/2;
    if(blocks.some(b=>x>=b.x&&x<=b.x+b.length&&y>=b.y&&y<=b.y+b.width&&z>=b.z&&z<=b.z+b.height))volume+=(xs[i]-xs[i-1])*(ys[j]-ys[j-1])*(zs[k]-zs[k-1]);
  }
  return volume;
}
