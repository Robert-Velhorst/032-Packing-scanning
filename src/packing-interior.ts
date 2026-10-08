import type { Container,DimensionsMm,PackingInterior } from './types.ts';
import {parseInteriorCavity} from './scanning/interior-cavity.ts';
import {voxelSurface,type SolidSurface} from './scanning/reconstructed-solid.ts';
export type InteriorBox=DimensionsMm&{x:number;y:number;z:number};
export interface InteriorGeometry {
  dimensions:DimensionsMm; grid:{x:number;y:number;z:number}; cellSizeMm:DimensionsMm;
  freeCells:number[]; freeBoxes:InteriorBox[]; blockedBoxes:InteriorBox[]; surface:SolidSurface;
  sourceOffsetMm:{x:number;y:number;z:number}; key:string;
}
const axes=['length','width','height'] as const;
const cache=new WeakMap<PackingInterior,InteriorGeometry>();
const validDate=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));

export function packingInteriorError(bag:Pick<Container,'inside'|'packingInterior'>):string|undefined {
  if(bag.packingInterior===undefined)return;
  try{
    const model=bag.packingInterior;
    if(!model||!model.cavity||!validDate(model.adoptedAt)||!Number.isFinite(model.scale)||model.scale<=0
      ||!model.evidence||model.evidence.source!=='user_confirmed'||!validDate(model.evidence.collectedAt)
      ||!Number.isFinite(model.evidence.confidence)||model.evidence.confidence<0||model.evidence.confidence>1)throw Error();
    const compiled=interiorGeometry(model);
    if(model.supportReview!==undefined&&supportReviewError(model))throw Error();
    if(!bag.inside||axes.some(axis=>!Number.isFinite(bag.inside[axis])||Math.abs(bag.inside[axis]-compiled.dimensions[axis])>1e-6))throw Error();
  }catch{return 'The adopted interior is invalid or no longer matches this bag. Review it again or use recorded rectangular space. Saved packed positions remain unchanged.';}
}

/** Proper source-axis rotation: the reviewed entry always faces upward. */
export function interiorFrame(axis:number,sign:number) {
  if(![0,1,2].includes(axis)||![1,-1].includes(sign))throw Error('Invalid entry end.');
  return axis===0?{axis:[1,2,0],sign:[1,sign,sign]}:
    axis===1?{axis:[0,2,1],sign:[1,-sign,sign]}:{axis:[0,1,2],sign:[1,sign,sign]};
}

export function interiorGeometry(model:PackingInterior):InteriorGeometry {
  const prior=cache.get(model);if(prior)return prior;
  const cavity=model.cavity;
  if(!cavity||!Number.isFinite(model.scale)||model.scale<=0||!validDate(model.adoptedAt)
    ||!model.travelUp||![0,1,2].includes(model.travelUp.axis)||![1,-1].includes(model.travelUp.sign)
    ||!/^[a-f0-9]{64}$/.test(cavity.sourceHash)||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(cavity.id))throw Error('Invalid interior source.');
  parseInteriorCavity(cavity,{id:cavity.id,target:'container_interior',format:'point_cloud_preview',units:'millimetres',sourceHash:cavity.sourceHash,pointCount:cavity.sourcePointCount,
    samplePointCount:0,pointsMm:[],envelope:{method:'oriented_surface_envelope_v1',basis:'capture_aligned',paddingMm:2.5,dimensionsMm:cavity.boundsMm}},
    {openingAxis:cavity.opening.axis,openingSign:cavity.opening.sign,seedMm:cavity.seedMm});
  const frame=interiorFrame(cavity.opening.axis,cavity.opening.sign),sourceGrid=[cavity.grid.x,cavity.grid.y,cavity.grid.z];
  const size=frame.axis.map(a=>cavity.cellSizeMm[axes[a]]*model.scale);
  if(size.some(v=>!Number.isFinite(v)||v<=.01))throw Error('Invalid interior scale.');
  const points=cavity.freeCells.map(cell=>{
    const xyz=[cell%sourceGrid[0],Math.floor(cell/sourceGrid[0])%sourceGrid[1],Math.floor(cell/(sourceGrid[0]*sourceGrid[1]))];
    return frame.axis.map((a,i)=>frame.sign[i]===1?xyz[a]:sourceGrid[a]-1-xyz[a]);
  });
  // Rebase at the lowest free floor and smallest free horizontal sides. No free
  // cells are removed: observed boundary-wall thickness remains outside the frame.
  const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let i=0;i<3;i++){mins[i]=Math.min(mins[i],p[i]);maxs[i]=Math.max(maxs[i],p[i]);}
  const dims=maxs.map((v,i)=>v-mins[i]+1),grid={x:dims[0],y:dims[1],z:dims[2]};
  const dimensions={length:dims[0]*size[0],width:dims[1]*size[1],height:dims[2]*size[2]};
  if(axes.some(a=>!Number.isFinite(dimensions[a])||dimensions[a]>10000))throw Error('Invalid interior size.');
  const freeCells=points.map(p=>(p[0]-mins[0])+grid.x*((p[1]-mins[1])+grid.y*(p[2]-mins[2]))).sort((a,b)=>a-b);
  const present=new Uint8Array(grid.x*grid.y*grid.z);for(const cell of freeCells)present[cell]=1;
  const freeBoxes=cuboids(present,grid,size),blockedBoxes=cuboids(present.map(v=>1-v),grid,size);
  const reference=voxelSurface({grid,resolutionMm:10,occupiedCells:freeCells});
  const surface={...reference,verticesMm:reference.verticesMm.map((v,i)=>v*size[i%3]/10),volumeMm3:freeCells.length*size[0]*size[1]*size[2]};
  let fingerprint=2166136261;for(const cells of [cavity.observedCells,cavity.freeCells])for(const cell of cells)fingerprint=Math.imul(fingerprint^cell,16777619)>>>0;
  const key=[cavity.sourceHash,sourceGrid.join(','),cavity.opening.axis,cavity.opening.sign,model.travelUp.axis,model.travelUp.sign,axes.map(a=>cavity.boundsMm[a].toPrecision(15)).join(','),model.scale.toPrecision(15),fingerprint.toString(16)].join(':');
  const compiled={dimensions,grid,cellSizeMm:{length:size[0],width:size[1],height:size[2]},freeCells,freeBoxes,blockedBoxes,surface,
    sourceOffsetMm:{x:mins[0]*size[0],y:mins[1]*size[1],z:mins[2]*size[2]},key};
  cache.set(model,compiled);return compiled;
}

function cuboids(mask:Uint8Array,grid:{x:number;y:number;z:number},size:number[]):InteriorBox[]{
  const {x:nx,y:ny,z:nz}=grid,remaining=mask.slice(),index=(x:number,y:number,z:number)=>x+nx*(y+ny*z),boxes:InteriorBox[]=[];
  for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)if(remaining[index(x,y,z)]){
    let right=x+1;while(right<nx&&remaining[index(right,y,z)])right++;
    let back=y+1;while(back<ny){let full=true;for(let a=x;a<right;a++)if(!remaining[index(a,back,z)]){full=false;break;}if(!full)break;back++;}
    let top=z+1;while(top<nz){let full=true;for(let b=y;b<back&&full;b++)for(let a=x;a<right;a++)if(!remaining[index(a,b,top)]){full=false;break;}if(!full)break;top++;}
    for(let c=z;c<top;c++)for(let b=y;b<back;b++)for(let a=x;a<right;a++)remaining[index(a,b,c)]=0;
    boxes.push({x:x*size[0],y:y*size[1],z:z*size[2],length:(right-x)*size[0],width:(back-y)*size[1],height:(top-z)*size[2]});
  }
  return boxes;
}
export const interiorKey=(model?:PackingInterior)=>model?interiorGeometry(model).key:undefined;
export function adoptInterior(cavity:PackingInterior['cavity'],travelUp:PackingInterior['travelUp'],scale=1,at=new Date().toISOString()):PackingInterior{
  const model:PackingInterior={cavity:structuredClone(cavity),travelUp:{...travelUp},scale,adoptedAt:at,evidence:{source:'user_confirmed',confidence:1,collectedAt:at,note:'Traveller reviewed the opening, empty seed, travel-up end and cavity; confirmed the lowest floor assumption and rechecked recorded regions in the new inside frame. Geometry remains estimated; support strength, closure and fit are not verified.'}};
  if(packingInteriorError({inside:interiorGeometry(model).dimensions,packingInterior:model}))throw Error('Review this interior again.');
  return confirmInteriorSupport(model,at);
}
export function interiorTravelUp(model:PackingInterior):{axis:number;sign:number}{
  const frame=interiorFrame(model.cavity.opening.axis,model.cavity.opening.sign),axis=frame.axis.indexOf(model.travelUp.axis);
  return {axis,sign:frame.sign[axis]*model.travelUp.sign};
}
export function interiorTravelLabel(model:PackingInterior):string{
  const up=interiorTravelUp(model);return [['left','right'],['front','back'],['bottom','top']][up.axis][up.sign===1?1:0];
}

function supportReviewError(model:PackingInterior):string|undefined {
  const review=model.supportReview;
  if(!review||review.captureId!==model.cavity.id||review.sourceHash!==model.cavity.sourceHash
    ||review.scale!==model.scale||!review.travelUp||review.travelUp.axis!==model.travelUp.axis||review.travelUp.sign!==model.travelUp.sign
    ||!review.evidence||review.evidence.source!=='user_confirmed'||!validDate(review.evidence.collectedAt)
    ||!Number.isFinite(review.evidence.confidence)||review.evidence.confidence<0||review.evidence.confidence>1)
    return 'Review the packing floor, travel base and applicable stacking limits for this source, scale and travel end before planning.';
}
export function interiorSupportError(model?:PackingInterior):string|undefined {
  if(!model)return;
  const up=interiorTravelUp(model);
  if(up.axis===2&&up.sign===-1)return 'The reviewed travel direction puts the reconstructed opening underneath. Its boundary cap is not an observed supporting lid. Choose another travel-up end or record a physically checked rectangular interior.';
  if(up.axis!==2||up.sign!==1)return supportReviewError(model);
  if(model.supportReview)return supportReviewError(model);
}
/** An explicit support review is separate from geometric/source validity. */
export function confirmInteriorSupport(model:PackingInterior,at=new Date().toISOString()):PackingInterior{
  if(!validDate(at))throw Error('Record a valid support-review time.');
  interiorGeometry(model);
  const up=interiorTravelUp(model);
  if(up.axis===2&&up.sign===-1)throw Error(interiorSupportError(model));
  return {...model,supportReview:{captureId:model.cavity.id,sourceHash:model.cavity.sourceHash,scale:model.scale,travelUp:{...model.travelUp},
    evidence:{source:'user_confirmed',confidence:1,collectedAt:at,note:'Traveller checked the lowest packing floor and closed travel base, support strength and that recorded stacking limits apply to both orientations. This is a handling assumption, not sensor verification or physical certification.'}}};
}
export function hasInteriorSupportReview(model:PackingInterior):boolean{return !!model.supportReview&&!supportReviewError(model);}
