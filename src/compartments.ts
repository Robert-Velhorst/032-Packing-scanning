import type {Container,ContainerCompartment,DimensionsMm,Evidence,ItemCategory,Placement,PlanItem,PackEntry} from './types.ts';

export const MAX_COMPARTMENTS=12;
export const ITEM_CATEGORIES:ItemCategory[]=['clothing','footwear','electronics','toiletries','medicine','documents','accessories','other'];
const EPS=.01;
type Bag=Pick<Container,'inside'|'compartments'|'lidClearanceMm'>;
type Box=DimensionsMm&{x:number;y:number;z:number};
const evidence=(e:Evidence|undefined)=>!!e&&['estimated','measured','known','user_confirmed','provider'].includes(e.source)&&Number.isFinite(e.confidence)&&e.confidence>=0&&e.confidence<=1&&typeof e.collectedAt==='string'&&Number.isFinite(Date.parse(e.collectedAt));
export function compartmentError(bag:Bag):string|undefined{
  if(bag.compartments===undefined)return;
  if(!Array.isArray(bag.compartments)||bag.compartments.length===0||bag.compartments.length>MAX_COMPARTMENTS)return `Record between one and ${MAX_COMPARTMENTS} usable compartments, or remove compartment planning.`;
  const ids=new Set<string>();
  for(const c of bag.compartments){
    if(!c||typeof c.id!=='string'||!c.id.trim()||c.id.length>100||ids.has(c.id)||typeof c.name!=='string'||!c.name.trim()||c.name.length>80)return 'Give each compartment a name and a unique identifier.';
    ids.add(c.id);
    if(![c.x,c.y,c.z].every(v=>Number.isFinite(v)&&v>=0)||![c.length,c.width,c.height].every(v=>Number.isFinite(v)&&v>0)||c.x+c.length>bag.inside.length+1e-6||c.y+c.width>bag.inside.width+1e-6||c.z+c.height>bag.inside.height+1e-6)return `Keep “${c.name}” inside the bag with a positive size.`;
    if(!c.opening||![c.opening.length,c.opening.width].every(v=>Number.isFinite(v)&&v>0)||c.opening.length>c.length+1e-6||c.opening.width>c.width+1e-6)return `Record the narrowest top opening within “${c.name}”.`;
    if(!evidence(c.evidence))return `Record how you know the dimensions of “${c.name}”.`;
    if(!evidence(c.supportEvidence)||c.supportEvidence.source!=='user_confirmed')return `Review independent top access and the supporting bases of “${c.name}” for packing and travel.`;
    if(c.massLimitGrams!==undefined&&(!Number.isFinite(c.massLimitGrams)||c.massLimitGrams<=0||c.massLimitGrams>100000||!evidence(c.massLimitEvidence)))return `Record a positive contents-weight limit and its source for “${c.name}”.`;
    if(c.allowedCategories!==undefined&&(!Array.isArray(c.allowedCategories)||c.allowedCategories.length===0||new Set(c.allowedCategories).size!==c.allowedCategories.length||c.allowedCategories.some(v=>!ITEM_CATEGORIES.includes(v))))return `Choose valid eligible item categories for “${c.name}”, or allow every category.`;
  }
  for(let i=0;i<bag.compartments.length;i++)for(let j=i+1;j<bag.compartments.length;j++){
    const a=bag.compartments[i],b=bag.compartments[j];
    if(a.x<b.x+b.length-EPS&&a.x+a.length>b.x+EPS&&a.y<b.y+b.width-EPS&&a.y+a.width>b.y+EPS)return `Keep “${a.name}” and “${b.name}” in separate top-access footprints. Stacked or side-opening compartments need a different access model.`;
  }
}
export function compartmentFor(bag:Pick<Container,'compartments'>,id?:string){return id?bag.compartments?.find(c=>c.id===id):undefined;}
export function compartmentKey(c:ContainerCompartment):string{
  return JSON.stringify([c.x,c.y,c.z,c.length,c.width,c.height,c.opening.length,c.opening.width,c.massLimitGrams??null,[...(c.allowedCategories??[])].sort(),c.supportEvidence.source,c.supportEvidence.collectedAt]);
}
export function packingRegions(bag:Bag):Array<Box&{compartmentId?:string}>{
  const top=bag.inside.height-(bag.lidClearanceMm??0);
  return bag.compartments?bag.compartments.map(c=>({x:c.x,y:c.y,z:c.z,length:c.length,width:c.width,height:Math.max(0,Math.min(c.height,top-c.z)),compartmentId:c.id})).filter(c=>c.height>EPS):[{x:0,y:0,z:0,...bag.inside,height:top}];
}
export function fitsCompartment(p:Box&{compartmentId?:string},bag:Bag):boolean{
  if(!bag.compartments)return p.compartmentId===undefined;
  const c=compartmentFor(bag,p.compartmentId);return !!c&&p.x>=c.x-EPS&&p.y>=c.y-EPS&&p.z>=c.z-EPS&&p.x+p.length<=c.x+c.length+EPS&&p.y+p.width<=c.y+c.width+EPS&&p.z+p.height<=Math.min(c.z+c.height,bag.inside.height-(bag.lidClearanceMm??0))+EPS;
}
export function compartmentAssignmentError(entry:Pick<PackEntry,'containerId'|'compartmentId'>):string|undefined{
  if(entry.compartmentId!==undefined&&(typeof entry.compartmentId!=='string'||!entry.compartmentId.trim()||entry.compartmentId.length>100||typeof entry.containerId!=='string'||!entry.containerId.trim()))return 'Choose a bag together with a valid compartment assignment.';
}
export function eligibleForCompartment(item:Pick<PlanItem,'assignedCompartmentId'|'category'>,c?:ContainerCompartment){
  return (!item.assignedCompartmentId||item.assignedCompartmentId===c?.id)&&(!c?.allowedCategories||!!item.category&&c.allowedCategories.includes(item.category));
}
export function compartmentMassError(c:ContainerCompartment|undefined,placements:Placement[],items:Map<string,PlanItem>,added?:PlanItem):string|undefined{
  if(!c?.massLimitGrams)return;
  const contents=placements.filter(p=>p.compartmentId===c.id).map(p=>items.get(p.instanceId));if(added)contents.push(added);
  if(contents.some(i=>i?.upperMassGrams===undefined))return `Add all item weights before relying on the contents limit of “${c.name}”.`;
  if(contents.reduce((sum,i)=>sum+(i?.upperMassGrams??0),0)>c.massLimitGrams+EPS)return `The contents would exceed the recorded weight limit of “${c.name}”.`;
}
