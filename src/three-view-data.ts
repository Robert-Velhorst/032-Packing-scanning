import type { LibraryItem, PackingPlan } from './types';

export type ThreeViewPlan = Pick<PackingPlan, 'placements'>;

/** Keep the iframe message limited to the selected bag and its referenced items. */
export function threeViewData(containerId: string | undefined, plan: ThreeViewPlan, items: LibraryItem[]) {
  const placements = containerId
    ? plan.placements.filter((placement) => placement.containerId === containerId)
    : [];
  const itemIds = new Set(placements.map((placement) => placement.itemId));
  return {
    plan: { placements },
    items: items.filter((item) => itemIds.has(item.id)),
  };
}
