import type { Container, LibraryItem, PackingPlan, Placement } from './types';

export type ThreeViewPlan = Pick<PackingPlan, 'placements'>;

export type ThreeViewContainer = Pick<Container,
  'id' | 'name' | 'inside' | 'compartments' | 'packingInterior' | 'unavailableSpaces'
  | 'lidClearanceMm' | 'lidClearanceEvidence' | 'opening' | 'openingEvidence'>;
export type ThreeViewItem = Pick<LibraryItem,
  'id' | 'name' | 'category' | 'dimensions' | 'dimensionEvidence' | 'flexibility' | 'fragile'
  | 'keepUpright' | 'createdAt' | 'updatedAt' | 'packingShape' | 'packingForms'>;

export interface ThreeViewData {
  container?: ThreeViewContainer;
  plan: ThreeViewPlan;
  items: ThreeViewItem[];
}

/** Send only the selected bag's render inputs and the item fields used by its scene. */
export function threeViewData(container: Container | undefined, plan: ThreeViewPlan, items: LibraryItem[]): ThreeViewData {
  const placements = container
    ? plan.placements.filter((placement) => placement.containerId === container.id)
    : [];
  const itemIds = new Set(placements.map((placement) => placement.itemId));
  return {
    container: container && {
      id: container.id,
      name: container.name,
      inside: container.inside,
      compartments: container.compartments,
      packingInterior: container.packingInterior,
      unavailableSpaces: container.unavailableSpaces,
      lidClearanceMm: container.lidClearanceMm,
      lidClearanceEvidence: container.lidClearanceEvidence,
      opening: container.opening,
      openingEvidence: container.openingEvidence,
    },
    plan: { placements },
    items: items.filter((item) => itemIds.has(item.id)).map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      dimensions: item.dimensions,
      dimensionEvidence: item.dimensionEvidence,
      flexibility: item.flexibility,
      fragile: item.fragile,
      keepUpright: item.keepUpright,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      packingShape: item.packingShape,
      packingForms: item.packingForms,
    })),
  };
}

/** Find labeled placements hidden by another placement above their center point. */
export function coveredPlacementLabelIds(
  placements: readonly Placement[],
  containerId: string,
  placementLabels?: Record<string, string>,
): Set<string> {
  if (!placementLabels) return new Set();
  const candidates = placements.filter(placement => placement.containerId === containerId);
  if (!candidates.some(placement => placementLabels[placement.instanceId])) return new Set();
  candidates.sort((left, right) => right.z - left.z);
  const covered = new Set<string>();
  for (const placement of candidates) {
    if (!placementLabels[placement.instanceId]) continue;
    const coverHeight = placement.z + placement.height - 0.01;
    for (const other of candidates) {
      if (other.z < coverHeight) break;
      if (other.instanceId !== placement.instanceId && other.x <= placement.x + placement.length / 2
        && other.x + other.length >= placement.x + placement.length / 2
        && other.y <= placement.y + placement.width / 2
        && other.y + other.width >= placement.y + placement.width / 2) {
        covered.add(placement.instanceId);
        break;
      }
    }
  }
  return covered;
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
