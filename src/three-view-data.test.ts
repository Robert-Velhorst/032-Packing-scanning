import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import type { Placement } from './types';
import { coveredPlacementLabelIds, sameThreeViewData, threeViewData } from './three-view-data';

const placement = (instanceId: string, itemId: string, containerId: string): Placement => ({
  instanceId, entryId: `${instanceId}-entry`, itemId, containerId,
  x: 0, y: 0, z: 0, length: 10, width: 10, height: 10, layer: 1, rotation: 0,
});

describe('3D view data projection', () => {
  it('skips unlabeled coverage work and preserves center-occlusion rules for labeled placements', () => {
    const lower = placement('lower', 'item-lower', 'bag');
    const upper = { ...placement('upper', 'item-upper', 'bag'), z: 10 };
    const otherBag = { ...upper, instanceId: 'other-bag', containerId: 'other' };

    expect(coveredPlacementLabelIds([lower, upper, otherBag], 'bag')).toEqual(new Set());
    expect(coveredPlacementLabelIds([lower, upper, otherBag], 'bag', { lower: '1' })).toEqual(new Set(['lower']));
    expect(coveredPlacementLabelIds([lower, upper, otherBag], 'bag', { upper: '2' })).toEqual(new Set());
  });

  it('sends only placements for the selected bag and their referenced library items', () => {
    const data = createInitialData(), items = data.libraryItems, container = data.containers[0];
    const [used, unrelated] = items;
    const plan = { placements: [
      placement('selected-1', used.id, 'selected-bag'),
      placement('selected-2', used.id, 'selected-bag'),
      placement('other-bag', unrelated.id, 'other-bag'),
    ] };

    const result = threeViewData({ ...container, id: 'selected-bag' }, plan, items);
    expect(result.container).toMatchObject({ id: 'selected-bag', name: container.name, inside: container.inside });
    expect(Object.keys(result.container ?? {}).sort()).toEqual([
      'compartments', 'id', 'inside', 'lidClearanceEvidence', 'lidClearanceMm', 'name', 'opening', 'openingEvidence', 'packingInterior', 'unavailableSpaces',
    ]);
    expect(result.plan).toEqual({ placements: plan.placements.slice(0, 2) });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: used.id, category: used.category, flexibility: used.flexibility, packingShape: used.packingShape });
    expect(Object.keys(result.items[0]).sort()).toEqual([
      'category', 'createdAt', 'dimensionEvidence', 'dimensions', 'flexibility', 'fragile', 'id', 'keepUpright', 'name', 'packingForms', 'packingShape', 'updatedAt',
    ]);
  });

  it('does not include records when no bag is selected', () => {
    const data = createInitialData(), items = data.libraryItems;
    const plan = { placements: [placement('instance', items[0].id, 'bag')] };
    expect(threeViewData(undefined, plan, items)).toEqual({ container: undefined, plan: { placements: [] }, items: [] });
  });

  it('treats metadata-only item and container updates as the same 3D render input', () => {
    const data = createInitialData(), container = data.containers[0], [item] = data.libraryItems;
    const plan = { placements: [placement('instance', item.id, container.id)] };
    const prior = threeViewData(container, plan, [item]);
    const metadataChanged = threeViewData(
      { ...container, massLimitGrams: (container.massLimitGrams ?? 0) + 1 },
      plan,
      [{ ...item, photoId: 'new-photo', scan: undefined, name: 'Renamed metadata' }],
    );

    expect(sameThreeViewData(prior, metadataChanged)).toBe(true);
  });

  it('detects changes to placement, visual item properties, and bag geometry', () => {
    const data = createInitialData(), container = data.containers[0], [item] = data.libraryItems;
    const plan = { placements: [placement('instance', item.id, container.id)] };
    const prior = threeViewData(container, plan, [item]);

    expect(sameThreeViewData(prior, threeViewData(container, { placements: [{ ...plan.placements[0], x: 1 }] }, [item]))).toBe(false);
    expect(sameThreeViewData(prior, threeViewData(container, plan, [{ ...item, category: 'clothing' }]))).toBe(false);
    expect(sameThreeViewData(prior, threeViewData({ ...container, inside: { ...container.inside, length: container.inside.length + 1 } }, plan, [item]))).toBe(false);
  });
});
