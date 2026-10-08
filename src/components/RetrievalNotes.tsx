import { reviewRetrieval } from '../retrieval';
import { orderPackingSteps } from '../packing-sequence';
import type { Container, LibraryItem, PackingPlan, Trip } from '../types';

export function RetrievalNotes({ trip, items, bags, plan, instanceId }: {
  trip: Trip; items: LibraryItem[]; bags: Container[]; plan: PackingPlan; instanceId?: string;
}) {
  const review = reviewRetrieval(trip,items,bags,plan);
  const names = new Map(orderPackingSteps(plan.placements,bags).map((p,index) => [p.instanceId, `${index+1}. ${items.find(item => item.id === p.itemId)?.name ?? 'Item'}`]));
  const checks = instanceId ? review.checks.filter(check => check.instanceId === instanceId)
    : review.checks.filter(check => review.priorityInstanceIds.includes(check.instanceId) || check.status !== 'clear');
  const priorityClear = review.checks.filter(check => check.status === 'clear' && review.priorityInstanceIds.includes(check.instanceId)).length;
  return <section className="retrieval-notes" aria-label="Retrieval from the finished pack">
    <h4>Retrieval from the finished pack</h4>
    {!instanceId && <p>{review.priorityInstanceIds.length ? `${priorityClear} of ${review.priorityInstanceIds.length} placed priority-access items have a clear upward path in the model.` : 'No proposed priority-access items to assess.'}</p>}
    <p>Checks use the finished proposed pack, fixed orientation and the reviewed top access. They do not establish physical retrieval, hand clearance, zipper access or stability. Open the bag in its packing orientation first.</p>
    {review.unresolvedPackedCount > 0 && <p className="retrieval-review">{review.unresolvedPackedCount} saved packed {review.unresolvedPackedCount === 1 ? 'position needs' : 'positions need'} review. Their contents may still obstruct retrieval.</p>}
    <ul>{checks.map(check => <li key={check.instanceId} data-retrieval-status={check.status}>
      <strong>{names.get(check.instanceId)}</strong>: {check.status === 'clear' ? 'Clear upward path in the model.'
        : check.status === 'rearrange' ? `${check.beforeInstanceIds.length} other planned ${check.beforeInstanceIds.length === 1 ? 'item is' : 'items are'} involved before retrieval.`
        : check.status === 'blocked' ? 'Upward retrieval blocked in the model.' : 'Retrieval check incomplete.'}
      {!!check.beforeInstanceIds.length && <p>Items involved: {check.beforeInstanceIds.map(id => names.get(id) ?? id).join(', ')}. This is not an unpacking sequence; check support before moving anything.</p>}
      {!!check.supportingInstanceIds.length && <p>Supports other planned items. Removing it can disturb their support.</p>}
      {check.reason && <p>{check.reason}</p>}
    </li>)}</ul>
  </section>;
}
