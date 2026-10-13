import { compartmentFor, compartmentKey } from './compartments';
import { interiorKey } from './packing-interior';
import { containerBlockedBoxes, containerSpaceError } from './container-space';
import { boxesIntersect, fitsGeometrySpace, geometryContactArea, geometryIntersects, orientationForRotation, packingShapeError, placementBoxes, shapeKey } from './packing-geometry';
import { packingItemForPlacement } from './packing-forms';
import { isValidRejectedPlacement, samePlacementGeometry } from './packing-progress';
import type { Container, LibraryItem, PackingPlan, PlanItem, Placement, Trip } from './types';

type RetrievalItem = Pick<LibraryItem, 'dimensions' | 'packingShape' | 'keepUpright'>;
export interface RetrievalCheck {
  instanceId: string;
  containerId: string;
  status: 'clear' | 'rearrange' | 'blocked' | 'unknown';
  /** Distinct direct and transitive prerequisites, not a safe physical unpacking sequence. */
  beforeInstanceIds: string[];
  supportingInstanceIds: string[];
  reason?: string;
}
export interface RetrievalReview {
  checks: RetrievalCheck[];
  priorityInstanceIds: string[];
  unresolvedPackedCount: number;
}

/** Fixed orientation, straight upward withdrawal in the opening-up packing frame.
 * Occupied cells, fixed intrusions and support dependencies use the same geometry
 * as planning. Hand clearance, closures, angled motion and real stability are absent. */
export function assessRetrieval(placements: Placement[], bags: Container[], items: Map<string, RetrievalItem>): RetrievalCheck[] {
  const checks = new Map<string, RetrievalCheck>();
  const counts = new Map<string, number>();
  for (const p of placements) counts.set(p.instanceId, (counts.get(p.instanceId) ?? 0) + 1);
  const unknown = (p: Placement, reason: string): RetrievalCheck => ({ instanceId: p.instanceId, containerId: p.containerId,
    status: 'unknown', beforeInstanceIds: [], supportingInstanceIds: [], reason });
  for (const bagId of new Set(placements.map(p => p.containerId))) {
    const group = placements.filter(p => p.containerId === bagId), matches = bags.filter(b => b.id === bagId), bag = matches[0];
    try {
      if (matches.length !== 1 || containerSpaceError(bag) || !bag.opening
        || ![bag.opening.length,bag.opening.width].every(n => Number.isFinite(n) && n > 0)) throw Error('The bag or usable-space record is missing, ambiguous or invalid.');
      const boxes = new Map(group.map(p => {
        const item = items.get(p.instanceId), orientation = item && orientationForRotation(item, p.rotation, bag);
        if (counts.get(p.instanceId) !== 1 || !isValidRejectedPlacement(p) || !item || packingShapeError(item)
          || !orientation || p.shapeKey !== shapeKey(item.packingShape)
          || ['length', 'width', 'height'].some(a => Math.abs(p[a as 'length'] - orientation[a as 'length']) > .01)
          || !fitsGeometrySpace(p, bag, item)) throw Error('A planned item or geometry record needs review.');
        const compartment = compartmentFor(bag, p.compartmentId), opening = compartment?.opening;
        if (p.interiorKey !== interiorKey(bag.packingInterior) || p.compartmentKey !== (compartment ? compartmentKey(compartment) : undefined)) throw Error('The saved compartment or interior geometry changed.');
        if (p.length > bag.opening.length + .01 || p.width > bag.opening.width + .01
          || opening && (p.length > opening.length + .01 || p.width > opening.width + .01)) throw Error('A recorded opening no longer fits the planned orientation.');
        return [p.instanceId, placementBoxes(p, item)] as const;
      }));
      if (group.some((p,i) => group.slice(i+1).some(q => geometryIntersects(p,q,items)))) throw Error('Planned items overlap.');
      const fixed = containerBlockedBoxes(bag), graph = new Map<string, string[]>(), supporting = new Map<string,string[]>(), blocked = new Set<string>();
      for (const p of group) {
        // A reviewed compartment has independent top access; a neighbouring
        // compartment is not an obstruction or supporting dependency.
        const others = group.filter(q => q.instanceId !== p.instanceId && q.compartmentId === p.compartmentId);
        const sweeps = boxes.get(p.instanceId)!.map(b => ({ ...b, height: Math.max(b.height, bag.inside.height - b.z) }));
        const above = others.filter(q => geometryContactArea(q, p, items) > .0001).map(q => q.instanceId);
        supporting.set(p.instanceId, above);
        graph.set(p.instanceId, others.filter(q => above.includes(q.instanceId)
          || sweeps.some(sweep => boxes.get(q.instanceId)!.some(obstacle => boxesIntersect(sweep, obstacle)))).map(q => q.instanceId));
        if (sweeps.some(sweep => fixed.some(obstacle => boxesIntersect(sweep, obstacle)))) blocked.add(p.instanceId);
      }
      for (const p of group) {
        const prerequisites = new Set<string>(), active = new Set<string>();
        let cycle = false, fixedBlocked = false;
        const visit = (id: string) => {
          if (active.has(id)) { cycle = true; return; }
          if (prerequisites.has(id)) return;
          active.add(id);
          fixedBlocked ||= blocked.has(id);
          for (const next of graph.get(id) ?? []) visit(next);
          active.delete(id);
          prerequisites.add(id);
        };
        visit(p.instanceId); prerequisites.delete(p.instanceId);
        checks.set(p.instanceId, { instanceId: p.instanceId, containerId: bagId,
          status: cycle || fixedBlocked ? 'blocked' : prerequisites.size ? 'rearrange' : 'clear',
          beforeInstanceIds: group.filter(q => prerequisites.has(q.instanceId)).map(q => q.instanceId),
          supportingInstanceIds: supporting.get(p.instanceId)!,
          reason: cycle ? 'The recorded shapes have a cyclic withdrawal or support dependency. A straight upward removal sequence is not established.'
            : fixedBlocked ? 'Recorded fixed space blocks this withdrawal or a prerequisite item. Review the opening, intrusions or another access path.' : undefined });
      }
    } catch (error) {
      for (const p of group) checks.set(p.instanceId, unknown(p, error instanceof Error ? error.message : 'Review the recorded geometry.'));
    }
  }
  return placements.map(p => checks.get(p.instanceId) ?? unknown(p, 'Review the planned position.'));
}

/** Resolve the exact selected preparation and invalidate a whole bag when its
 * saved physical contents cannot be reconciled with this candidate. */
export function reviewRetrieval(trip: Trip, library: LibraryItem[], bags: Container[], plan: PackingPlan): RetrievalReview {
  const items = new Map<string, RetrievalItem>(), priorityInstanceIds: string[] = [];
  for (const p of plan.placements) {
    const matches = library.filter(item => item.id === p.itemId), entry = trip.entries.filter(e => e.id === p.entryId && e.itemId === p.itemId);
    const item = matches.length === 1 && entry.length === 1 ? packingItemForPlacement(matches[0],p) : undefined;
    if (item) items.set(p.instanceId,item);
    if (entry.length === 1 && entry[0].accessPriority >= 4) priorityInstanceIds.push(p.instanceId);
  }
  const checks = assessRetrieval(plan.placements,bags,items), unresolvedBags = new Set<string>();
  let unresolvedPackedCount = 0;
  for (const saved of trip.lockedPlacements) {
    const matched = isValidRejectedPlacement(saved) && trip.lockedPlacements.filter(p => p?.instanceId === saved.instanceId).length === 1 && plan.placements.filter(p => p.locked && p.itemId === saved.itemId
      && p.entryId === saved.entryId && samePlacementGeometry(p,saved)).length === 1;
    if (matched) continue;
    unresolvedPackedCount++;
    const id = (saved as Placement | null)?.containerId;
    if (typeof id === 'string' && bags.some(b => b.id === id)) unresolvedBags.add(id);
    else for (const bag of bags) unresolvedBags.add(bag.id);
  }
  return { checks: checks.map(check => unresolvedBags.has(check.containerId) ? { ...check, status: 'unknown',
    beforeInstanceIds: [], supportingInstanceIds: [], reason: 'Saved packed contents in this bag need review. Their physical obstructions are unresolved.' } : check),
    priorityInstanceIds, unresolvedPackedCount };
}

/** Reward priority access only where the final model gives a withdrawal path.
 * Fixed obstructions and unknown checks never earn an accessibility reward. */
export function retrievalReward(placements: Placement[], bags: Container[], items: PlanItem[]): number {
  const records = new Map(items.map(item => [item.instanceId,item]));
  return assessRetrieval(placements,bags,records).reduce((sum,check) => {
    if (check.status !== 'clear' && check.status !== 'rearrange') return sum;
    return sum + (records.get(check.instanceId)?.accessPriority ?? 1) * 100 / (1 + check.beforeInstanceIds.length);
  },0);
}
