import type { Container, LibraryItem, PackingPlan, Placement, SeparationRule, Trip } from './types.ts';
import { fitsGeometrySpace, orientationForRotation, packingShapeError, placementBoxes, shapeKey, type GeometryBox } from './packing-geometry.ts';
import { compartmentKey } from './compartments.ts';
import { interiorKey } from './packing-interior.ts';
import { packingItemForPlacement } from './packing-forms.ts';
import { isValidRejectedPlacement } from './packing-progress.ts';

import { separationRuleError } from './separation-rule-records.ts';
export { separationRuleError, MAX_SEPARATION_RULES } from './separation-rule-records.ts';

type ShapeItem = Pick<LibraryItem,'packingShape'>;

export function entriesRelated(rule: SeparationRule, a: string, b: string): boolean {
  return a === rule.firstEntryId && b === rule.secondEntryId || b === rule.firstEntryId && a === rule.secondEntryId;
}

/** Minimum Euclidean distance between occupied orthogonal boxes, including recesses. */
export function boxDistanceSquared(a: GeometryBox,b: GeometryBox): number {
  const gap = (start: number,size: number,other: number,otherSize: number) => Math.max(0, other-start-size, start-other-otherSize);
  return gap(a.x,a.length,b.x,b.length)**2 + gap(a.y,a.width,b.y,b.width)**2 + gap(a.z,a.height,b.z,b.height)**2;
}
export function separationConflict(rule: SeparationRule,a: Placement,b: Placement,items: Map<string,ShapeItem>): string | undefined {
  if (!entriesRelated(rule,a.entryId,b.entryId) || a.containerId !== b.containerId) return;
  if (rule.kind === 'different_bags') return 'These entries must use different bags.';
  if (rule.kind === 'different_compartments') return !a.compartmentId || !b.compartmentId || a.compartmentId === b.compartmentId
    ? 'These entries must use different reviewed compartments or different bags.' : undefined;
  if (!items.has(a.instanceId) || !items.has(b.instanceId)) return 'The occupied geometry needed for the recorded gap is missing.';
  try {
    const minimum = Math.max(0,(rule.clearanceMm ?? 0)-.01)**2;
    if (placementBoxes(a,items.get(a.instanceId)).some(left => placementBoxes(b,items.get(b.instanceId)).some(right => boxDistanceSquared(left,right) < minimum)))
      return `The recorded ${rule.clearanceMm} mm geometric gap is not maintained.`;
  } catch { return 'Review the occupied geometry before relying on the recorded gap.'; }
}

export function placementSeparationError(candidate: Placement,positions: Placement[],rules: SeparationRule[],items: Map<string,ShapeItem>): string | undefined {
  for (const other of positions) if (other.instanceId !== candidate.instanceId)
    for (const rule of rules) { const conflict = separationConflict(rule,candidate,other,items); if (conflict) return conflict; }
}

/** Extra floor/contact candidates at explicit gap boundaries; all existing fit,
 * support, insertion and mass gates still run. No floating clearance is inferred. */
export function separationPositions(bases: Array<{x:number;y:number;z:number}>,space: GeometryBox,item: ShapeItem,orientation: {length:number;width:number;height:number;rotation:number},entryId: string,
  positions: Placement[],rules: SeparationRule[],items: Map<string,ShapeItem>) {
  const relevant = rules.filter(rule => rule.kind === 'clearance' && [rule.firstEntryId,rule.secondEntryId].includes(entryId));
  if (!relevant.length) return bases;
  const xs = new Set(bases.map(p=>p.x)),ys = new Set(bases.map(p=>p.y)),zs = [...new Set(bases.map(p=>p.z))];
  const local = placementBoxes({x:0,y:0,z:0,...orientation},item);
  for (const rule of relevant) for (const other of positions.filter(p=>entriesRelated(rule,entryId,p.entryId)))
    for (const obstacle of placementBoxes(other,items.get(other.instanceId))) for (const cell of local) {
      const gap = rule.clearanceMm!;
      xs.add(obstacle.x+obstacle.length+gap-cell.x);xs.add(obstacle.x-gap-cell.x-cell.length);
      ys.add(obstacle.y+obstacle.width+gap-cell.y);ys.add(obstacle.y-gap-cell.y-cell.width);
    }
  const inX = [...xs].filter(x=>x>=space.x-.01&&x+orientation.length<=space.x+space.length+.01).sort((a,b)=>a-b);
  const inY = [...ys].filter(y=>y>=space.y-.01&&y+orientation.width<=space.y+space.width+.01).sort((a,b)=>a-b);
  const result = [...bases],seen = new Set(bases.map(p=>JSON.stringify([p.x,p.y,p.z])));
  outer: for (const z of zs) for (const y of inY) for (const x of inX) {
    const key=JSON.stringify([x,y,z]);if(seen.has(key))continue;
    if(result.length>=20000)break outer;
    seen.add(key);result.push({x,y,z});
  }
  return result;
}

export function separationDescription(rule: SeparationRule,unit: 'metric'|'imperial'): string {
  return rule.kind === 'different_bags' ? 'Different bags' : rule.kind === 'different_compartments' ? 'Different reviewed compartments or bags'
    : `At least ${(rule.clearanceMm!/(unit==='metric'?1:25.4)).toLocaleString('en-GB',{maximumFractionDigits:3})} ${unit==='metric'?'mm':'in'} geometric gap`;
}

/** Prevent entry deletion from silently dropping a hard separation requirement. */
export const entryHasSeparation = (trip: Trip,id: string) => trip.separationRules?.some(rule => rule.firstEntryId === id || rule.secondEntryId === id) ?? false;
export function validRuleCompartment(p: Placement,bags: Container[]): boolean {
  const bag=bags.find(b=>b.id===p.containerId),compartment=bag?.compartments?.find(c=>c.id===p.compartmentId);
  return !!compartment && p.compartmentKey===compartmentKey(compartment);
}

export function reviewSeparation(trip: Trip,library: LibraryItem[],bags: Container[],plan: PackingPlan) {
  const error = separationRuleError(trip);
  if(error)return {error,checks:[]};
  const positions = [...trip.lockedPlacements.filter(isValidRejectedPlacement),...plan.placements.filter(p=>!trip.lockedPlacements.some(saved=>saved?.instanceId===p.instanceId))];
  const items = new Map<string,LibraryItem>(), invalid = new Set<string>();
  for(const p of positions){
    try {
      const matches=library.filter(item=>item.id===p.itemId),matchedBags=bags.filter(b=>b.id===p.containerId),bag=matchedBags[0];
      const item=matches.length===1?packingItemForPlacement(matches[0],p):undefined;
      const o=item&&bag&&!packingShapeError(item)?orientationForRotation(item,p.rotation,bag):undefined;
      if(!item||!o||matchedBags.length!==1||p.shapeKey!==shapeKey(item.packingShape)||p.interiorKey!==interiorKey(bag.packingInterior)
        ||!fitsGeometrySpace(p,bag,item)||['length','width','height'].some(key=>Math.abs(p[key as 'length']-o[key as 'length'])>.01))invalid.add(p.instanceId);
      else items.set(p.instanceId,item);
    }catch{invalid.add(p.instanceId);}
  }
  return { error, checks: (Array.isArray(trip.separationRules)?trip.separationRules:[]).map(rule=>{
    const first=positions.filter(p=>p.entryId===rule.firstEntryId),second=positions.filter(p=>p.entryId===rule.secondEntryId);
    const entries=[rule.firstEntryId,rule.secondEntryId].map(id=>trip.entries.find(e=>e.id===id));
    const malformed=trip.lockedPlacements.some(p=>!isValidRejectedPlacement(p));
    const duplicate=positions.some(p=>positions.filter(q=>q.instanceId===p.instanceId).length>1);
    const incomplete=!!error||malformed||duplicate||entries.some(e=>!e)||first.length!==entries[0]?.quantity||second.length!==entries[1]?.quantity
      ||[...first,...second].some(p=>invalid.has(p.instanceId)||!bags.some(b=>b.id===p.containerId)||p.itemId!==entries.find(e=>e?.id===p.entryId)?.itemId);
    let conflict: string|undefined,geometryUnknown=false;
    for(const a of first)for(const b of second){
      if(a.containerId===b.containerId&&rule.kind==='clearance'&&(invalid.has(a.instanceId)||invalid.has(b.instanceId))){geometryUnknown=true;continue;}
      if(a.containerId===b.containerId&&rule.kind==='different_compartments'&&(!validRuleCompartment(a,bags)||!validRuleCompartment(b,bags)))geometryUnknown=true;
      conflict??=separationConflict(rule,a,b,items);
    }
    return {rule,status:conflict?'conflict' as const:incomplete||geometryUnknown?'incomplete' as const:'within_model' as const,
      reason:conflict??(incomplete||geometryUnknown?'Some copies, saved positions or current geometry are missing or unresolved. This rule cannot show a complete result.':undefined)};
  }) };
}
