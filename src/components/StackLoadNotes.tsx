import { useState } from 'react';
import { packingItemForPlacement } from '../packing-forms';
import type { LibraryItem, PackingPlan, UnitSystem } from '../types';

export function StackLoadNotes({ plan, items, unit = 'metric', containerId, instanceId }: {
  plan: PackingPlan; items: LibraryItem[]; unit?: UnitSystem; containerId?: string; instanceId?: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const checks = (plan.stackLoads ?? []).filter(load => (!containerId || load.containerId === containerId)
    && (!instanceId || load.instanceId === instanceId));
  if (!checks.length) return null;
  const itemsById = new Map(items.map(item => [item.id, item]));
  const placementById = new Map(plan.placements.map(p => [p.instanceId, p]));
  const travelInstanceIds = new Set(checks.filter(load => load.orientation === 'travel').map(load => load.instanceId));
  const weight = (grams: number) => `${Number((grams / (unit === 'metric' ? 1 : 28.3495)).toFixed(2))} ${unit === 'metric' ? 'g' : 'oz'}`;
  const unverifiedCount = checks.filter(load => load.status === 'unverified').length;
  const withinLimitCount = checks.filter(load => load.status === 'within_recorded_limit').length;
  const clearCount = checks.filter(load => load.status === 'clear').length;
  const collapseRows = checks.length > 10 && !checks.some(load => load.status === 'conflict');
  const rows = !collapseRows || detailsOpen ? checks.map(load => {
    const placed=placementById.get(load.instanceId);const item = placed?packingItemForPlacement(itemsById.get(placed.itemId),placed):undefined;
    return <p key={load.instanceId+':'+(load.orientation??'packing')} data-orientation={load.orientation??'packing'}><strong>{item?.name ?? 'Item'}{load.orientation==='travel'?' · travel orientation':travelInstanceIds.has(load.instanceId)?' · packing orientation':''}:</strong>{' '}
      {load.aboveInstanceIds.length ? `${weight(load.upperLoadGrams)} upper saved weight from ${load.aboveInstanceIds.length} items above` : 'No planned item rests above'}
      {load.unknownMassCount > 0 && `; ${load.unknownMassCount} weights unknown`}.{' '}
      {item?.fragile ? 'Fragile: nothing may rest on it.' : load.limitGrams === 0 ? 'No stacking allowed.'
        : load.limitGrams !== undefined ? `Recorded limit ${weight(load.limitGrams)} (${item?.topLoadEvidence?.source.replace('_', ' ') ?? 'source missing'}).`
          : 'Stacking limit not recorded.'}{' '}
      {load.status === 'unverified' ? 'Load-bearing ability is unverified.' : load.reason ?? ''}
    </p>;
  }) : null;
  return <aside className="stack-load-notes" aria-label={instanceId ? 'Stacking check for this item' : 'Stacking checks'}>
    <strong>Weight resting above · static estimate</strong>
    {collapseRows ? <>
      <p>{checks.length} orientation checks: {unverifiedCount} unverified, {withinLimitCount} within recorded limits, {clearCount} with no load above.</p>
      <details onToggle={event => setDetailsOpen(event.currentTarget.open)}>
        <summary>Review individual stacking checks</summary>
        {detailsOpen && rows}
      </details>
    </> : rows}
    <small>Full supported weight is counted on every support path in each checked orientation. This does not simulate pressure, impact, cushioning, moving between orientations or arbitrary tilts. Recorded limits must apply to the contacting faces; include wrapping in dimensions and weight and confirm the real support.</small>
  </aside>;
}
