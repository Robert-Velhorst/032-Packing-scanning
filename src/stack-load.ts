import type { Container, Placement, PlanItem, StackLoadCheck } from './types.ts';
import { geometryContactArea, type GravityUp } from './packing-geometry.ts';
import { interiorTravelUp } from './packing-interior.ts';
import { topLoadError } from './stack-load-records.ts';
export { topLoadError } from './stack-load-records.ts';

const CONTACT_EPSILON = 0.01;
type ContactGraph = {above:Map<Placement,Set<Placement>>;below:Map<Placement,Set<Placement>>};

/** Reuses immutable placement-pair geometry during one plan calculation. */
export class StackLoadContactCache {
  private readonly contacts = new WeakMap<Placement, WeakMap<Placement, Map<number, number>>>();
  private readonly committed = new WeakSet<Placement>();
  private readonly registered:Placement[]=[];
  private readonly frames=new Map<number,GravityUp>();
  private readonly graphs=new Map<number,ContactGraph>();
  private readonly items: Map<string, PlanItem>;

  constructor(items: Map<string, PlanItem>) {
    this.items = items;
  }

  register(placement: Placement) {
    if(this.committed.has(placement))return;
    for(const [key,graph] of this.graphs){
      const up=this.frames.get(key)!;
      graph.above.set(placement,new Set());graph.below.set(placement,new Set());
      for(const other of this.registered){
        const aboveArea=geometryContactArea(placement,other,this.items,up);
        this.rememberContact(placement,other,up,aboveArea);
        if(aboveArea>0){graph.above.get(other)!.add(placement);graph.below.get(placement)!.add(other);}
        const belowArea=geometryContactArea(other,placement,this.items,up);
        this.rememberContact(other,placement,up,belowArea);
        if(belowArea>0){graph.above.get(placement)!.add(other);graph.below.get(other)!.add(placement);}
      }
    }
    this.committed.add(placement);
    this.registered.push(placement);
  }

  shouldCache(placements: Placement[], up: GravityUp): boolean {
    return up.axis !== 2 || up.sign !== 1 || placements.some(placement => this.items.get(placement.instanceId)?.packingShape);
  }

  contactArea(upper: Placement, lower: Placement, up: GravityUp): number {
    if (!this.committed.has(upper) || !this.committed.has(lower)) return geometryContactArea(upper, lower, this.items, up);
    let byLower = this.contacts.get(upper);
    if (!byLower) {
      byLower = new WeakMap();
      this.contacts.set(upper, byLower);
    }
    let byFrame = byLower.get(lower);
    if (!byFrame) {
      byFrame = new Map();
      byLower.set(lower, byFrame);
    }
    const key = up.axis * 2 + Number(up.sign < 0);
    if (byFrame.has(key)) return byFrame.get(key)!;
    const area = geometryContactArea(upper, lower, this.items, up);
    byFrame.set(key, area);
    return area;
  }

  /** Reuse committed contacts; only proposed placements need pairwise geometry checks. */
  contactGraph(placements:Placement[],up:GravityUp):Map<Placement,Set<Placement>>{
    const graph=this.ensureGraph(up),included=new Set(placements);
    const direct=new Map<Placement,Set<Placement>>();
    for(const placement of placements)direct.set(placement,new Set([...(graph.above.get(placement)??[])].filter(other=>included.has(other))));
    for(let index=0;index<placements.length;index++)for(let otherIndex=index+1;otherIndex<placements.length;otherIndex++){
      const left=placements[index],right=placements[otherIndex];
      if(this.committed.has(left)&&this.committed.has(right))continue;
      const leftAbove=geometryContactArea(left,right,this.items,up);
      if(leftAbove>0)direct.get(right)!.add(left);
      const rightAbove=geometryContactArea(right,left,this.items,up);
      if(rightAbove>0)direct.get(left)!.add(right);
    }
    return direct;
  }

  wouldCreateStackConflict(candidate:Placement,placements:Placement[],containers:Container[]):boolean{
    const frames:GravityUp[]=[{axis:2,sign:1}];
    for(const bag of containers){if(bag.id!==candidate.containerId||!bag.packingInterior)continue;const up=interiorTravelUp(bag.packingInterior);if(up.axis!==2||up.sign!==1)frames.push(up);}
    return frames.some(up=>this.wouldConflictInFrame(candidate,placements,up));
  }

  private wouldConflictInFrame(candidate:Placement,placements:Placement[],up:GravityUp):boolean{
    const graph=this.ensureGraph(up),aboveNeighbors:Placement[]=[],belowNeighbors:Placement[]=[];
    for(const other of placements){
      if(!mayShareContactBounds(candidate,other))continue;
      if(geometryContactArea(other,candidate,this.items,up)>0)aboveNeighbors.push(other);
      if(geometryContactArea(candidate,other,this.items,up)>0)belowNeighbors.push(other);
    }
    if(!aboveNeighbors.length&&!belowNeighbors.length)return false;
    const reachable=(starts:Placement[],edges:Map<Placement,Set<Placement>>)=>{
      const seen=new Set<Placement>(),pending=[...starts];
      for(let index=0;index<pending.length;index++){const current=pending[index];if(seen.has(current))continue;seen.add(current);pending.push(...(edges.get(current)??[]));}
      return seen;
    };
    const lowerSet=new Set(belowNeighbors),aboveCandidate=new Set<Placement>();
    for(const upper of aboveNeighbors)for(const node of reachable([upper],graph.above)){
      if(lowerSet.has(node))return true;
      aboveCandidate.add(node);
    }
    const affectedBelow=reachable(belowNeighbors,graph.below);
    const loadConflict=(placement:Placement,additional:Placement[]=[],existingAbove=reachable([placement],graph.above)):boolean=>{
      const item=this.items.get(placement.instanceId);
      if(!item)return true;
      const ids=new Set([...existingAbove,...additional].filter(entry=>entry!==placement).map(entry=>entry.instanceId));
      if(!ids.size)return false;
      if(item.fragile)return true;
      const limit=item.maxTopLoadGrams;
      if(limit===undefined)return false;
      let upperLoadGrams=0,unknownMassCount=0;
      for(const id of ids){const mass=this.items.get(id)?.upperMassGrams;if(mass===undefined||!Number.isFinite(mass)||mass<=0)unknownMassCount++;else upperLoadGrams+=mass;}
      return unknownMassCount>0||upperLoadGrams>limit;
    };
    if(loadConflict(candidate,[...aboveCandidate]))return true;
    const propagated=[candidate,...aboveCandidate];
    for(const lower of affectedBelow){
      const existingAbove=reachable([lower],graph.above);
      const additions=propagated.filter(entry=>!existingAbove.has(entry));
      if(loadConflict(lower,additions,existingAbove))return true;
    }
    return false;
  }

  private ensureGraph(up:GravityUp):ContactGraph{
    const key=up.axis*2+Number(up.sign<0),prior=this.graphs.get(key);
    if(prior)return prior;
    this.frames.set(key,up);
    const graph:ContactGraph={above:new Map(this.registered.map(placement=>[placement,new Set<Placement>()])),below:new Map(this.registered.map(placement=>[placement,new Set<Placement>()]))};
    for(let index=0;index<this.registered.length;index++)for(let otherIndex=index+1;otherIndex<this.registered.length;otherIndex++){
      const left=this.registered[index],right=this.registered[otherIndex];
      const leftAbove=this.contactArea(left,right,up);
      if(leftAbove>0){graph.above.get(right)!.add(left);graph.below.get(left)!.add(right);}
      const rightAbove=this.contactArea(right,left,up);
      if(rightAbove>0){graph.above.get(left)!.add(right);graph.below.get(right)!.add(left);}
    }
    this.graphs.set(key,graph);
    return graph;
  }

  private rememberContact(upper:Placement,lower:Placement,up:GravityUp,area:number){
    let byLower=this.contacts.get(upper);
    if(!byLower){byLower=new WeakMap();this.contacts.set(upper,byLower);}
    let byFrame=byLower.get(lower);
    if(!byFrame){byFrame=new Map();byLower.set(lower,byFrame);}
    byFrame.set(up.axis*2+Number(up.sign<0),area);
  }
}

/** Only direct horizontal contact in the same bag. Side contact does not carry load. */
export function supportArea(upper: Placement, lower: Placement): number {
  if (upper.containerId !== lower.containerId || upper.z <= lower.z
    || Math.abs(lower.z + lower.height - upper.z) > CONTACT_EPSILON) return 0;
  const length = Math.min(upper.x + upper.length, lower.x + lower.length) - Math.max(upper.x, lower.x);
  const width = Math.min(upper.y + upper.width, lower.y + lower.width) - Math.max(upper.y, lower.y);
  return length > CONTACT_EPSILON && width > CONTACT_EPSILON ? length * width : 0;
}

/** An isolated placement cannot change the validated stack graph. */
export function hasStackContact(placement: Placement, placed: Placement[], items: Map<string, PlanItem>, container?: Container): boolean {
  if (placed.some(other => mayShareContactBounds(placement, other)
    && (geometryContactArea(placement, other, items) > 0 || geometryContactArea(other, placement, items) > 0))) return true;
  if (!container?.packingInterior) return false;
  const up = interiorTravelUp(container.packingInterior);
  if (up.axis === 2 && up.sign === 1) return false;
  return placed.some(other => mayShareContactBounds(placement, other) && other.containerId === container.id
    && (geometryContactArea(placement, other, items, up) > 0 || geometryContactArea(other, placement, items, up) > 0));
}

/** Reject separated bounds before building or comparing detailed shape faces. */
function mayShareContactBounds(left: Placement, right: Placement): boolean {
  return left.containerId === right.containerId && left.compartmentId === right.compartmentId
    && left.x + left.length >= right.x - CONTACT_EPSILON && right.x + right.length >= left.x - CONTACT_EPSILON
    && left.y + left.width >= right.y - CONTACT_EPSILON && right.y + right.width >= left.y - CONTACT_EPSILON
    && left.z + left.height >= right.z - CONTACT_EPSILON && right.z + right.height >= left.z - CONTACT_EPSILON;
}

/** Conservative static bound: do not assume that a bridge shares its weight evenly. */
export function assessStackLoads(placements: Placement[], items: Map<string, PlanItem>,containers:Container[]=[],contactCache?:StackLoadContactCache): StackLoadCheck[] {
  const packing=assessFrameLoads(placements,items,{axis:2,sign:1},contactCache);
  const travel=containers.flatMap(bag=>{
    if(!bag.packingInterior)return [];
    const bagPlacements=placements.filter(p=>p.containerId===bag.id);
    if(!bagPlacements.length)return [];
    const up=interiorTravelUp(bag.packingInterior);
    if(up.axis===2&&up.sign===1)return [];
    return assessFrameLoads(bagPlacements,items,up,contactCache).map(load=>({...load,orientation:'travel' as const}));
  });
  return [...packing,...travel];
}
function assessFrameLoads(placements:Placement[],items:Map<string,PlanItem>,up:GravityUp,contactCache?:StackLoadContactCache):StackLoadCheck[]{
  const above = new Map(placements.map(p => [p.instanceId, new Set<string>()]));
  const direct=new Map(placements.map(p=>[p.instanceId,new Set<string>()])),cyclic=new Set<string>();
  const cache=contactCache?.shouldCache(placements,up)?contactCache:undefined;
  const rectangularPacking=up.axis===2&&up.sign===1&&placements.every(p=>!items.get(p.instanceId)?.packingShape);
  if(rectangularPacking){
    const below=new Map<string,Placement[]>(),plane=(p:Placement,bucket:number)=>`${p.containerId}\u0000${p.compartmentId??''}\u0000${bucket}`;
    for(const lower of placements){const bucket=Math.floor((lower.z+lower.height)/CONTACT_EPSILON),key=plane(lower,bucket),samePlane=below.get(key)??[];samePlane.push(lower);below.set(key,samePlane);}
    for(const upper of placements){const bucket=Math.floor(upper.z/CONTACT_EPSILON);for(let offset=-2;offset<=2;offset++)for(const lower of below.get(plane(upper,bucket+offset))??[])
      if(geometryContactArea(upper,lower,items,up)>0)direct.get(lower.instanceId)!.add(upper.instanceId);}
  }else if(cache){
    for(const [lower,uppers] of cache.contactGraph(placements,up))for(const upper of uppers)direct.get(lower.instanceId)!.add(upper.instanceId);
  }else for(const upper of placements)for(const lower of placements)if(geometryContactArea(upper,lower,items,up)>0)direct.get(lower.instanceId)!.add(upper.instanceId);
  for(const p of placements){const reached=above.get(p.instanceId)!,pending=[...direct.get(p.instanceId)!];for(let i=0;i<pending.length;i++){
    const id=pending[i];if(id===p.instanceId){cyclic.add(id);continue;}if(reached.has(id))continue;reached.add(id);pending.push(...direct.get(id)!);
  }}
  return placements.map(placement => {
    const item = items.get(placement.instanceId);
    const ids = [...above.get(placement.instanceId)!].sort();
    let upperLoadGrams = 0, unknownMassCount = 0;
    for (const id of ids) {
      const value = items.get(id)?.upperMassGrams;
      if (value === undefined || !Number.isFinite(value) || value <= 0) unknownMassCount++;
      else upperLoadGrams += value;
    }
    const limitGrams = item?.fragile ? 0 : item?.maxTopLoadGrams;
    let reason = item ? topLoadError(item) : 'The supporting item record is missing.';
    if(cyclic.has(placement.instanceId))reason='Interlocking horizontal contacts create a cyclic load path. Load sharing is unverified; separate the items before relying on a stack limit.';
    if (!reason && ids.length) {
      if (item?.fragile || limitGrams === 0) reason = 'Nothing may rest on this fragile or no-stack item.';
      else if (limitGrams !== undefined && unknownMassCount) reason = 'Unknown weight above prevents checking the recorded stacking limit.';
      else if (limitGrams !== undefined && upperLoadGrams > limitGrams) reason = 'The cumulative upper saved weight above exceeds the recorded stacking limit.';
    }
    const status = reason ? 'conflict' : !ids.length ? 'clear'
      : limitGrams === undefined ? 'unverified' : 'within_recorded_limit';
    return { instanceId: placement.instanceId, containerId: placement.containerId,
      aboveInstanceIds: ids, upperLoadGrams, unknownMassCount, limitGrams, status, ...(reason ? { reason } : {}) };
  });
}
