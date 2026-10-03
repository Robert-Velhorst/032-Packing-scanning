import type { BagMassConflict, UnitSystem } from '../types';

export function BagMassConflictNote({ conflict, unit = 'metric' }: { conflict?: BagMassConflict; unit?: UnitSystem }) {
  if (!conflict) return null;
  const show = (n: number) => (n / (unit === 'metric' ? 1 : 28.3495)).toLocaleString('en-GB', { maximumFractionDigits: 3 }) + (unit === 'metric' ? ' g' : ' oz');
  return <div className="bag-mass-conflict" role="note" aria-label="Bag weight conflict"><strong>Bag paused · weight needs review</strong>
    {conflict.status === 'over' && conflict.knownUpperMassGrams !== undefined && conflict.limitGrams !== undefined
      ? <p>Upper saved packed-weight {conflict.missingItemCount || conflict.missingTare ? 'subtotal' : 'total'}: {show(conflict.knownUpperMassGrams)}. Recorded bag limit: {show(conflict.limitGrams)}. The saved amount already exceeds it.</p>
      : <p>{conflict.reason}</p>}
    {(conflict.missingItemCount > 0 || conflict.missingTare) && <p>Missing weights remain unresolved.{conflict.missingItemCount > 0 && ` ${conflict.missingItemCount} packed item ${conflict.missingItemCount === 1 ? 'weight' : 'weights'} missing.`}{conflict.missingTare && ' Empty bag weight missing.'}</p>}
    <p>Saved positions and completion stay unchanged. Check the real contents and weights, then correct the relevant record or deliberately undo packed positions. New placements in this bag are paused; these saved weights are not a packed-bag scale reading.</p>
  </div>;
}
