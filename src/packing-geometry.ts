import {compartmentFor,fitsCompartment} from './compartments.ts';
import type { Container, DimensionsMm, LibraryItem, PackingShape, Placement } from './types.ts';
import { parseReconstructedSolid, type SolidSurface } from './scanning/reconstructed-solid.ts';
import { containerBlockedBoxes,containerSpaceError, usableContainerHeight } from './container-space.ts';
import { uprightRecordError } from './upright.ts';
import { interiorFrame, interiorSupportError, interiorTravelUp } from './packing-interior.ts';

export interface GeometryBox extends DimensionsMm { x:number; y:number; z:number }
type ShapeItem = {packingShape?:PackingShape};
type Face = {x:number;y:number;z:number;length:number;width:number};
const EPS=.01, axes=['length','width','height'] as const;
interface Rotation {code:number;axis:number[];sign:number[]}
const legacy:Rotation[]=[{code:0,axis:[0,1,2],sign:[1,1,1]},{code:90,axis:[1,0,2],sign:[-1,1,1]},
  {code:1,axis:[2,1,0],sign:[-1,1,1]},{code:2,axis:[1,2,0],sign:[1,1,1]},
  {code:3,axis:[0,2,1],sign:[1,-1,1]},{code:4,axis:[2,0,1],sign:[1,1,1]}];
const rotations:Rotation[]=[...legacy];
for(const base of legacy)for(const flip of [[1,-1,-1],[-1,1,-1],[-1,-1,1]])rotations.push({code:100+rotations.length,axis:base.axis,sign:base.sign.map((s,i)=>s*flip[i])});
export interface GravityUp {axis:number;sign:number}
const packingUp:GravityUp={axis:2,sign:1};
interface ContactFaces {bottom:Face[];down:Face[];top:Face[]}
interface Oriented extends ContactFaces {boxes:GeometryBox[];directional:Map<string,ContactFaces>}
interface Compiled {boxes:GeometryBox[];bounds:DimensionsMm;key:string;volume:number;surface:SolidSurface;oriented:Map<number,Oriented>}
const cache=new WeakMap<PackingShape,Compiled>();

export function packingShapeError(item:Pick<LibraryItem,'dimensions'|'packingShape'>):string|undefined {
  if(item.packingShape===undefined)return;
  try {
    const shape=item.packingShape;
    const uprightError=uprightRecordError(shape);if(uprightError)return uprightError;
    if(!shape||!shape.solid||!Number.isFinite(Date.parse(shape.adoptedAt))||!shape.sourceEnvelopeMm||!shape.fittedDimensionsMm
      ||axes.some(a=>!Number.isFinite(shape.sourceEnvelopeMm[a])||shape.sourceEnvelopeMm[a]<=0||shape.sourceEnvelopeMm[a]>10000
        ||!Number.isFinite(shape.fittedDimensionsMm[a])||shape.fittedDimensionsMm[a]<=0||shape.fittedDimensionsMm[a]>10000
        ||Math.abs(item.dimensions[a]-shape.fittedDimensionsMm[a])>1e-6)
      ||!/^[a-f0-9]{64}$/.test(shape.solid.sourceHash)||!Number.isInteger(shape.solid.sourcePointCount))throw Error();
    const scale=shape.fittedDimensionsMm.length/shape.sourceEnvelopeMm.length;
    if(axes.some(a=>Math.abs(shape.fittedDimensionsMm[a]/shape.sourceEnvelopeMm[a]-scale)>Math.max(1e-8,scale*1e-6)))throw Error();
    compile(shape);
  }catch{return 'The adopted shape is invalid or its scale no longer matches the item. Review it again or use rectangular bounds. Saved packed positions must be unlocked before changing their geometry.';}
}

function compile(shape:PackingShape):Compiled {
  const prior=cache.get(shape);if(prior)return prior;
  const solid=shape.solid;
  const validated=parseReconstructedSolid(solid,{id:solid.id,target:'item',format:'point_cloud_preview',units:'millimetres',sourceHash:solid.sourceHash,
    pointCount:solid.sourcePointCount,samplePointCount:0,pointsMm:[],envelope:{method:'oriented_surface_envelope_v1',basis:'capture_aligned',paddingMm:2.5,dimensionsMm:shape.sourceEnvelopeMm}});
  const {x:nx,y:ny,z:nz}=solid.grid,scale=shape.fittedDimensionsMm.length/shape.sourceEnvelopeMm.length,cell=solid.resolutionMm*scale;
  const bounds={length:nx*cell,width:ny*cell,height:nz*cell};
  if(!Number.isFinite(cell)||cell<=EPS||axes.some(a=>bounds[a]>11000))throw Error('Invalid scale.');
  const present=new Uint8Array(nx*ny*nz);for(const id of solid.occupiedCells)present[id]=1;
  const idx=(x:number,y:number,z:number)=>x+nx*(y+ny*z),boxes:GeometryBox[]=[];
  // Exact disjoint greedy cuboids, without trimming or filling any occupied cell.
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(present[idx(x,y,z)]){
    let right=x+1;while(right<nx&&present[idx(right,y,z)])right++;
    let back=y+1;while(back<ny&&Array.from({length:right-x},(_,i)=>present[idx(x+i,back,z)]).every(Boolean))back++;
    let top=z+1;
    while(top<nz){let filled=true;for(let b=y;b<back&&filled;b++)for(let a=x;a<right;a++)if(!present[idx(a,b,top)]){filled=false;break;}if(!filled)break;top++;}
    for(let c=z;c<top;c++)for(let b=y;b<back;b++)for(let a=x;a<right;a++)present[idx(a,b,c)]=0;
    boxes.push({x:x*cell,y:y*cell,z:z*cell,length:(right-x)*cell,width:(back-y)*cell,height:(top-z)*cell});
  }
  if(['x','y','z'].some(a=>Math.min(...boxes.map(b=>b[a as 'x']))>1e-6))throw Error('The adopted grid lacks a floor or origin boundary.');
  let fingerprint=2166136261;for(const n of solid.occupiedCells)fingerprint=Math.imul(fingerprint^n,16777619)>>>0;
  const key=`${solid.sourceHash}:${nx},${ny},${nz}:${cell.toPrecision(15)}:${fingerprint.toString(16)}`;
  const result={boxes,bounds,key,volume:solid.occupiedCells.length*cell**3,surface:validated.surface,oriented:new Map()};cache.set(shape,result);return result;
}

export function shapeDimensions(shape:PackingShape):DimensionsMm{return compile(shape).bounds;}
export function shapeVolume(shape:PackingShape):number{return compile(shape).volume;}
export function shapeKey(shape?:PackingShape):string|undefined{return shape?compile(shape).key:undefined;}
export function geometryOrientations(item:{dimensions:DimensionsMm;keepUpright:boolean;packingShape?:PackingShape},bag?:Pick<Container,'packingInterior'>) {
  const dimensions=item.packingShape?shapeDimensions(item.packingShape):item.dimensions,values=axes.map(a=>dimensions[a]);
  const up=item.packingShape?.upright;
  const upAxis=up?axes.indexOf(up.axis):2,upSign=up?.sign??1;
  const target=bag?.packingInterior?interiorTravelUp(bag.packingInterior):{axis:2,sign:1},spatial=!!item.packingShape||!!bag?.packingInterior;
  const allowed=spatial?rotations.filter(r=>!item.keepUpright||(r.axis[target.axis]===upAxis&&r.sign[target.axis]===upSign*target.sign)):legacy.filter(r=>!item.keepUpright||r.code===0||r.code===90);
  const seen=new Set<string>();
  return allowed.flatMap(r=>{const key=r.axis.map(a=>values[a]).join('|');if(!item.packingShape&&seen.has(key))return [];seen.add(key);return [{length:values[r.axis[0]],width:values[r.axis[1]],height:values[r.axis[2]],rotation:r.code}];});
}
/** Older rectangular plans deduplicated equal side permutations differently. */
export function orientationForRotation(item:{dimensions:DimensionsMm;keepUpright:boolean;packingShape?:PackingShape},code:number,bag?:Pick<Container,'packingInterior'>) {
  const spatial=!!item.packingShape||!!bag?.packingInterior,r=(spatial?rotations:legacy).find(r=>r.code===code);
  const up=item.packingShape?.upright,upAxis=up?axes.indexOf(up.axis):2,upSign=up?.sign??1;
  const target=bag?.packingInterior?interiorTravelUp(bag.packingInterior):{axis:2,sign:1};
  if(!r||(item.keepUpright&&(spatial?(r.axis[target.axis]!==upAxis||r.sign[target.axis]!==upSign*target.sign):code!==0&&code!==90)))return;
  const bounds=item.packingShape?shapeDimensions(item.packingShape):item.dimensions,values=axes.map(a=>bounds[a]);
  return {length:values[r.axis[0]],width:values[r.axis[1]],height:values[r.axis[2]],rotation:code};
}

function localGeometry(shape:PackingShape,code:number) {
  const compiled=compile(shape),prior=compiled.oriented.get(code);if(prior)return prior;
  const rotation=rotations.find(r=>r.code===code);if(!rotation)throw Error('Unsupported shape rotation.');
  const dimensions=axes.map(a=>compiled.bounds[a]);
  const boxes=compiled.boxes.map(b=>{
    const min=[b.x,b.y,b.z],size=[b.length,b.width,b.height],outMin=rotation.axis.map((a,i)=>rotation.sign[i]>0?min[a]:dimensions[a]-min[a]-size[a]),outSize=rotation.axis.map(a=>size[a]);
    return {x:outMin[0],y:outMin[1],z:outMin[2],length:outSize[0],width:outSize[1],height:outSize[2]};
  });
  const bottom=boxes.filter(b=>Math.abs(b.z)<EPS).map(b=>({x:b.x,y:b.y,z:b.z,length:b.length,width:b.width}));
  const top=boxes.flatMap(b=>{
    let faces:Face[]=[{x:b.x,y:b.y,z:b.z+b.height,length:b.length,width:b.width}];
    for(const above of boxes)if(Math.abs(above.z-b.z-b.height)<=EPS)faces=faces.flatMap(f=>subtractFace(f,above));
    return faces;
  });
  const down=boxes.flatMap(b=>{let patches:Face[]=[{x:b.x,y:b.y,z:b.z,length:b.length,width:b.width}];for(const below of boxes)if(Math.abs(below.z+below.height-b.z)<=EPS)patches=patches.flatMap(f=>subtractFace(f,below));return patches;});
  const result={boxes,bottom,down,top,directional:new Map<string,ContactFaces>()};compiled.oriented.set(code,result);return result;
}
function subtractFace(face:Face,cut:GeometryBox):Face[] {
  const x=Math.max(face.x,cut.x),y=Math.max(face.y,cut.y),r=Math.min(face.x+face.length,cut.x+cut.length),b=Math.min(face.y+face.width,cut.y+cut.width);
  if(r-x<=EPS||b-y<=EPS)return [face];
  return [{...face,length:x-face.x},{...face,x:r,length:face.x+face.length-r},
    {...face,x,length:r-x,width:y-face.y},{...face,x,y:b,length:r-x,width:face.y+face.width-b}].filter(f=>f.length>EPS&&f.width>EPS);
}
export function placementBoxes(placement:GeometryBox&{rotation?:number},item?:ShapeItem):GeometryBox[] {
  if(!item?.packingShape)return [placement];
  return localGeometry(item.packingShape,placement.rotation??0).boxes.map(b=>({...b,x:b.x+placement.x,y:b.y+placement.y,z:b.z+placement.z}));
}
export function placementSurface(p:Placement,item:ShapeItem):SolidSurface|undefined {
  if(!item.packingShape)return;
  const shape=item.packingShape,compiled=compile(shape),r=rotations.find(r=>r.code===p.rotation);if(!r)throw Error('Unsupported rotation.');
  const scale=shape.fittedDimensionsMm.length/shape.sourceEnvelopeMm.length,dimensions=axes.map(a=>compiled.bounds[a]),v=compiled.surface.verticesMm,verticesMm:number[]=[];
  for(let i=0;i<v.length;i+=3){const point=v.slice(i,i+3).map(n=>n*scale),out=r.axis.map((a,j)=>r.sign[j]>0?point[a]:dimensions[a]-point[a]);verticesMm.push(out[0]+p.x,out[1]+p.y,out[2]+p.z);}
  return {...compiled.surface,verticesMm,volumeMm3:compiled.volume};
}
export function boxesIntersect(a:GeometryBox,b:GeometryBox):boolean {
  return a.x<b.x+b.length-EPS&&a.x+a.length>b.x+EPS&&a.y<b.y+b.width-EPS&&a.y+a.width>b.y+EPS&&a.z<b.z+b.height-EPS&&a.z+a.height>b.z+EPS;
}
export function geometryIntersects(a:Placement,b:Placement,items:Map<string,ShapeItem>):boolean {
  if(!boxesIntersect(a,b))return false;
  return placementBoxes(a,items.get(a.instanceId)).some(left=>placementBoxes(b,items.get(b.instanceId)).some(right=>boxesIntersect(left,right)));
}
export function fitsGeometrySpace(p:Placement,bag:Container,item?:ShapeItem):boolean {
  if(containerSpaceError(bag)||!fitsCompartment(p,bag)||p.x<0||p.y<0||p.z<0||p.x+p.length>bag.inside.length+EPS||p.y+p.width>bag.inside.width+EPS||p.z+p.height>usableContainerHeight(bag)+EPS)return false;
  return !placementBoxes(p,item).some(box=>containerBlockedBoxes(bag).some(blocked=>boxesIntersect(box,blocked)));
}
/** Proper axis rotation; negative coordinates are deliberate and retain exact contact. */
export function gravityBox(box:GeometryBox,up:GravityUp):GeometryBox{
  const frame=interiorFrame(up.axis,up.sign),origin=[box.x,box.y,box.z],size=[box.length,box.width,box.height];
  const min=frame.axis.map((a,i)=>frame.sign[i]>0?origin[a]:-origin[a]-size[a]),sides=frame.axis.map(a=>size[a]);
  return {x:min[0],y:min[1],z:min[2],length:sides[0],width:sides[1],height:sides[2]};
}
function contactFaces(boxes:GeometryBox[],floor:number):ContactFaces{
  const bottom=boxes.filter(b=>Math.abs(b.z-floor)<=EPS).map(b=>({x:b.x,y:b.y,z:b.z,length:b.length,width:b.width}));
  const top=boxes.flatMap(b=>{let patches:Face[]=[{x:b.x,y:b.y,z:b.z+b.height,length:b.length,width:b.width}];for(const above of boxes)if(Math.abs(above.z-b.z-b.height)<=EPS)patches=patches.flatMap(f=>subtractFace(f,above));return patches;});
  const down=boxes.flatMap(b=>{let patches:Face[]=[{x:b.x,y:b.y,z:b.z,length:b.length,width:b.width}];for(const below of boxes)if(Math.abs(below.z+below.height-b.z)<=EPS)patches=patches.flatMap(f=>subtractFace(f,below));return patches;});
  return {bottom,down,top};
}
function faces(p:Placement,item:ShapeItem|undefined,side:'bottom'|'down'|'top',up:GravityUp=packingUp):Face[] {
  if(up.axis!==2||up.sign!==1){
    const frame=interiorFrame(up.axis,up.sign),origin=[p.x,p.y,p.z],offset=frame.axis.map((a,i)=>frame.sign[i]*origin[a]);
    let patches:ContactFaces;
    const localBounds=gravityBox({x:0,y:0,z:0,length:p.length,width:p.width,height:p.height},up);
    if(item?.packingShape){
      const geometry=localGeometry(item.packingShape,p.rotation),key=up.axis+':'+up.sign;
      patches=geometry.directional.get(key)??contactFaces(geometry.boxes.map(b=>gravityBox(b,up)),localBounds.z);
      geometry.directional.set(key,patches);
    }else patches=contactFaces([localBounds],localBounds.z);
    return patches[side].map(f=>({...f,x:f.x+offset[0],y:f.y+offset[1],z:f.z+offset[2]}));
  }
  const local=item?.packingShape?localGeometry(item.packingShape,p.rotation)[side]:[{x:0,y:0,z:side==='top'?p.height:0,length:p.length,width:p.width}];
  return local.map(f=>({...f,x:f.x+p.x,y:f.y+p.y,z:f.z+p.z}));
}
export function geometrySupportArea(upper:Placement,lower:Placement,items:Map<string,ShapeItem>,up:GravityUp=packingUp):number {
  if(upper.containerId!==lower.containerId||upper.compartmentId!==lower.compartmentId||gravityBox(upper,up).z<=gravityBox(lower,up).z+EPS)return 0;
  return faceContact(upper,lower,items,'bottom',up);
}
export function geometryContactArea(upper:Placement,lower:Placement,items:Map<string,ShapeItem>,up:GravityUp=packingUp):number {
  if(upper.instanceId===lower.instanceId||upper.containerId!==lower.containerId||upper.compartmentId!==lower.compartmentId)return 0;
  return faceContact(upper,lower,items,'down',up);
}
function faceContact(upper:Placement,lower:Placement,items:Map<string,ShapeItem>,side:'bottom'|'down',up:GravityUp):number {
  let area=0;
  for(const base of faces(upper,items.get(upper.instanceId),side,up))for(const top of faces(lower,items.get(lower.instanceId),'top',up))if(Math.abs(base.z-top.z)<=EPS){
    const l=Math.min(base.x+base.length,top.x+top.length)-Math.max(base.x,top.x),w=Math.min(base.y+base.width,top.y+top.width)-Math.max(base.y,top.y);
    if(l>EPS&&w>EPS)area+=l*w;
  }
  return area;
}
export function hasGeometrySupport(p:Placement,placed:Placement[],items:Map<string,ShapeItem>,fraction:number,up:GravityUp=packingUp,floor=0):boolean {
  const area=faces(p,items.get(p.instanceId),'bottom',up).reduce((sum,f)=>sum+f.length*f.width,0);
  if(area<=0)return false;if(Math.abs(gravityBox(p,up).z-floor)<=EPS)return true;
  return placed.reduce((sum,lower)=>sum+geometrySupportArea(p,lower,items,up),0)+EPS**2>=area*fraction;
}
/** Both snapshots must be supported; unavailable-region tops never become supports. */
export function hasPackingAndTravelSupport(p:Placement,placed:Placement[],items:Map<string,ShapeItem>,fraction:number,bag:Container):boolean{
  const compartment=compartmentFor(bag,p.compartmentId);
  if(!hasGeometrySupport(p,placed,items,fraction,packingUp,compartment?.z??0))return false;
  if(!bag.packingInterior)return true;
  if(interiorSupportError(bag.packingInterior))return false;
  const up=interiorTravelUp(bag.packingInterior);
  if(up.axis===2&&up.sign===1)return true;
  const origin=compartment?[compartment.x,compartment.y,compartment.z][up.axis]:0;
  const floor=up.sign===1?origin:-(origin+(compartment??bag.inside)[axes[up.axis]]);
  return hasGeometrySupport(p,placed,items,fraction,up,floor);
}
/** Fixed orientation, straight downward entry: recesses must remain reachable from above. */
export function hasVerticalEntry(p:Placement,placed:Placement[],items:Map<string,ShapeItem>,bag:Container):boolean {
  const top=bag.inside.height;
  const obstacles=[...containerBlockedBoxes(bag),...placed.filter(other=>other.containerId===p.containerId).flatMap(other=>placementBoxes(other,items.get(other.instanceId)))];
  return !placementBoxes(p,items.get(p.instanceId)).some(b=>obstacles.some(o=>boxesIntersect({...b,height:Math.max(b.height,top-b.z+p.height)},o)));
}

export function contactPositions(bag:Container,orientation:DimensionsMm&{rotation:number},item:ShapeItem,placed:Placement[],items:Map<string,ShapeItem>,region:GeometryBox={x:0,y:0,z:0,...bag.inside,height:usableContainerHeight(bag)}) {
  const local=placementBoxes({x:0,y:0,z:0,...orientation},item),obstacles=[...placed.flatMap(p=>placementBoxes(p,items.get(p.instanceId))),...containerBlockedBoxes(bag)];
  const values=[new Set([region.x,region.x+region.length-orientation.length]),new Set([region.y,region.y+region.width-orientation.width]),new Set([region.z])],mins=['x','y','z'] as const;
  for(const b of obstacles)for(const c of local)for(let axis=0;axis<3;axis++){
    values[axis].add(b[mins[axis]]+b[axes[axis]]-c[mins[axis]]);
    if(axis<2)values[axis].add(b[mins[axis]]-c[mins[axis]]-c[axes[axis]]);
  }
  const minimum=[region.x,region.y,region.z],maximum=[region.x+region.length-orientation.length,region.y+region.width-orientation.width,region.z+region.height-orientation.height];
  const coords=values.map((set,i)=>[...set].filter(v=>v>=minimum[i]-EPS&&v<=maximum[i]+EPS).map(v=>Math.max(minimum[i],v)).sort((a,b)=>a-b));
  const positions:Array<{x:number;y:number;z:number}>=[];let limited=false;
  outer:for(const z of coords[2])for(const y of coords[1])for(const x of coords[0]){if(positions.length>=20000){limited=true;break outer;}positions.push({x,y,z});}
  return {positions,limited};
}
