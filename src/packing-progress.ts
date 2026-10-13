import type { Placement, Trip } from './types.ts';

const COORDINATES = ['x', 'y', 'z', 'length', 'width', 'height'] as const;

export function samePlacementGeometry(left: Placement, right: Placement): boolean {
  return left.instanceId === right.instanceId && left.containerId === right.containerId
    && left.compartmentId===right.compartmentId&&left.compartmentKey===right.compartmentKey&&left.shapeKey === right.shapeKey && left.interiorKey===right.interiorKey && left.packingFormId===right.packingFormId && left.packingFormKey===right.packingFormKey && (left.shapeKey === undefined || left.rotation === right.rotation)
    && COORDINATES.every((key) => Math.abs(left[key] - right[key]) <= 0.01);
}

export function isValidRejectedPlacement(value: unknown): value is Placement {
  if (!value || typeof value !== 'object') return false;
  const placement = value as Placement;
  return ['instanceId', 'entryId', 'itemId', 'containerId'].every((key) =>
    typeof placement[key as keyof Placement] === 'string' && Boolean(placement[key as keyof Placement]))
    && COORDINATES.every((key) => typeof placement[key] === 'number' && Number.isFinite(placement[key])
      && (key === 'x' || key === 'y' || key === 'z' ? placement[key] >= 0 : placement[key] > 0))
    && Number.isInteger(placement.layer) && placement.layer > 0 && Number.isFinite(placement.rotation)
    && ((placement.compartmentId===undefined&&placement.compartmentKey===undefined)||(typeof placement.compartmentId==='string'&&placement.compartmentId.trim().length>0&&placement.compartmentId.length<=100&&typeof placement.compartmentKey==='string'&&placement.compartmentKey.length>0&&placement.compartmentKey.length<=1400))
    && (placement.shapeKey===undefined||typeof placement.shapeKey==='string'&&placement.shapeKey.length<=180)
    && (placement.interiorKey===undefined||typeof placement.interiorKey==='string'&&placement.interiorKey.length<=260)
    && ((placement.packingFormId===undefined&&placement.packingFormKey===undefined)||(typeof placement.packingFormId==='string'&&placement.packingFormId.trim().length>0&&placement.packingFormId.length<=80&&typeof placement.packingFormKey==='string'&&placement.packingFormKey.length>0&&placement.packingFormKey.length<=1400))
    && (placement.insertionOrder===undefined||Number.isInteger(placement.insertionOrder)&&placement.insertionOrder>0);
}

export function rejectPackingPlacement(trip: Trip, placement: Placement): Trip {
  const rejected = trip.rejectedPlacements ?? [];
  return {
    ...trip,
    rejectedPlacements: rejected.some((previous) => samePlacementGeometry(previous, placement))
      ? rejected : [...rejected, { ...placement, locked: false }],
    completedInstanceIds: trip.completedInstanceIds.filter((id) => id !== placement.instanceId),
    lockedPlacements: trip.lockedPlacements.filter((saved) => saved.instanceId !== placement.instanceId),
  };
}

export function markPackingItemUnavailable(trip: Trip, instanceId: string): Trip {
  return {
    ...trip,
    unavailableInstanceIds: [...new Set([...trip.unavailableInstanceIds, instanceId])],
    completedInstanceIds: trip.completedInstanceIds.filter((id) => id !== instanceId),
    lockedPlacements: trip.lockedPlacements.filter((saved) => saved.instanceId !== instanceId),
  };
}
export function setPackingItemComplete(trip: Trip, instanceId: string, complete: boolean, placement?: Placement): Trip {
  if (complete) {
    if (trip.completedInstanceIds.includes(instanceId) || trip.unavailableInstanceIds.includes(instanceId)
      || !placement || placement.instanceId !== instanceId) return trip;
    const existing = trip.lockedPlacements.find((saved) => saved.instanceId === instanceId);
    return { ...trip, completedInstanceIds: [...trip.completedInstanceIds, instanceId],
      lockedPlacements: existing ? trip.lockedPlacements : [...trip.lockedPlacements, { ...placement, locked: true }] };
  }
  return { ...trip, completedInstanceIds: trip.completedInstanceIds.filter((id) => id !== instanceId),
    lockedPlacements: trip.lockedPlacements.filter((saved) => saved.instanceId !== instanceId) };
}
