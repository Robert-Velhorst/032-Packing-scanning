import type { Container, Evidence, LibraryItem, Placement, PlanItem, StackLoadCheck } from './types.ts';
import { geometryContactArea, type GravityUp } from './packing-geometry.ts';
import { interiorTravelUp } from './packing-interior.ts';

const CONTACT_EPSILON = 0.01;
type LoadItem = Pick<LibraryItem, 'fragile' | 'maxTopLoadGrams' | 'topLoadEvidence'>;

/** Reuses immutable placement-pair geometry during one plan calculation. */
export class StackLoadContactCache {
  private readonly contacts = new WeakMap<Placement, WeakMap<Placement, Map<string, number>>>();
  private readonly items: Map<string, PlanItem>;

  constructor(items: Map<string, PlanItem>) {
    this.items = items;
  }

  shouldCache(placements: Placement[], up: GravityUp): boolean {
    return up.axis !== 2 || up.sign !== 1 || placements.some(placement => this.items.get(placement.instanceId)?.packingShape);
  }

  contactArea(upper: Placement, lower: Placement, up: GravityUp): number {
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
    const key = `${up.axis}:${up.sign}`;
    if (byFrame.has(key)) return byFrame.get(key)!;
    const area = geometryContactArea(upper, lower, this.items, up);
    byFrame.set(key, area);
    return area;
  }
}

export function topLoadError(item: LoadItem): string | undefined {
  if (item.maxTopLoadGrams === undefined) return item.topLoadEvidence === undefined ? undefined : 'Enter the stacking limit that this source describes.';
  if (!Number.isFinite(item.maxTopLoadGrams) || item.maxTopLoadGrams < 0 || item.maxTopLoadGrams > 100000)
    return 'Allowed weight above must be between zero and 100,000 grams.';
  const evidence: Evidence | undefined = item.topLoadEvidence;
  if (!evidence || !['measured', 'known', 'estimated', 'user_confirmed', 'provider'].includes(evidence.source)
    || !Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1
    || typeof evidence.collectedAt !== 'string' || !Number.isFinite(Date.parse(evidence.collectedAt)))
    return 'Record how you know the allowed weight above.';
}

/** Only direct horizontal contact in the same bag. Side contact does not carry load. */
export function supportArea(upper: Placement, lower: Placement): number {
  if (upper.containerId !== lower.containerId || upper.z <= lower.z
    || Math.abs(lower.z + lower.height - upper.z) > CONTACT_EPSILON) return 0;
  const length = Math.min(upper.x + upper.length, lower.x + lower.length) - Math.max(upper.x, lower.x);
  const width = Math.min(upper.y + upper.width, lower.y + lower.width) - Math.max(upper.y, lower.y);
  return length > CONTACT_EPSILON && width > CONTACT_EPSILON ? length * width : 0;
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
  for(const upper of placements)for(const lower of placements)if((cache?cache.contactArea(upper,lower,up):geometryContactArea(upper,lower,items,up))>0)direct.get(lower.instanceId)!.add(upper.instanceId);
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
