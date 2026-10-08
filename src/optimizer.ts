import { separationRuleError, entriesRelated, placementSeparationError, separationPositions } from './item-separation';
import {compartmentFor,compartmentKey,packingRegions,eligibleForCompartment,compartmentAssignmentError,compartmentMassError} from './compartments';
import { balancedBagCosts, balancedResultPenalty } from './bag-weights';
import { handlingEvidenceError, handlingPropertyRows, needsPropertyReview } from './property-evidence';
import { itemMassError, savedBagMassConflict } from './mass-constraints';
import { retrievalReward } from './retrieval';
import type {
  BagMassConflict, Container, ExcludedItem, LibraryItem, OptimizationMode, PackingPlan,
  PlanItem, Placement, Trip, SeparationRule,
} from './types';
import { assessStackLoads, topLoadError } from './stack-load';
import { packingItem, packingFormKey } from './packing-forms';
import { isValidRejectedPlacement, samePlacementGeometry } from './packing-progress';
import { containerSpaceError, usableContainerHeight, usableContainerVolume } from './container-space';
import { interiorKey, interiorSupportError } from './packing-interior';
import { contactPositions, fitsGeometrySpace, geometryIntersects, geometryOrientations, hasGeometrySupport, hasPackingAndTravelSupport, hasVerticalEntry, orientationForRotation, packingShapeError, placementBoxes, shapeDimensions, shapeKey, shapeVolume } from './packing-geometry';

interface FreeSpace {
  compartmentId?: string;
  shapeSearch?: boolean;
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
  height: number;
}

interface Candidate extends FreeSpace {
  rotation: number;
  score: number;
  dimensions: { length: number; width: number; height: number };
}

const volume = (box: { length: number; width: number; height: number }) => box.length * box.width * box.height;
const spaceVolume = (box: FreeSpace) => box.length * box.width * box.height;
const EPSILON = 0.01;

export function buildPlan(trip: Trip, library: LibraryItem[], allContainers: Container[], mode: OptimizationMode = trip.mode): PackingPlan {
  const referencedItemIds = new Set(trip.entries.map(entry => entry.itemId));
  const byId = new Map<string, LibraryItem>();
  for (const item of library) if (referencedItemIds.has(item.id)) byId.set(item.id, item);
  const containers = allContainers.filter((container) => trip.containerIds.includes(container.id));
  const unavailable = new Set(trip.unavailableInstanceIds);
  const allItems: PlanItem[] = [];
  const excluded: ExcludedItem[] = [];

  for (const entry of trip.entries) {
    const original = byId.get(entry.itemId);
    const assignmentError=compartmentAssignmentError(entry);
    let item = original,formError: string|undefined;
    try { if(original)item=packingItem(original,entry.packingFormId); } catch(reason) { formError=reason instanceof Error?reason.message:"Review the selected packing form."; }
    for (let index = 0; index < Math.max(1, entry.quantity); index += 1) {
      const instanceId = `${entry.id}#${index + 1}`;
      if (unavailable.has(instanceId)) {
        excluded.push({ instanceId, entryId: entry.id, itemId: entry.itemId, name: item?.name ?? 'Unknown item', required: entry.required, reason: 'Marked unavailable for this plan.' });
        continue;
      }
      if(assignmentError){excluded.push({instanceId,entryId:entry.id,itemId:entry.itemId,name:original?.name??'Unknown item',required:entry.required,reason:assignmentError});continue;}
      if(formError){excluded.push({instanceId,entryId:entry.id,itemId:entry.itemId,name:original?.name??'Unknown item',required:entry.required,reason:'Review the packing form. '+formError+' Saved packed positions remain unchanged.'});continue;}
      if (!item || !validDimensions(item)) {
        excluded.push({ instanceId, entryId: entry.id, itemId: entry.itemId, name: item?.name ?? 'Unknown item', required: entry.required, reason: 'Add complete dimensions before building a geometric plan.' });
        continue;
      }
      const massError = itemMassError(item);
      if (massError) {
        excluded.push({ instanceId, entryId: entry.id, itemId: item.id, name: item.name, required: entry.required,
          reason: `Correct this item's weight record. ${massError} Saved packed positions remain unchanged.` });
        continue;
      }
      const stackingError = topLoadError(item);
      const loadError = handlingEvidenceError(item) ?? stackingError ?? packingShapeError(item);
      if (loadError) {
        excluded.push({ instanceId, entryId: entry.id, itemId: item.id, name: item.name, required: entry.required,
          reason: `Correct this item's ${handlingEvidenceError(item)?'handling evidence':stackingError?'stacking':'shape or upright-direction'} record. ${loadError} Saved packed positions are retained; undo packed or unlock before moving them.` });
        continue;
      }
      allItems.push({
        instanceId,
        entryId: entry.id,
        itemId: item.id,
        travellerId: entry.travellerId,
        name: item.name,
        category:item.category,
        dimensions: item.packingShape ? shapeDimensions(item.packingShape) : item.dimensions,
        packingShape: item.packingShape,
        dimensionEvidence:item.dimensionEvidence,
        packingForm:original?.packingForms?.find(form=>form.id===entry.packingFormId),
        volumeMm3: item.packingShape ? shapeVolume(item.packingShape) : volume(item.dimensions),
        massGrams: item.massGrams,
        upperMassGrams: item.massRangeGrams?.max ?? item.massGrams,
        massEvidenceSource: item.massEvidence?.source,
        fragile: item.fragile,
        maxTopLoadGrams: item.maxTopLoadGrams,
        topLoadEvidence: item.topLoadEvidence,
        keepUpright: item.keepUpright,
        priority: entry.priority,
        required: entry.required,
        accessPriority: Math.max(1, Math.min(5, entry.accessPriority)),
        assignedContainerId: entry.containerId,
        assignedCompartmentId:entry.compartmentId,
      });
    }
  }

  const lockedById = new Map(trip.lockedPlacements.map((placement,index) => [isValidRejectedPlacement(placement)?placement.instanceId:`invalid-lock-${index}`, placement]));
  const attempts = orderCandidates(allItems, mode);
  const rejected = (trip.rejectedPlacements ?? []).filter(isValidRejectedPlacement);
  const ruleError = separationRuleError(trip);
  const rules = trip.separationRules ?? [];
  const search = ruleError ? { results: [{ placements: [] as Placement[], excluded: allItems.map(item => ({ instanceId:item.instanceId,entryId:item.entryId,itemId:item.itemId,name:item.name,required:item.required,reason:ruleError+' Saved packed positions remain unchanged.' })), score: -1_000_000, massConflicts: [] as BagMassConflict[] }], limited: false }
    : searchInsertionOrders(attempts, containers, lockedById, mode, rejected, rules);
  const results = search.results;
  const winner = results.sort((left, right) => right.score - left.score)[0] ?? { placements: [], excluded: [], score: 0, massConflicts: [] as BagMassConflict[] };
  const totalItems = allItems.length + excluded.length;
  excluded.push(...winner.excluded);

  const placements = winner.placements;
  const summaries = containers.map((container) => {
    const inside = placements.filter((placement) => placement.containerId === container.id);
    const items = inside.map((placement) => allItems.find((item) => item.instanceId === placement.instanceId)).filter((item): item is PlanItem => Boolean(item));
    return {
      containerId: container.id,
      itemCount: inside.length,
      usedMassGrams: items.reduce((sum, item) => sum + (item.upperMassGrams ?? 0), 0),
      massLimitGrams: container.massLimitGrams,
      volumeUsedMm3: items.reduce((sum, item) => sum + item.volumeMm3, 0),
      volumeCapacityMm3: usableContainerVolume(container),
      unweighedCount: items.filter((item) => item.upperMassGrams === undefined).length,
      estimatedMassCount: items.filter((item) => item.upperMassGrams !== undefined
        && (item.massEvidenceSource === undefined || item.massEvidenceSource === 'estimated' || item.upperMassGrams !== item.massGrams)).length,
    };
  });

  const stackLoads = assessStackLoads(placements, new Map(allItems.map(item => [item.instanceId, item])),containers);
  const warnings = new Set<string>();
  if (ruleError) warnings.add(ruleError+' Planning is paused; saved positions remain unchanged.');
  if (rules.length) warnings.add('Traveller-recorded separation applies to every copy of each linked entry. Geometric gaps and reviewed compartment assignments do not establish hygiene, cushioning, leak prevention or dangerous-goods compliance.');
  for (const conflict of winner.massConflicts) warnings.add(`${containers.find(b => b.id === conflict.containerId)?.name ?? 'Bag'}: ${conflict.reason}`);
  if (search.limited && winner.excluded.length) warnings.add('The bounded insertion-order search reached 24 attempts. Some items remain unplaced; this does not establish that they cannot fit. Review the order, shapes and bags.');
  if(trip.lockedPlacements.some(p=>!isValidRejectedPlacement(p)))warnings.add('A saved locked position is malformed. Its recorded bag, or all bags if unidentified, is paused. Saved data remains unchanged; correct the record before packing.');
  if (containers.length === 0) warnings.add('Add at least one bag before building a packing plan.');
  for(const bag of containers){
    const spaceError=containerSpaceError(bag);
    if(spaceError)warnings.add(`${bag.name}: unavailable-space records need correction. ${spaceError} No new placements are allowed in this bag.`);
    else if((bag.unavailableSpaces?.length??0)>0||(bag.lidClearanceMm??0)>0)warnings.add(`${bag.name}: recorded unavailable spaces and lid clearance are kept free. Check their physical boundaries; this does not establish closure, cushioning or irregular fit.`);
    if(!spaceError&&interiorSupportError(bag.packingInterior))warnings.add(bag.name+': '+interiorSupportError(bag.packingInterior)+' Packed positions remain saved; no new placements are allowed.');
    if(!spaceError&&bag.compartments)warnings.add(bag.name+': only the recorded compartments are usable. Each has independently reviewed top access and supporting bases. Unrecorded space, walls and physical fit remain unverified.');
    if(!spaceError&&bag.packingInterior)warnings.add(bag.name+': adopted estimated interior keeps walls and other components unavailable. The reviewed entry faces up while packing; its separately reviewed travel-up end controls upright items. Confirm the lowest floor, opening, support strength, closure and physical fit.');
    if(!spaceError&&(bag.unavailableSpaces?.some(space=>space.evidence.source==='estimated')||bag.lidClearanceEvidence?.source==='estimated'))warnings.add(`${bag.name}: unavailable-space or lid-clearance measurements are estimates; verify them physically.`);
  }
  const selectedItemIds=new Set(trip.entries.map(entry=>entry.itemId));
  const unreviewedHandling=library.filter(item=>selectedItemIds.has(item.id)&&handlingPropertyRows(item).some(row=>needsPropertyReview(row.evidence)));
  if(unreviewedHandling.length)warnings.add(`${unreviewedHandling.length} selected items have unreviewed, estimated or lower-confidence handling properties. A missing fragile or upright flag does not establish robust or rotation-safe belongings. Review flexibility, fragility and upright handling in the item editor.`);
  if(containers.some(bag=>needsPropertyReview(bag.openingEvidence)))warnings.add('Some bag openings are unreviewed, estimated or lower confidence. Check the narrowest real opening separately from inside dimensions before relying on insertion.');
  if(allItems.some(item=>item.packingForm))warnings.add('Selected folded, rolled or compressed forms use their recorded full rectangular envelopes, preparation and form-specific stacking limits. No compression ratio, material strength or weight reduction is inferred. Prepare and recheck the form before packing; the original scan remains unchanged.');
  if (allItems.some(item => item.fragile || item.maxTopLoadGrams !== undefined)) warnings.add('Fragile items carry no planned stack. Recorded stacking limits use cumulative upper saved weights in this orientation, not pressure or impact resistance. Cushioning and its space are not simulated.');
  if (stackLoads.some(load => load.status === 'unverified')) warnings.add('Some supporting items have no recorded stacking limit. Their ability to carry the planned load is unverified; check it physically.');
  if (allItems.some(item => item.topLoadEvidence?.source === 'estimated')) warnings.add('Some stacking limits are estimates; verify the allowed load and all item weights before relying on them.');
  if (mode === 'fragile_protection') warnings.add('Fragile protection requires a fully supported occupied base footprint and favors fragile items later in the stack. It does not verify cushioning, securing, center of gravity or transport impacts.');
  if(allItems.some(item=>item.packingShape))warnings.add('Adopted estimated shapes use occupied cells, proper axis rotations and straight downward entry; other items use rectangular bounds. Cell rounding is retained after uniform scaling. Physical completeness, stability, deformation, closure and angled insertion are unverified.');
  if(allItems.some(item=>item.keepUpright&&item.packingShape&&!item.packingShape.upright))warnings.add('Some adopted shapes have an upright requirement but no reviewed top direction. These legacy records retain the stored height axis upward; review the real top in the item editor before relying on the plan.');
  if (allItems.some((item) => item.upperMassGrams === undefined) && containers.some((container) => container.massLimitGrams)) {
    warnings.add('One or more items have no weight evidence. The bag weight limit cannot be verified until you add weights or use a scale.');
  }
  if (allItems.some((item) => item.massEvidenceSource === 'estimated')) {
    warnings.add('One or more item weights are estimates. Where an estimated range is saved, the plan uses its upper value.');
  }
  if (containers.some((container) => container.massLimitGrams && container.tareGrams === undefined)) {
    warnings.add('At least one bag has no recorded empty weight, so its gross weight against a limit is incomplete.');
  }
  if (allItems.some((item) => item.upperMassGrams !== undefined && item.priority === 'required')) {
    const requiredSources = allItems.filter((item) => item.required).length;
    if (requiredSources > 0) warnings.add('Required items are kept in the plan input; items that do not fit are called out below.');
  }

  const requiredExcludedCount = excluded.filter((item) => item.required && item.reason !== 'Marked unavailable for this plan.').length;
  return {
    mode,
    placements,
    excluded,
    summaries,
    warnings: [...warnings],
    stackLoads,
    massConflicts: winner.massConflicts,
    totalItems,
    requiredExcludedCount,
    score: winner.score,
    createdAt: new Date().toISOString(),
  };
}

function validDimensions(item: LibraryItem) {
  const { length, width, height } = item.dimensions;
  return [length, width, height].every((number) => Number.isFinite(number) && number > 0);
}

function eligibleForBag(item: PlanItem, container: Container) {
  return (!item.assignedContainerId || item.assignedContainerId === container.id)
    && (container.travellerIds.length === 0 || container.travellerIds.includes(item.travellerId));
}

/** Repair failed insertion orders rather than treating the first enclosing shape as permanent.
 * Every attempt runs the complete placement gates; saved physical locks are never reordered.
 * The bound is deterministic and independent of the speed of the device. */
function searchInsertionOrders(orders: PlanItem[][], containers: Container[], locks: Map<string, Placement>, mode: OptimizationMode, rejected: Placement[], rules: SeparationRule[]) {
  const results: ReturnType<typeof packOnce>[] = [];
  const frontier: { order: PlanItem[]; result: ReturnType<typeof packOnce> }[] = [];
  const seen = new Set<string>();
  const evaluate = (order: PlanItem[], lookaheadDepth = 1) => {
    const key = `${lookaheadDepth}:${JSON.stringify(order.map(item => item.instanceId))}`;
    if (seen.has(key)) return;
    seen.add(key);
    const result = packOnce(order, containers, locks, mode, rejected, rules, lookaheadDepth);
    results.push(result);
    frontier.push({ order, result });
  };
  // Preserve existing rectangular-only mode behavior, including its tie order.
  if (!rules.length && !orders[0]?.some(item => item.packingShape)) {
    return { results: orders.map(order => packOnce(order, containers, locks, mode, rejected, rules)), limited: false };
  }
  for (const order of orders) evaluate(order);
  const complete = () => results.some(result => result.excluded.length === 0);
  while (frontier.length && seen.size < 24 && !complete()) {
    frontier.sort((a,b) => b.result.score - a.result.score);
    const { order, result } = frontier.shift()!;
    const missing = order.filter(item => result.excluded.some(excluded => excluded.instanceId === item.instanceId)
      && !locks.has(item.instanceId)).sort((a,b) => Number(b.required)-Number(a.required) || priorityScore(b)-priorityScore(a));
    // Repair a group together before spending the budget on interchangeable
    // quantity instances. Several inner objects can depend on the same roof.
    for (const blocker of order.filter(item=>(item.packingShape||rules.some(rule=>[rule.firstEntryId,rule.secondEntryId].includes(item.entryId)))&&result.placements.some(p=>p.instanceId===item.instanceId&&!p.locked))) {
      const group=missing.filter(item=>containers.some(bag=>eligibleForBag(item,bag)&&eligibleForBag(blocker,bag)));
      if(group.length<2 && !group.some(item=>rules.some(rule=>entriesRelated(rule,item.entryId,blocker.entryId))))continue;
      const ids=new Set(group.map(item=>item.instanceId)),retry=order.filter(item=>!ids.has(item.instanceId));
      retry.splice(retry.findIndex(item=>item.instanceId===blocker.instanceId),0,...group);
      evaluate(retry,3);
      if(seen.size>=24||complete())break;
    }
    if(seen.size>=24||complete())break;
    for (const item of missing) {
      // Move an excluded item ahead of an enclosing shape, or move an excluded
      // shape ahead of an obstruction. Unrelated bags cannot cause this dependency.
      const blockers = order.filter(blocker => result.placements.some(p => p.instanceId === blocker.instanceId && !p.locked)
        && (item.packingShape || blocker.packingShape || rules.some(rule=>entriesRelated(rule,item.entryId,blocker.entryId)))
        && containers.some(bag => eligibleForBag(item,bag) && eligibleForBag(blocker,bag)));
      for (const blocker of blockers) {
        const retry = order.filter(candidate => candidate.instanceId !== item.instanceId);
        retry.splice(retry.findIndex(candidate => candidate.instanceId === blocker.instanceId),0,item);
        evaluate(retry,3);
        if (seen.size >= 24 || complete()) break;
      }
      if (seen.size >= 24 || complete()) break;
    }
  }
  return { results, limited: seen.size >= 24 && !complete() };
}

function orderCandidates(items: PlanItem[], mode: OptimizationMode): PlanItem[][] {
  const copy = (sort: (left: PlanItem, right: PlanItem) => number) => [...items].sort(sort);
  const requiredFirst = (a: PlanItem, b: PlanItem) => Number(b.required) - Number(a.required);
  const volumeFirst = (a: PlanItem, b: PlanItem) => b.volumeMm3 - a.volumeMm3;
  const massFirst = (a: PlanItem, b: PlanItem) => (b.upperMassGrams ?? 0) - (a.upperMassGrams ?? 0);
  const smallerFirst = (a: PlanItem, b: PlanItem) => a.volumeMm3 - b.volumeMm3;
  const accessFirstAtBase = (a: PlanItem, b: PlanItem) => a.accessPriority - b.accessPriority;

  if (mode === 'fragile_protection') {
    const fragileLast = (a: PlanItem, b: PlanItem) => Number(a.fragile) - Number(b.fragile);
    return [
      copy((a,b) => requiredFirst(a,b) || fragileLast(a,b) || massFirst(a,b) || volumeFirst(a,b)),
      copy((a,b) => requiredFirst(a,b) || fragileLast(a,b) || volumeFirst(a,b) || massFirst(a,b)),
      copy((a,b) => fragileLast(a,b) || requiredFirst(a,b) || baseArea(b)-baseArea(a) || massFirst(a,b)),
    ];
  }
  if (mode === 'easy_access') {
    return [
      copy((a, b) => requiredFirst(a, b) || accessFirstAtBase(a, b) || volumeFirst(a, b)),
      copy((a, b) => requiredFirst(a, b) || massFirst(a, b) || accessFirstAtBase(a, b)),
      copy((a, b) => requiredFirst(a, b) || volumeFirst(a, b) || accessFirstAtBase(a, b)),
    ];
  }
  if (mode === 'maximum_capacity') {
    return [
      copy((a, b) => requiredFirst(a, b) || priorityScore(b) - priorityScore(a) || smallerFirst(a, b)),
      copy((a, b) => requiredFirst(a, b) || smallerFirst(a, b) || priorityScore(b) - priorityScore(a)),
      copy((a, b) => requiredFirst(a, b) || volumeFirst(a, b) || priorityScore(b) - priorityScore(a)),
    ];
  }
  return [
    copy((a, b) => requiredFirst(a, b) || massFirst(a, b) || volumeFirst(a, b)),
    copy((a, b) => requiredFirst(a, b) || volumeFirst(a, b) || massFirst(a, b)),
    copy((a, b) => requiredFirst(a, b) || baseArea(b) - baseArea(a) || volumeFirst(a, b)),
  ];
}

function priorityScore(item: PlanItem) {
  return item.priority === 'required' ? 100 : item.priority === 'preferred' ? 10 : 1;
}

function baseArea(item: PlanItem) {
  return item.dimensions.length * item.dimensions.width;
}

function packOnce(items: PlanItem[], containers: Container[], lockedById: Map<string, Placement>, mode: OptimizationMode, rejected: Placement[], rules: SeparationRule[], lookaheadDepth = 1) {
  const useShapeSequence=items.some(item=>item.packingShape)||containers.some(bag=>bag.packingInterior||bag.compartments);
  const placements: Placement[] = [];
  const excluded: ExcludedItem[] = [];
  const freeSpaces = new Map(containers.map((container) => {
    let spaces:FreeSpace[]=containerSpaceError(container)||usableContainerHeight(container)<=EPSILON?[]:packingRegions(container);
    if(!containerSpaceError(container))for(const blocked of [...(container.unavailableSpaces??[])].sort((a,b)=>a.x-b.x||a.y-b.y||a.z-b.z||a.length-b.length||a.width-b.width||a.height-b.height))spaces=splitFreeSpaces(spaces,blocked);
    return [container.id,spaces] as const;
  }));
  const itemById = new Map(items.map((item) => [item.instanceId, item]));
  // Rectangle-only contacts advance strictly upward; without a fragile or
  // weight-limited item, a candidate cannot create a stacking conflict.
  const stackSensitiveIds = new Set(items.filter(item => item.fragile || item.maxTopLoadGrams !== undefined).map(item => item.instanceId));
  const placedIds = new Set<string>();
  const blockedBagIds = new Set<string>();
  const massConflicts: BagMassConflict[] = [];

  for (const saved of lockedById.values()) {
    const savedBagId=(saved as unknown as {containerId?:unknown}|null)?.containerId;
    if(!isValidRejectedPlacement(saved)){const id=savedBagId;for(const bag of containers)if(typeof id!=='string'||!containers.some(b=>b.id===id)||bag.id===id)blockedBagIds.add(bag.id);continue;}
    const item = itemById.get(saved.instanceId);
    const container = containers.find((candidate) => candidate.id === saved.containerId);
    if (!item) {blockedBagIds.add(saved.containerId);continue;}
    placedIds.add(saved.instanceId);
    const orientation=container&&!containerSpaceError(container)?orientationForRotation(item,saved.rotation,container):undefined;
    const formChanged=saved.packingFormId!==item.packingForm?.id||saved.packingFormKey!==(item.packingForm?packingFormKey(item.packingForm):undefined);
    if (!container || !orientation || ['length','width','height'].some(a=>Math.abs(saved[a as 'length']-orientation[a as 'length'])>EPSILON)
      || !fitsOpening(saved,container,saved.compartmentId) || !eligibleForBag(item,container) || !eligibleForCompartment(item,compartmentFor(container,saved.compartmentId)) || saved.compartmentKey!==(compartmentFor(container,saved.compartmentId)?compartmentKey(compartmentFor(container,saved.compartmentId)!):undefined)
      || !!containerSpaceError(container) || formChanged || saved.shapeKey!==shapeKey(item.packingShape) || saved.interiorKey!==interiorKey(container.packingInterior) || !fitsGeometrySpace(saved,container,item)
      || placements.some((placed) => placed.containerId === saved.containerId && geometryIntersects(saved,placed,itemById))) {
      blockedBagIds.add(saved.containerId);
      excluded.push({ instanceId: item.instanceId, entryId: item.entryId, itemId: item.itemId, name: item.name, required: item.required,
        reason: formChanged?'The selected packing form or its recorded preparation changed. Coordinates and completion remain saved. Check the prepared item physically and undo packed or unlock before allowing it to move.':'The saved locked placement no longer fits the recorded usable bag space, lid clearance, or another lock. Check it physically and undo packed or unlock it before allowing it to move.' });
      continue;
    }
    placements.push({ ...saved, locked: true,...(useShapeSequence?{insertionOrder:placements.length+1}:{}) });
    let spaces=freeSpaces.get(container.id)??[];for(const box of placementBoxes(saved,item))spaces=splitFreeSpaces(spaces,box);freeSpaces.set(container.id,spaces);
  }

  const savedMassPositions = [...lockedById.values()].filter(isValidRejectedPlacement);
  for (const bag of containers) {
    const conflict = savedBagMassConflict(bag, savedMassPositions, itemById);
    if (conflict) { massConflicts.push(conflict); blockedBagIds.add(bag.id); }
  }
  const separationConflicts = new Map<string,string>();
  for (const saved of savedMassPositions) {
    const conflict = placementSeparationError(saved,savedMassPositions,rules,itemById);
    if (conflict) { blockedBagIds.add(saved.containerId); separationConflicts.set(saved.containerId,conflict); }
  }
  const lockedLoads = assessStackLoads(placements, itemById,containers).map(load => {
    const saved = placements.find(p => p.instanceId === load.instanceId)!;
    const bag=containers.find(bag=>bag.id===saved.containerId)!;
    const others=placements.filter(p=>p.containerId===saved.containerId&&p.instanceId!==saved.instanceId),fraction=mode==='fragile_protection'?1:.65;
    const contentsError=compartmentMassError(compartmentFor(bag,saved.compartmentId),placements.filter(p=>p.containerId===bag.id),itemById);
    const supportReason=contentsError??(!hasGeometrySupport(saved,others,itemById,fraction,undefined,compartmentFor(bag,saved.compartmentId)?.z??0)
      ? mode==='fragile_protection'?`Fragile protection requires full ${itemById.get(saved.instanceId)?.packingShape?'occupied base':'rectangular'} support in the opening-up packing view; this saved position is not fully supported.`:'This saved position lacks the required support in the opening-up packing view.'
      : interiorSupportError(bag.packingInterior)??(!hasPackingAndTravelSupport(saved,others,itemById,fraction,bag)?'This saved position lacks the required support in the reviewed travel orientation.':undefined));
    return supportReason?{...load,status:'conflict' as const,reason:supportReason}:load;
  });
  for (const conflict of lockedLoads.filter(load => load.status === 'conflict')) blockedBagIds.add(conflict.containerId);
  for (const bagId of blockedBagIds) {
    const conflicts = lockedLoads.filter(load => load.containerId === bagId && load.status === 'conflict');
    const massConflict = massConflicts.find(c => c.containerId === bagId);
    const detail = [separationConflicts.get(bagId), massConflict?.reason, ...conflicts.map(load => `${load.orientation==='travel'?'Travel orientation - ':''}${itemById.get(load.instanceId)?.name ?? 'Item'}: ${load.reason}`)].filter(Boolean).join(' ') || 'A saved item geometry, scale or usable-space record changed or is invalid.';
    for (const saved of placements.filter(p => p.containerId === bagId)) {
      const item = itemById.get(saved.instanceId)!;
      excluded.push({ instanceId: item.instanceId, entryId: item.entryId, itemId: item.itemId, name: item.name, required: item.required,
        reason: `Saved locked placements conflict with recorded ${separationConflicts.has(bagId) ? 'separation rules' : massConflict ? 'weight limits' : 'geometry, assignments or stacking limits'}. ${detail} Check physically and undo packed or unlock before moving them. New placements in this bag are paused.` });
    }
    for (let i = placements.length - 1; i >= 0; i--) if (placements[i].containerId === bagId) placements.splice(i, 1);
    freeSpaces.set(bagId, []);
  }

  for (const item of items) {
    if (placedIds.has(item.instanceId)) continue;
    const candidateContainers = containers.filter(container => eligibleForBag(item,container));
    let loadFailure: string | undefined;
    let separationFailure: string | undefined;
    let searchLimited=false;
    let best: { placement: Placement; container: Container; candidate: Candidate; lookahead: number; affinity: boolean } | undefined;
    const lookaheadCache = new Map<string,number>();
    const balancingBags = mode === 'balanced' ? candidateContainers.filter(bag => !blockedBagIds.has(bag.id) && !containerSpaceError(bag) && !interiorSupportError(bag.packingInterior)) : [];
    const bagCosts = balancedBagCosts(balancingBags, placements, itemById, item.upperMassGrams);

    for (const container of candidateContainers) {
      if (blockedBagIds.has(container.id)||containerSpaceError(container)||interiorSupportError(container.packingInterior)) continue;
      const massAfter = massInContainer(container.id, placements, itemById, container.tareGrams ?? 0) + (item.upperMassGrams ?? 0);
      if (container.massLimitGrams !== undefined && massAfter > container.massLimitGrams + EPSILON) continue;
      const futureShapes=container.compartments?[]:items.filter(i=>i.instanceId!==item.instanceId&&i.packingShape&&!placements.some(p=>p.instanceId===i.instanceId)&&!placedIds.has(i.instanceId)
        && eligibleForBag(i,container)
        && (container.massLimitGrams === undefined || massAfter + (i.upperMassGrams ?? 0) <= container.massLimitGrams + EPSILON)
        && geometryOrientations(i,container).some(o=>fitsOpening(o,container)&&o.length<=container.inside.length+EPSILON&&o.width<=container.inside.width+EPSILON&&o.height<=usableContainerHeight(container)+EPSILON));
      const hasShapes=useShapeSequence;
      const bagPlacements=placements.filter(p=>p.containerId===container.id);
      const reservation=lookaheadDepth>1&&futureShapes.length>1?reservePendingShapes(futureShapes,bagPlacements,container,itemById,mode,lookaheadDepth,rules):undefined;
      const anchors=[...(reservation?.placements??[]),...futureShapes.flatMap(future=>{
        const o=geometryOrientations(future,container)[0];
        return o.length<=container.inside.length&&o.width<=container.inside.width&&o.height<=usableContainerHeight(container)?cornerPositions(initialSpace(container),o).map(position=>({instanceId:future.instanceId,entryId:future.entryId,itemId:future.itemId,containerId:container.id,...position,...o,layer:1})):[];
      })];
      const spaces = [...(freeSpaces.get(container.id) ?? []),...(hasShapes?packingRegions(container).map(region=>({...region,shapeSearch:true})):[])];
      for (const space of spaces) {
        const compartment=compartmentFor(container,space.compartmentId);if(!eligibleForCompartment(item,compartment))continue;
        const contentsError=compartmentMassError(compartment,bagPlacements,itemById,item);if(contentsError){loadFailure=contentsError;continue;}
        for (const orientation of geometryOrientations(item,container)) {
          if (!fitsOpening(orientation, container,space.compartmentId)) continue;
          if (orientation.length > space.length + EPSILON || orientation.width > space.width + EPSILON || orientation.height > space.height + EPSILON) continue;
          const contacts=space.shapeSearch?contactPositions(container,orientation,item,[...placements.filter(p=>p.containerId===container.id),...anchors],itemById,space):undefined;
          if(contacts?.limited)searchLimited=true;
          const positions = separationPositions(contacts?.positions??cornerPositions(space, orientation),space,item,orientation,item.entryId,bagPlacements,rules,itemById);
          if(positions.length>=20000)searchLimited=true;
          for (const position of positions) {
            const candidateBase = { ...position, length: orientation.length, width: orientation.width, height: orientation.height };
            const placement: Placement = {
              instanceId: item.instanceId,
              entryId: item.entryId,
              itemId: item.itemId,
              containerId: container.id,
              ...(compartment?{compartmentId:compartment.id,compartmentKey:compartmentKey(compartment)}:{}),
              x: position.x,
              y: position.y,
              z: position.z,
              length: orientation.length,
              width: orientation.width,
              height: orientation.height,
              layer: 1 + Math.max(0, ...placements.filter((placed) => placed.containerId === container.id && placed.compartmentId===space.compartmentId && placed.z + placed.height <= position.z + EPSILON).map((placed) => placed.layer)),
              rotation: orientation.rotation,
              ...(useShapeSequence?{insertionOrder:placements.length+1}:{}),
              ...(item.packingShape?{shapeKey:shapeKey(item.packingShape)}:{}),
              ...(item.packingForm?{packingFormId:item.packingForm.id,packingFormKey:packingFormKey(item.packingForm)}:{}),
              ...(container.packingInterior?{interiorKey:interiorKey(container.packingInterior)}:{}),
            };
            if(!fitsGeometrySpace(placement,container,item)||!hasPackingAndTravelSupport(placement,bagPlacements,itemById,mode==='fragile_protection'?1:.65,container))continue;
            if(bagPlacements.some(p=>geometryIntersects(placement,p,itemById)))continue;
            if(hasShapes&&!hasVerticalEntry(placement,bagPlacements,itemById,container))continue;
            const separationError = placementSeparationError(placement,[...placements,...savedMassPositions],rules,itemById);
            if(separationError){separationFailure=separationError;continue;}
            if (rejected.some((failed) => samePlacementGeometry(failed, placement))) continue;
            const needsStackCheck = useShapeSequence || stackSensitiveIds.has(item.instanceId) || bagPlacements.some(placed => stackSensitiveIds.has(placed.instanceId));
            const conflicts = needsStackCheck
              ? assessStackLoads([...bagPlacements, placement], itemById, [container]).filter(load => load.status === 'conflict')
              : [];
            if (conflicts.length) {
              loadFailure = conflicts.map(load => `${load.orientation==='travel'?'Travel orientation - ':''}${itemById.get(load.instanceId)?.name ?? 'Item'}: ${load.reason}`).join(' ');
              continue;
            }
            // Look ahead at the largest pending shape to avoid occupying its legs
            // before it can surround a smaller item. This remains a bounded heuristic.
            const future=futureShapes.reduce<PlanItem|undefined>((best,i)=>!best||i.volumeMm3>best.volumeMm3?i:best,undefined);
            let lookahead=0;
            if (future && reservation) {
              const key=JSON.stringify([container.id,placement.rotation,placement.x,placement.y,placement.z]);
              let penalty=lookaheadCache.get(key);
              if(penalty===undefined){
                penalty=reservation.penalty;
                for(const [index,next] of reservation.placements.entries()){
                  const prior=[...bagPlacements,placement,...reservation.placements.slice(0,index)];
                  if(geometryIntersects(next,placement,itemById)||placementSeparationError(next,prior,rules,itemById)||!hasVerticalEntry(next,prior,itemById,container))penalty+=itemById.get(next.instanceId)!.volumeMm3*20;
                }
                const projected=[...bagPlacements,placement,...reservation.placements],reservedVolume=reservation.placements.reduce((sum,p)=>sum+itemById.get(p.instanceId)!.volumeMm3,0);
                if((container.massLimitGrams!==undefined&&massInContainer(container.id,projected,itemById,container.tareGrams??0)>container.massLimitGrams+EPSILON)
                  ||assessStackLoads(projected,itemById,[container]).some(load=>load.status==='conflict'))penalty+=reservedVolume*20;
                lookaheadCache.set(key,penalty);
              }
              lookahead=penalty;
            } else if(future){const possible=geometryOrientations(future,container).some(o=>fitsOpening(o,container)&&cornerPositions(initialSpace(container),o).some(position=>{
              const next:Placement={...position,...o,instanceId:future.instanceId,entryId:future.entryId,itemId:future.itemId,containerId:container.id,layer:1};
              const prior=[...bagPlacements,placement];return !placementSeparationError(next,prior,rules,itemById)&&fitsGeometrySpace(next,container,future)&&!prior.some(p=>geometryIntersects(next,p,itemById))&&hasPackingAndTravelSupport(next,prior,itemById,mode==='fragile_protection'?1:.65,container)&&hasVerticalEntry(next,prior,itemById,container)
                && !assessStackLoads([...prior,next],itemById,[container]).some(load=>load.status==='conflict');
            }));if(!possible)lookahead=future.volumeMm3*20;}
            const score = placementScore(candidateBase, space, container, item, placements, mode, itemById)+lookahead;
            const weightCost = bagCosts.get(container.id), priorCost = best && bagCosts.get(best.container.id);
            // Compare lighter bags only after all placement gates, and never override
            // a known future-shape obstruction. Within a bag retain geometric scoring.
            const grouped = rules.filter(rule=>rule.kind!=='clearance'&&[rule.firstEntryId,rule.secondEntryId].includes(item.entryId));
            const affinity = grouped.length>0 && placements.some(p=>p.entryId===item.entryId&&p.containerId===container.id
              && (!grouped.some(rule=>rule.kind==='different_compartments') || p.compartmentId===space.compartmentId));
            const compareAffinity = best && affinity!==best.affinity;
            const compareWeight = best && container.id !== best.container.id && lookahead === 0 && best.lookahead === 0
              && weightCost !== undefined && priorCost !== undefined && Math.abs(weightCost - priorCost) > 1e-12;
            if (!best || (compareAffinity ? affinity : compareWeight ? weightCost! < priorCost! : score < best.candidate.score)) {
              best = { placement, container, lookahead, affinity, candidate: { ...candidateBase, rotation: orientation.rotation, score, dimensions: orientation } };
            }
          }
        }
      }
    }

    if (!best) {
      const reason = candidateContainers.length === 0
        ? `No eligible bag is available for ${item.name}.`
          : item.assignedCompartmentId&&candidateContainers.every(container=>!compartmentFor(container,item.assignedCompartmentId))
          ? 'The assigned compartment is missing from this bag. Review the checklist assignment; another area is not substituted.'
          : candidateContainers.every(container=>container.compartments?.every(c=>!eligibleForCompartment(item,c)))
          ? 'No recorded compartment allows this item and its assignment. Review the eligible categories or choose another compartment.'
          : candidateContainers.every(container=>!containerSpaceError(container)&&!!interiorSupportError(container.packingInterior))
          ? candidateContainers.map(container=>container.name+': '+interiorSupportError(container.packingInterior)).join(' ')
          : candidateContainers.every(container=>!!containerSpaceError(container))
          ? candidateContainers.map(container=>container.name+': '+containerSpaceError(container)).join(' ')
          : item.upperMassGrams !== undefined && candidateContainers.every((container) => container.massLimitGrams !== undefined && massInContainer(container.id, placements, itemById, container.tareGrams ?? 0) + item.upperMassGrams! > container.massLimitGrams!)
          ? 'Adding this item would exceed the recorded bag weight limit.'
          : candidateContainers.every(container => blockedBagIds.has(container.id))
          ? massConflicts.some(c => candidateContainers.some(b => b.id === c.containerId))
            ? 'Eligible bags are paused for recorded weight or saved-position conflicts. '+massConflicts.filter(c => candidateContainers.some(b => b.id === c.containerId)).map(c => c.reason).join(' ')
            : 'Resolve conflicting saved positions in the eligible bags. Undo packed or unlock only after checking physically.'
          : separationFailure
          ? 'No supported reachable placement satisfying the recorded separation rules was found. '+separationFailure+' Review assignments, compartments or add another bag; required items remain listed.'
          : loadFailure
          ? `No placement satisfying the recorded contents or stacking limits was found. ${loadFailure}`
          : searchLimited
          ? 'The bounded shape search reached its candidate limit without finding a supported reachable placement. This is not proof that the item cannot fit; review the shapes and bags.'
          : rejected.some((failed) => failed.instanceId === item.instanceId)
          ? 'No alternative placement was found after the failed attempt. Recheck the dimensions or bags; this item is still required if marked required.'
          : 'No placement supported in packing and any reviewed travel orientation was found in the usable space and opening after keeping recorded unavailable areas and lid clearance free. Adopted shapes also require straight downward access.';
      excluded.push({ instanceId: item.instanceId, entryId: item.entryId, itemId: item.itemId, name: item.name, required: item.required, reason });
      continue;
    }

    placements.push(best.placement);
    let remaining=freeSpaces.get(best.container.id)??[];for(const box of placementBoxes(best.placement,item))remaining=splitFreeSpaces(remaining,box);freeSpaces.set(best.container.id,remaining);
  }

  return { placements, excluded, massConflicts, score: solutionScore(placements, excluded, items, mode, containers) };
}

/** Small beam of simultaneous reservations used by repair attempts. These positions
 * influence scoring only; the final plan still checks each real insertion separately. */
function reservePendingShapes(pending: PlanItem[], prior: Placement[], bag: Container, items: Map<string,PlanItem>, mode: OptimizationMode, depth: number, rules: SeparationRule[]) {
  let beam: { placements: Placement[]; penalty: number; distance: number }[] = [{placements:prior,penalty:0,distance:0}];
  const future=[...pending].sort((a,b)=>Number(b.required)-Number(a.required)||b.volumeMm3-a.volumeMm3).slice(0,depth);
  for (const item of future) {
    const next: typeof beam = [];
    for (const state of beam) {
      next.push({...state,penalty:state.penalty+item.volumeMm3*20});
      if(bag.massLimitGrams!==undefined&&massInContainer(bag.id,state.placements,items,bag.tareGrams??0)+(item.upperMassGrams??0)>bag.massLimitGrams+EPSILON)continue;
      for (const orientation of geometryOrientations(item,bag)) {
        if(!fitsOpening(orientation,bag))continue;
        // Corners preserve alternatives at both ends. A bounded contact sample
        // adds positions between previously reserved shapes.
        const positions=[...cornerPositions(initialSpace(bag),orientation),...contactPositions(bag,orientation,item,state.placements,items).positions.slice(0,8)];
        const seen=new Set<string>();
        for (const position of positions) {
          const key=JSON.stringify([position.x,position.y,position.z]);if(seen.has(key))continue;seen.add(key);
          const placement:Placement={...position,...orientation,instanceId:item.instanceId,entryId:item.entryId,itemId:item.itemId,containerId:bag.id,layer:1};
          if(placementSeparationError(placement,state.placements,rules,items)||!fitsGeometrySpace(placement,bag,item)||state.placements.some(p=>geometryIntersects(placement,p,items))
            ||!hasPackingAndTravelSupport(placement,state.placements,items,mode==='fragile_protection'?1:.65,bag)
            ||!hasVerticalEntry(placement,state.placements,items,bag)
            ||assessStackLoads([...state.placements,placement],items,[bag]).some(load=>load.status==='conflict'))continue;
          next.push({placements:[...state.placements,placement],penalty:state.penalty,distance:state.distance+position.z*4+position.y+position.x});
        }
      }
    }
    beam=next.sort((a,b)=>a.penalty-b.penalty||a.distance-b.distance).slice(0,8);
  }
  return {penalty:beam[0]?.penalty??0,placements:beam[0]?.placements.slice(prior.length)??[]};
}

function cornerPositions(space: FreeSpace, dimensions: { length: number; width: number }) {
  const xs = [...new Set([space.x, space.x + space.length - dimensions.length])];
  const ys = [...new Set([space.y, space.y + space.width - dimensions.width])];
  return xs.flatMap((x) => ys.map((y) => ({ x, y, z: space.z })));
}

function initialSpace(container: Container): FreeSpace {
  return { x: 0, y: 0, z: 0, ...container.inside,height:usableContainerHeight(container) };
}

function fitsOpening(dimensions: { length: number; width: number; height: number }, container: Container,compartmentId?:string) {
  const opening=compartmentFor(container,compartmentId)?.opening;
  return dimensions.length<=container.opening.length+EPSILON&&dimensions.width<=container.opening.width+EPSILON&&(!opening||dimensions.length<=opening.length+EPSILON&&dimensions.width<=opening.width+EPSILON);
}

function intersects(left: FreeSpace, right: FreeSpace) {
  return left.x < right.x + right.length - EPSILON && left.x + left.length > right.x + EPSILON
    && left.y < right.y + right.width - EPSILON && left.y + left.width > right.y + EPSILON
    && left.z < right.z + right.height - EPSILON && left.z + left.height > right.z + EPSILON;
}

function placementScore(
  candidate: FreeSpace,
  space: FreeSpace,
  container: Container,
  item: PlanItem,
  placed: Placement[],
  mode: OptimizationMode,
  itemById: Map<string, PlanItem>,
) {
  const leftover = Math.max(0, spaceVolume(space) - volume(candidate));
  const shortSide = Math.min(space.length - candidate.length, space.width - candidate.width, space.height - candidate.height);
  const bagMass = massInContainer(container.id, placed, itemById, container.tareGrams ?? 0) + (item.upperMassGrams ?? 0);
  const massRatio = container.massLimitGrams ? bagMass / container.massLimitGrams : 0;
  const base = leftover + Math.max(0, shortSide) * item.volumeMm3 * 0.015;
  if (mode === 'easy_access') {
    const topPreference = (candidate.z + candidate.height) / container.inside.height;
    const frontPreference = 1 - candidate.y / container.inside.width;
    return base - (topPreference * 12 + frontPreference * 4) * item.volumeMm3;
  }
  if (mode === 'fragile_protection') {
    const centerX = (candidate.x + candidate.length / 2) / container.inside.length;
    const centerY = (candidate.y + candidate.width / 2) / container.inside.width;
    const edgeDistance = Math.abs(centerX - 0.5) + Math.abs(centerY - 0.5);
    return base + candidate.z * item.volumeMm3 * 0.02 + (item.fragile ? edgeDistance * item.volumeMm3 * 0.3 : 0);
  }
  if (mode === 'maximum_capacity') {
    const splits = Number(candidate.length < space.length) + Number(candidate.width < space.width) + Number(candidate.height < space.height);
    return base + splits * item.volumeMm3 * 0.08;
  }
  const weightedRisk = massRatio * massRatio * item.volumeMm3 * 0.22;
  const fragileAbove = item.fragile && placed.some((placement) => placement.containerId === container.id && placement.z > candidate.z + candidate.height);
  return base + Math.max(0, candidate.z) * item.volumeMm3 * 0.02 + weightedRisk + (fragileAbove ? item.volumeMm3 * 0.4 : 0);
}

function massInContainer(containerId: string, placements: Placement[], items: Map<string, PlanItem>, tareGrams = 0) {
  return placements.filter((placement) => placement.containerId === containerId)
    .reduce((sum, placement) => sum + (items.get(placement.instanceId)?.upperMassGrams ?? 0), tareGrams);
}

function splitFreeSpaces(spaces: FreeSpace[], used: FreeSpace): FreeSpace[] {
  const next: FreeSpace[] = [];
  for (const space of spaces) {
    if (!intersects(space, used)) {
      next.push(space);
      continue;
    }
    const right = space.x + space.length;
    const back = space.y + space.width;
    const top = space.z + space.height;
    if (used.x > space.x + EPSILON) next.push({ ...space, length: used.x - space.x });
    if (used.x + used.length < right - EPSILON) next.push({ ...space, x: used.x + used.length, length: right - used.x - used.length });
    if (used.y > space.y + EPSILON) next.push({ ...space, width: used.y - space.y });
    if (used.y + used.width < back - EPSILON) next.push({ ...space, y: used.y + used.width, width: back - used.y - used.width });
    if (used.z > space.z + EPSILON) next.push({ ...space, height: used.z - space.z });
    if (used.z + used.height < top - EPSILON) next.push({ ...space, z: used.z + used.height, height: top - used.z - used.height });
  }
  const valid = next.filter((space) => space.length > EPSILON && space.width > EPSILON && space.height > EPSILON);
  return valid.filter((space, index) => !valid.some((other, otherIndex) => otherIndex !== index && contains(other, space)&&(!contains(space,other)||otherIndex<index)));
}

function contains(outer: FreeSpace, inner: FreeSpace) {
  return outer.x <= inner.x + EPSILON && outer.y <= inner.y + EPSILON && outer.z <= inner.z + EPSILON
    && outer.x + outer.length >= inner.x + inner.length - EPSILON
    && outer.y + outer.width >= inner.y + inner.width - EPSILON
    && outer.z + outer.height >= inner.z + inner.height - EPSILON;
}

function solutionScore(placements: Placement[], excluded: ExcludedItem[], items: PlanItem[], mode: OptimizationMode, containers: Container[]) {
  const packedIds = new Set(placements.map((placement) => placement.instanceId));
  const missingRequired = excluded.filter((item) => item.required && item.reason !== 'Marked unavailable for this plan.').length;
  const packed = items.filter((item) => packedIds.has(item.instanceId));
  const base = packed.reduce((sum, item) => sum + priorityScore(item) * 10 + item.volumeMm3 / 100, 0) - missingRequired * 1_000_000;
  if (mode === 'maximum_capacity') return base + packed.length * 500_000 - excluded.length * 100;
  if (mode === 'easy_access') {
    const access = retrievalReward(placements, containers, items);
    return base + access - excluded.length * 100;
  }
  return base - excluded.length * 100 - (mode === 'balanced' ? balancedResultPenalty(containers, placements, new Map(items.map(item => [item.instanceId, item]))) : 0);
}
