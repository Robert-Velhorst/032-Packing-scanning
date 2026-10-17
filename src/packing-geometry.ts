import {compartmentFor,fitsCompartment} from './compartments.ts';
import type { Container, DimensionsMm, LibraryItem, PackingShape, Placement } from './types.ts';
import { parseReconstructedSolid, type SolidSurface } from './scanning/reconstructed-solid.ts';
import { containerBlockedBoxes,containerSpaceError, usableContainerHeight, type SpaceBox } from './container-space.ts';
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
    let back=y+1;
    while(back<ny){let filled=true;for(let a=x;a<right;a++)if(!present[idx(a,back,z)]){filled=false;break;}if(!filled)break;back++;}
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
function translatedBoxesIntersect(a:GeometryBox,ax:number,ay:number,az:number,b:GeometryBox,bx:number,by:number,bz:number):boolean {
  const leftX=ax+a.x,leftY=ay+a.y,leftZ=az+a.z,rightX=bx+b.x,rightY=by+b.y,rightZ=bz+b.z;
  return leftX<rightX+b.length-EPS&&leftX+a.length>rightX+EPS
    &&leftY<rightY+b.width-EPS&&leftY+a.width>rightY+EPS
    &&leftZ<rightZ+b.height-EPS&&leftZ+a.height>rightZ+EPS;
}
export function geometryIntersects(a:Placement,b:Placement,items:Map<string,ShapeItem>):boolean {
  if(!boxesIntersect(a,b))return false;
  const leftItem=items.get(a.instanceId),rightItem=items.get(b.instanceId);
  const leftBoxes=leftItem?.packingShape?localGeometry(leftItem.packingShape,a.rotation??0).boxes:undefined;
  const rightBoxes=rightItem?.packingShape?localGeometry(rightItem.packingShape,b.rotation??0).boxes:undefined;
  if(!leftBoxes&&!rightBoxes)return true;
  if(leftBoxes&&rightBoxes){
    for(const left of leftBoxes)for(const right of rightBoxes)if(translatedBoxesIntersect(left,a.x,a.y,a.z,right,b.x,b.y,b.z))return true;
    return false;
  }
  if(leftBoxes){for(const left of leftBoxes)if(translatedBoxesIntersect(left,a.x,a.y,a.z,b,0,0,0))return true;return false;}
  for(const right of rightBoxes!)if(translatedBoxesIntersect(a,0,0,0,right,b.x,b.y,b.z))return true;
  return false;
}
export function fitsGeometrySpace(p:Placement,bag:Container,item?:ShapeItem):boolean {
  if(containerSpaceError(bag))return false;
  return fitsGeometrySpaceInValidatedContainer(p,bag,item);
}
/** Use only after validating this unchanged bag record for the current plan. */
export function fitsGeometrySpaceInValidatedContainer(p:Placement,bag:Container,item?:ShapeItem,blockedSpaces:readonly SpaceBox[]=containerBlockedBoxes(bag)):boolean {
  const usableHeight=bag.inside.height-(bag.lidClearanceMm??0);
  if(!fitsCompartment(p,bag)||p.x<0||p.y<0||p.z<0||p.x+p.length>bag.inside.length+EPS||p.y+p.width>bag.inside.width+EPS||p.z+p.height>usableHeight+EPS)return false;
  // This gate runs for every candidate; compare local shape boxes by offset instead of allocating translated boxes.
  if(!blockedSpaces.length)return true;
  if(!item?.packingShape){for(const blocked of blockedSpaces)if(boxesIntersect(p,blocked))return false;return true;}
  for(const box of localGeometry(item.packingShape,p.rotation??0).boxes)
    for(const blocked of blockedSpaces)if(translatedBoxesIntersect(box,p.x,p.y,p.z,blocked,0,0,0))return false;
  return true;
}
/** Proper axis rotation; negative coordinates are deliberate and retain exact contact. */
export function gravityBox(box:GeometryBox,up:GravityUp):GeometryBox{
  if(up.axis===2&&up.sign===1)return box;
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
function facePatches(p:Placement,item:ShapeItem|undefined,side:'bottom'|'down'|'top',up:GravityUp=packingUp):{patches:Face[];offsetX:number;offsetY:number;offsetZ:number} {
  if(up.axis!==2||up.sign!==1){
    const frame=interiorFrame(up.axis,up.sign),origin=[p.x,p.y,p.z],offset=frame.axis.map((a,i)=>frame.sign[i]*origin[a]);
    let patches:ContactFaces;
    const localBounds=gravityBox({x:0,y:0,z:0,length:p.length,width:p.width,height:p.height},up);
    if(item?.packingShape){
      const geometry=localGeometry(item.packingShape,p.rotation),key=up.axis+':'+up.sign;
      patches=geometry.directional.get(key)??contactFaces(geometry.boxes.map(b=>gravityBox(b,up)),localBounds.z);
      geometry.directional.set(key,patches);
    }else patches=contactFaces([localBounds],localBounds.z);
    return {patches:patches[side],offsetX:offset[0],offsetY:offset[1],offsetZ:offset[2]};
  }
  const local=item?.packingShape?localGeometry(item.packingShape,p.rotation)[side]:[{x:0,y:0,z:side==='top'?p.height:0,length:p.length,width:p.width}];
  return {patches:local,offsetX:p.x,offsetY:p.y,offsetZ:p.z};
}
export function geometrySupportArea(upper:Placement,lower:Placement,items:Map<string,ShapeItem>,up:GravityUp=packingUp):number {
  if(upper.containerId!==lower.containerId||upper.compartmentId!==lower.compartmentId)return 0;
  const upperItem=items.get(upper.instanceId),lowerItem=items.get(lower.instanceId);
  if(up.axis===2&&up.sign===1&&upperItem?.packingShape&&!lowerItem?.packingShape){
    if(upper.z<=lower.z+EPS||Math.abs(upper.z-(lower.z+lower.height))>EPS)return 0;
    if(Math.min(upper.x+upper.length,lower.x+lower.length)-Math.max(upper.x,lower.x)<=EPS
      ||Math.min(upper.y+upper.width,lower.y+lower.width)-Math.max(upper.y,lower.y)<=EPS)return 0;
    let area=0;
    for(const base of localGeometry(upperItem.packingShape,upper.rotation??0).bottom){
      const length=Math.min(upper.x+base.x+base.length,lower.x+lower.length)-Math.max(upper.x+base.x,lower.x);
      const width=Math.min(upper.y+base.y+base.width,lower.y+lower.width)-Math.max(upper.y+base.y,lower.y);
      if(length>EPS&&width>EPS)area+=length*width;
    }
    return area;
  }
  if(up.axis===2&&up.sign===1&&!items.get(upper.instanceId)?.packingShape&&!items.get(lower.instanceId)?.packingShape){
    if(upper.z<=lower.z+EPS)return 0;
    return rectangleFaceContact(upper,lower);
  }
  const upperBounds=gravityBox(upper,up),lowerBounds=gravityBox(lower,up);
  if(upperBounds.z<=lowerBounds.z+EPS||upperBounds.z>lowerBounds.z+lowerBounds.height+EPS
    ||upperBounds.x+upperBounds.length<=lowerBounds.x+EPS||lowerBounds.x+lowerBounds.length<=upperBounds.x+EPS
    ||upperBounds.y+upperBounds.width<=lowerBounds.y+EPS||lowerBounds.y+lowerBounds.width<=upperBounds.y+EPS)return 0;
  return faceContact(upper,lower,items,'bottom',up);
}
export function geometryContactArea(upper:Placement,lower:Placement,items:Map<string,ShapeItem>,up:GravityUp=packingUp):number {
  if(upper.instanceId===lower.instanceId||upper.containerId!==lower.containerId||upper.compartmentId!==lower.compartmentId)return 0;
  const upperBounds=gravityBox(upper,up),lowerBounds=gravityBox(lower,up);
  if(upperBounds.x+upperBounds.length<=lowerBounds.x+EPS||lowerBounds.x+lowerBounds.length<=upperBounds.x+EPS
    ||upperBounds.y+upperBounds.width<=lowerBounds.y+EPS||lowerBounds.y+lowerBounds.width<=upperBounds.y+EPS
    ||upperBounds.z+upperBounds.height<lowerBounds.z-EPS||lowerBounds.z+lowerBounds.height<upperBounds.z-EPS)return 0;
  return faceContact(upper,lower,items,'down',up);
}
function faceContact(upper:Placement,lower:Placement,items:Map<string,ShapeItem>,side:'bottom'|'down',up:GravityUp):number {
  const upperItem=items.get(upper.instanceId),lowerItem=items.get(lower.instanceId);
  if(up.axis===2&&up.sign===1&&!upperItem?.packingShape&&!lowerItem?.packingShape){
    return rectangleFaceContact(upper,lower);
  }
  let area=0;
  const bases=facePatches(upper,upperItem,side,up),tops=facePatches(lower,lowerItem,'top',up);
  for(const base of bases.patches)for(const top of tops.patches)if(Math.abs(base.z+bases.offsetZ-top.z-tops.offsetZ)<=EPS){
    const l=Math.min(base.x+bases.offsetX+base.length,top.x+tops.offsetX+top.length)-Math.max(base.x+bases.offsetX,top.x+tops.offsetX),w=Math.min(base.y+bases.offsetY+base.width,top.y+tops.offsetY+top.width)-Math.max(base.y+bases.offsetY,top.y+tops.offsetY);
    if(l>EPS&&w>EPS)area+=l*w;
  }
  return area;
}
function rectangleFaceContact(upper:GeometryBox,lower:GeometryBox):number {
  if(Math.abs(upper.z-(lower.z+lower.height))>EPS)return 0;
  const length=Math.min(upper.x+upper.length,lower.x+lower.length)-Math.max(upper.x,lower.x);
  const width=Math.min(upper.y+upper.width,lower.y+lower.width)-Math.max(upper.y,lower.y);
  return length>EPS&&width>EPS?length*width:0;
}
type SupportPlaneGroup={shapes:Placement[];rectangles:Map<number,Placement[]>};
/** Incremental candidate index for rectangular supports; shaped tops may be stepped. */
export class RectangularSupportIndex {
  private readonly groups=new Map<string,Map<string|undefined,SupportPlaneGroup>>();
  private readonly order=new Map<string,number>();
  private readonly candidateCache=new Map<SupportPlaneGroup,Map<number,Placement[]>>();
  private nextOrder=0;
  private readonly items:Map<string,ShapeItem>;
  constructor(items:Map<string,ShapeItem>,placements:Placement[]=[]){this.items=items;for(const placement of placements)this.add(placement);}
  add(placement:Placement){
    let compartments=this.groups.get(placement.containerId);if(!compartments){compartments=new Map();this.groups.set(placement.containerId,compartments);}
    let group=compartments.get(placement.compartmentId);if(!group){group={shapes:[],rectangles:new Map()};compartments.set(placement.compartmentId,group);}
    this.candidateCache.delete(group);
    this.order.set(placement.instanceId,this.nextOrder++);
    if(this.items.get(placement.instanceId)?.packingShape){group.shapes.push(placement);return;}
    const plane=Math.floor((placement.z+placement.height)/(2*EPS)),bucket=group.rectangles.get(plane)??[];
    bucket.push(placement);group.rectangles.set(plane,bucket);
  }
  candidates(placement:Placement){
    const group=this.groups.get(placement.containerId)?.get(placement.compartmentId);if(!group)return [];
    const plane=Math.floor(placement.z/(2*EPS)),lower=group.rectangles.get(plane-1),center=group.rectangles.get(plane),upper=group.rectangles.get(plane+1);
    const rectanglePlanes=Number(!!lower)+Number(!!center)+Number(!!upper);
    if(!group.shapes.length&&rectanglePlanes===1)return lower??center??upper!;
    if(!group.shapes.length&&rectanglePlanes===0)return [];
    const cached=this.candidateCache.get(group)?.get(plane);if(cached)return cached;
    const candidates=group.shapes.length?[...group.shapes]:[];
    if(lower)candidates.push(...lower);if(center)candidates.push(...center);if(upper)candidates.push(...upper);
    if(rectanglePlanes>1||(group.shapes.length>0&&rectanglePlanes>0))candidates.sort((left,right)=>(this.order.get(left.instanceId)??0)-(this.order.get(right.instanceId)??0));
    let byPlane=this.candidateCache.get(group);if(!byPlane){byPlane=new Map();this.candidateCache.set(group,byPlane);}if(byPlane.size>=64)byPlane.clear();byPlane.set(plane,candidates);
    return candidates;
  }
}
export function hasGeometrySupport(p:Placement,placed:Placement[],items:Map<string,ShapeItem>,fraction:number,up:GravityUp=packingUp,floor=0,supportIndex?:RectangularSupportIndex):boolean {
  if(up.axis===2&&up.sign===1&&!items.get(p.instanceId)?.packingShape){
    const area=p.length*p.width;if(area<=0)return false;if(Math.abs(p.z-floor)<=EPS)return true;
    const required=area*fraction;let supported=0;
    const indexedCandidates=supportIndex?.candidates(p);
    for(const lower of indexedCandidates??placed){
      if(!indexedCandidates&&(lower.containerId!==p.containerId||lower.compartmentId!==p.compartmentId))continue;
      if(items.get(lower.instanceId)?.packingShape){
        if(up.axis===2&&up.sign===1&&!maySharePackingSupportFace(p,lower))continue;
        supported+=geometrySupportArea(p,lower,items,up);
      }
      else{
        if(p.z<=lower.z+EPS||Math.abs(p.z-(lower.z+lower.height))>EPS)continue;
        const length=Math.min(p.x+p.length,lower.x+lower.length)-Math.max(p.x,lower.x);
        const width=Math.min(p.y+p.width,lower.y+lower.width)-Math.max(p.y,lower.y);
        if(length>EPS&&width>EPS)supported+=length*width;
      }
      if(supported+EPS**2>=required)return true;
    }
    return false;
  }
  const area=facePatches(p,items.get(p.instanceId),'bottom',up).patches.reduce((sum,f)=>sum+f.length*f.width,0);
  if(area<=0)return false;if(Math.abs(gravityBox(p,up).z-floor)<=EPS)return true;
  const required=area*fraction;let supported=0;
  const candidates=up.axis===2&&up.sign===1&&supportIndex?supportIndex.candidates(p):placed;
  for(const lower of candidates){
    if(up.axis===2&&up.sign===1&&!maySharePackingSupportFace(p,lower))continue;
    supported+=geometrySupportArea(p,lower,items,up);if(supported+EPS**2>=required)return true;
  }
  return false;
}
function maySharePackingSupportFace(upper:Placement,lower:Placement):boolean{
  return upper.z>lower.z+EPS&&upper.z<=lower.z+lower.height+EPS
    &&upper.x+upper.length>lower.x+EPS&&lower.x+lower.length>upper.x+EPS
    &&upper.y+upper.width>lower.y+EPS&&lower.y+lower.width>upper.y+EPS;
}
/** Both snapshots must be supported; unavailable-region tops never become supports. */
export function hasPackingAndTravelSupport(p:Placement,placed:Placement[],items:Map<string,ShapeItem>,fraction:number,bag:Container,supportIndex?:RectangularSupportIndex):boolean{
  const compartment=compartmentFor(bag,p.compartmentId);
  const supported=supportIndex?hasGeometrySupport(p,placed,items,fraction,packingUp,compartment?.z??0,supportIndex):hasGeometrySupport(p,placed,items,fraction,packingUp,compartment?.z??0);
  if(!supported)return false;
  if(!bag.packingInterior)return true;
  if(interiorSupportError(bag.packingInterior))return false;
  const up=interiorTravelUp(bag.packingInterior);
  if(up.axis===2&&up.sign===1)return true;
  const origin=compartment?[compartment.x,compartment.y,compartment.z][up.axis]:0;
  const floor=up.sign===1?origin:-(origin+(compartment??bag.inside)[axes[up.axis]]);
  return hasGeometrySupport(p,placed,items,fraction,up,floor);
}
export function obstaclePrefixMaxRight(obstacles:readonly GeometryBox[]):number[]{
  const prefix:number[]=[];let maxRight=Number.NEGATIVE_INFINITY;
  for(const obstacle of obstacles){maxRight=Math.max(maxRight,obstacle.x+obstacle.length);prefix.push(maxRight);}
  return prefix;
}
/** Insert new obstacles into an x-sorted list and update only the affected prefix suffix. */
export function insertObstaclePrefixMaxRight(obstacles:GeometryBox[],prefixMaxRight:number[],additions:readonly GeometryBox[]):void{
  if(additions.length>1){
    const sortedAdditions=[...additions].sort((left,right)=>left.x-right.x),merged:GeometryBox[]=[];
    let existingIndex=0,additionIndex=0,maxRight=Number.NEGATIVE_INFINITY;
    while(existingIndex<obstacles.length||additionIndex<sortedAdditions.length){
      const obstacle=additionIndex>=sortedAdditions.length||existingIndex<obstacles.length&&obstacles[existingIndex].x<=sortedAdditions[additionIndex].x
        ?obstacles[existingIndex++]:sortedAdditions[additionIndex++];
      merged.push(obstacle);maxRight=Math.max(maxRight,obstacle.x+obstacle.length);prefixMaxRight[merged.length-1]=maxRight;
    }
    obstacles.length=0;for(const obstacle of merged)obstacles.push(obstacle);
    prefixMaxRight.length=merged.length;
    return;
  }
  for(const obstacle of additions){
    let low=0,high=obstacles.length;
    while(low<high){const middle=(low+high)>>>1;if(obstacles[middle].x<=obstacle.x)low=middle+1;else high=middle;}
    obstacles.splice(low,0,obstacle);prefixMaxRight.splice(low,0,0);
    let maxRight=low?prefixMaxRight[low-1]:Number.NEGATIVE_INFINITY;
    for(let index=low;index<obstacles.length;index++){
      maxRight=Math.max(maxRight,obstacles[index].x+obstacles[index].length);
      prefixMaxRight[index]=maxRight;
    }
  }
}
function firstPotentialObstacle(obstacles:readonly GeometryBox[],x:number,maxObstacleLength:number|undefined,sortedByX:boolean,prefixMaxRight?:readonly number[]):number{
  if(!sortedByX)return 0;
  let low=0,high=obstacles.length;
  if(prefixMaxRight){
    const threshold=x+EPS;
    while(low<high){const middle=(low+high)>>>1;if(prefixMaxRight[middle]<=threshold)low=middle+1;else high=middle;}
    return low;
  }
  if(maxObstacleLength===undefined)return 0;
  const threshold=x-maxObstacleLength-EPS;
  while(low<high){const middle=(low+high)>>>1;if(obstacles[middle].x<threshold)low=middle+1;else high=middle;}
  return low;
}
/** Fixed orientation, straight downward entry: recesses must remain reachable from above. */
export function hasVerticalEntry(p:Placement,placed:Placement[],items:Map<string,ShapeItem>,bag:Container,blockedSpaces:readonly SpaceBox[]=containerBlockedBoxes(bag),cachedObstacles?:readonly GeometryBox[],obstaclesSortedByX=false,maxObstacleLength?:number,prefixMaxRight?:readonly number[]):boolean {
  // Every component of an in-bounds shape shares the same sweep top.
  const top=bag.inside.height,fullSweepTop=p.z+p.height<=top?top+p.height:undefined;
  const obstacles=cachedObstacles??[...blockedSpaces,...placed.filter(other=>other.containerId===p.containerId).flatMap(other=>placementBoxes(other,items.get(other.instanceId)))];
  // Keep both rectangular and shaped candidate sweeps allocation-free.
  const shape=items.get(p.instanceId)?.packingShape;
  if(!shape){
    const sweepTop=p.z+Math.max(p.height,top-p.z+p.height),right=p.x+p.length,back=p.y+p.width;
    for(let i=firstPotentialObstacle(obstacles,p.x,maxObstacleLength,obstaclesSortedByX,prefixMaxRight);i<obstacles.length;i++){const o=obstacles[i];if(obstaclesSortedByX&&o.x>=right-EPS)break;if(p.x<o.x+o.length-EPS&&right>o.x+EPS&&p.y<o.y+o.width-EPS&&back>o.y+EPS&&p.z<o.z+o.height-EPS&&sweepTop>o.z+EPS)return false;}
    return true;
  }
  for(const b of localGeometry(shape,p.rotation??0).boxes){
    const x=p.x+b.x,y=p.y+b.y,z=p.z+b.z,right=x+b.length,back=y+b.width,sweepTop=fullSweepTop??z+Math.max(b.height,top-z+p.height);
    for(let i=firstPotentialObstacle(obstacles,x,maxObstacleLength,obstaclesSortedByX,prefixMaxRight);i<obstacles.length;i++){const o=obstacles[i];if(obstaclesSortedByX&&o.x>=right-EPS)break;if(x<o.x+o.length-EPS&&right>o.x+EPS&&y<o.y+o.width-EPS&&back>o.y+EPS&&z<o.z+o.height-EPS&&sweepTop>o.z+EPS)return false;}
  }
  return true;
}

export function contactPositions(bag:Container,orientation:DimensionsMm&{rotation:number},item:ShapeItem,placed:Placement[],items:Map<string,ShapeItem>,region:GeometryBox={x:0,y:0,z:0,...bag.inside,height:usableContainerHeight(bag)},blockedSpaces:readonly SpaceBox[]=containerBlockedBoxes(bag),cachedObstacles?:readonly GeometryBox[],maxPositions=20000,collisionObstacles?:readonly GeometryBox[],collisionObstaclePrefixMaxRight?:readonly number[]) {
  const local=item.packingShape?localGeometry(item.packingShape,orientation.rotation).boxes:[{x:0,y:0,z:0,length:orientation.length,width:orientation.width,height:orientation.height}],obstacles=cachedObstacles??[...placed.flatMap(p=>placementBoxes(p,items.get(p.instanceId))),...blockedSpaces];
  let indexedCollisionObstacles=collisionObstacles,indexedCollisionPrefix=collisionObstaclePrefixMaxRight;
  if(collisionObstacles&&!indexedCollisionPrefix){indexedCollisionObstacles=[...collisionObstacles].sort((a,b)=>a.x-b.x);indexedCollisionPrefix=obstaclePrefixMaxRight(indexedCollisionObstacles);}
  const minimum=[region.x,region.y,region.z],maximum=[region.x+region.length-orientation.length,region.y+region.width-orientation.width,region.z+region.height-orientation.height];
  const values=[new Set([minimum[0],maximum[0]]),new Set([minimum[1],maximum[1]]),new Set([minimum[2]])];
  for(const b of obstacles)for(const c of local){
    const right=b.x+b.length-c.x,left=b.x-c.x-c.length;
    if(right>=minimum[0]-EPS&&right<=maximum[0]+EPS)values[0].add(Math.max(minimum[0],right));
    if(left>=minimum[0]-EPS&&left<=maximum[0]+EPS)values[0].add(Math.max(minimum[0],left));
    const back=b.y+b.width-c.y,front=b.y-c.y-c.width;
    if(back>=minimum[1]-EPS&&back<=maximum[1]+EPS)values[1].add(Math.max(minimum[1],back));
    if(front>=minimum[1]-EPS&&front<=maximum[1]+EPS)values[1].add(Math.max(minimum[1],front));
    const top=b.z+b.height-c.z;
    if(top>=minimum[2]-EPS&&top<=maximum[2]+EPS)values[2].add(Math.max(minimum[2],top));
  }
  const coords=values.map(set=>[...set].sort((a,b)=>a-b));
  const positions:Array<{x:number;y:number;z:number}>=[];let limited=false,examined=0;
  outer:for(const z of coords[2])for(const y of coords[1])for(const x of coords[0]){
    if(examined>=maxPositions){limited=true;break outer;}
    examined++;
    // Reject overlaps before allocating positions; count rejected coordinates against the same search cap.
    if(indexedCollisionObstacles){
      let collision=false;
      for(const box of local){
        const left=x+box.x,right=left+box.length;
        for(let obstacleIndex=firstPotentialObstacle(indexedCollisionObstacles,left,undefined,true,indexedCollisionPrefix);obstacleIndex<indexedCollisionObstacles.length;obstacleIndex++){
          const obstacle=indexedCollisionObstacles[obstacleIndex];if(obstacle.x>=right-EPS)break;
          if(translatedBoxesIntersect(box,x,y,z,obstacle,0,0,0)){collision=true;break;}
        }
        if(collision)break;
      }
      if(collision)continue;
    }
    positions.push({x,y,z});
  }
  return {positions,limited};
}
