import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import type { Placement } from './types';
import { threeViewData } from './three-view-data';

const placement = (instanceId: string, itemId: string, containerId: string): Placement => ({
  instanceId, entryId: `${instanceId}-entry`, itemId, containerId,
  x: 0, y: 0, z: 0, length: 10, width: 10, height: 10, layer: 1, rotation: 0,
});

describe('3D view data projection', () => {
  it('sends only placements for the selected bag and their referenced library items', () => {
    const items = createInitialData().libraryItems;
    const [used, unrelated] = items;
    const plan = { placements: [
      placement('selected-1', used.id, 'selected-bag'),
      placement('selected-2', used.id, 'selected-bag'),
      placement('other-bag', unrelated.id, 'other-bag'),
    ] };

    expect(threeViewData('selected-bag', plan, items)).toEqual({
      plan: { placements: plan.placements.slice(0, 2) },
      items: [used],
    });
  });

  it('does not include records when no bag is selected', () => {
    const items = createInitialData().libraryItems;
    const plan = { placements: [placement('instance', items[0].id, 'bag')] };
    expect(threeViewData(undefined, plan, items)).toEqual({ plan: { placements: [] }, items: [] });
  });
});
