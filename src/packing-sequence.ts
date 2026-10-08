import { compartmentFor } from './compartments';
import { packingItemForPlacement } from './packing-forms';
import type { Container, LibraryItem, Placement } from './types';
import { geometrySupportArea } from './packing-geometry';

/** Order physical heights before display-layer labels, including older saved locks. */
export function orderPackingSteps(placements: Placement[], containers: Container[]): Placement[] {
  const bagOrder = new Map(containers.map((bag, index) => [bag.id, index]));
  return [...placements].sort((a, b) => (bagOrder.get(a.containerId) ?? Infinity) - (bagOrder.get(b.containerId) ?? Infinity)
    || (a.insertionOrder!==undefined&&b.insertionOrder!==undefined?a.insertionOrder-b.insertionOrder:0)
    || a.z - b.z || a.y - b.y || a.x - b.x || (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
}

export function resumePackingStep(ordered: Placement[], cursor: string | undefined, completed: string[]): number {
  const saved = ordered.findIndex((step) => step.instanceId === cursor);
  if (saved >= 0) return saved;
  const firstUnpacked = ordered.findIndex((step) => !completed.includes(step.instanceId));
  return firstUnpacked < 0 ? 0 : firstUnpacked;
}

/** A packed lock can change the remaining plan's order. Advance against that new
 * order, and return to any skipped unpacked item before declaring the sequence done. */
export function nextUnpackedStep(ordered: Placement[], currentId: string, completed: string[]): number {
  const done = new Set(completed), current = ordered.findIndex(step => step.instanceId === currentId);
  const following = ordered.findIndex((step,index) => index > current && !done.has(step.instanceId));
  return following >= 0 ? following : ordered.findIndex(step => !done.has(step.instanceId));
}

/** Earlier planned positions are context, not a claim that they are already packed. */
export function packingStepPreview(ordered: Placement[], index: number, completed: string[]): Placement[] {
  const current = ordered[index];
  if (!current) return [];
  const confirmed = new Set(completed);
  return ordered.filter((step, stepIndex) => step.containerId === current.containerId
    && (stepIndex <= index || confirmed.has(step.instanceId)));
}

export function packingStepRelation(current: Placement, ordered: Placement[], items: LibraryItem[], bag?:Container): string {
  const compartment=bag?compartmentFor(bag,current.compartmentId):undefined;
  if(compartment&&Math.abs(current.z-compartment.z)<.01)return `Place on the floor of “${compartment.name}”. Positions use the bag’s inside corner, not the compartment corner. Check its top opening and actual support.`;
  if (current.z === 0) return 'Place on the bag floor, using the inside corner shown as the reference.';
  const names = new Map(items.map((item) => [item.id, item.name]));
  const records=new Map(items.map(item=>[item.id,item])),byInstance=new Map(ordered.flatMap(p=>{const item=packingItemForPlacement(records.get(p.itemId),p);return item?[[p.instanceId,item] as const]:[];}));
  const underneath = ordered.filter((step) => step.instanceId !== current.instanceId && step.containerId === current.containerId
    && geometrySupportArea(current,step,byInstance)>0);
  const supportNames = [...new Set(underneath.map((step) => names.get(step.itemId) ?? 'earlier item'))];
  return supportNames.length ? 'Above the planned position of ' + supportNames.join(', ') + '. Check the actual support before placing it.'
    : compartment?`${Math.round(current.z-compartment.z)} mm above the floor of “${compartment.name}”. Positions use the bag’s inside corner. Check actual support.`:Math.round(current.z) + ' mm above the bag floor. Check the actual support before placing it.';
}
