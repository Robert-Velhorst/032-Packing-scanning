import type { Container, LibraryItem, PackingPlan, Placement } from './types';

export type ThreeViewPlan = Pick<PackingPlan, 'placements'>;

export interface ThreeViewData {
  container?: Container;
  plan: ThreeViewPlan;
  items: LibraryItem[];
}

/** Keep the iframe message limited to the selected bag and its referenced items. */
export function threeViewData(container: Container | undefined, plan: ThreeViewPlan, items: LibraryItem[]): ThreeViewData {
  const placements = container
    ? plan.placements.filter((placement) => placement.containerId === container.id)
    : [];
  const itemIds = new Set(placements.map((placement) => placement.itemId));
  return {
    container,
    plan: { placements },
    items: items.filter((item) => itemIds.has(item.id)),
  };
}

const sameDimensions = (left: Container['inside'], right: Container['inside']) => left === right
  || left.length === right.length && left.width === right.width && left.height === right.height;
const samePlacement = (left: Placement, right: Placement) => left === right
  || left.instanceId === right.instanceId && left.entryId === right.entryId && left.itemId === right.itemId
    && left.containerId === right.containerId && left.compartmentId === right.compartmentId && left.compartmentKey === right.compartmentKey
    && left.x === right.x && left.y === right.y && left.z === right.z
    && left.length === right.length && left.width === right.width && left.height === right.height
    && left.layer === right.layer && left.rotation === right.rotation && left.shapeKey === right.shapeKey
    && left.interiorKey === right.interiorKey && left.packingFormId === right.packingFormId
    && left.packingFormKey === right.packingFormKey && left.insertionOrder === right.insertionOrder && left.locked === right.locked;
const sameItem = (left: LibraryItem, right: LibraryItem) => left === right
  || left.id === right.id && left.category === right.category && left.flexibility === right.flexibility
    && left.packingShape === right.packingShape && left.packingForms === right.packingForms;

/** Compare only fields consumed by the 3D scene so metadata-only edits do not rebuild it. */
export function sameThreeViewData(left: ThreeViewData, right: ThreeViewData): boolean {
  const leftContainer = left.container, rightContainer = right.container;
  if (leftContainer !== rightContainer) {
    if (!leftContainer || !rightContainer || leftContainer.id !== rightContainer.id || leftContainer.name !== rightContainer.name
      || !sameDimensions(leftContainer.inside, rightContainer.inside)
      || leftContainer.compartments !== rightContainer.compartments
      || leftContainer.packingInterior !== rightContainer.packingInterior
      || leftContainer.unavailableSpaces !== rightContainer.unavailableSpaces
      || leftContainer.lidClearanceMm !== rightContainer.lidClearanceMm
      || leftContainer.lidClearanceEvidence !== rightContainer.lidClearanceEvidence
      || leftContainer.openingEvidence !== rightContainer.openingEvidence
      || leftContainer.opening.length !== rightContainer.opening.length || leftContainer.opening.width !== rightContainer.opening.width) return false;
  }
  const leftPlacements = left.plan.placements, rightPlacements = right.plan.placements;
  if (leftPlacements.length !== rightPlacements.length) return false;
  for (let index = 0; index < leftPlacements.length; index++) if (!samePlacement(leftPlacements[index], rightPlacements[index])) return false;
  if (left.items.length !== right.items.length) return false;
  for (let index = 0; index < left.items.length; index++) if (!sameItem(left.items[index], right.items[index])) return false;
  return true;
}
