import { useMemo, useState } from 'react';
import type { Container, LibraryItem, PackingPlan, Trip, UnitSystem } from '../types';
import { buildPackingEvidenceReview, type ReviewGroup, type ReviewStatus } from '../packing-evidence-review';
import { propertyEvidenceText } from '../property-evidence';

const statusLabels: Record<ReviewStatus, string> = {
  missing: 'Not reviewed', invalid: 'Correct record', estimated: 'Estimate', low_confidence: 'Lower confidence',
  recorded: 'Source recorded', optional: 'Optional · not recorded',
};

export function PackingEvidenceReview({ trip, items, bags, plan, unit, print = false, onReview }: {
  trip: Trip; items: LibraryItem[]; bags: Container[]; plan: PackingPlan; unit: UnitSystem; print?: boolean;
  onReview?: (group: ReviewGroup) => void;
}) {
  const [filter, setFilter] = useState('needs_review');
  const [expanded, setExpanded] = useState(print);
  const review = useMemo(() => buildPackingEvidenceReview(trip, items, bags, plan, unit), [trip, items, bags, plan, unit]);
  const groups = (print || expanded ? review.groups : []).map(group => ({ ...group,
    properties: print || filter === 'needs_review' ? group.properties.filter(row => row.needsReview) : group.properties,
  })).filter(group => group.properties.length);
  const contents = (print || expanded) ? <>
    <p>{review.needsReviewCount} {review.needsReviewCount === 1 ? 'property needs' : 'properties need'} review across {review.reviewGroupCount} selected item/form or bag records.</p>
    <p>Check uncertainty before following the plan. Opening this review does not confirm values, change packed positions or rescan belongings.</p>
    {trip.sample && <p className="evidence-review-example">Example pack: saved source labels are example records, not your measurements.</p>}
    {!print && <label className="field evidence-review-filter"><span>Show records</span><select aria-label="Packing evidence filter" value={filter} onChange={event => setFilter(event.target.value)}>
      <option value="needs_review">Needs review</option><option value="all">All selected properties</option>
    </select></label>}
    {!groups.length && <p className="evidence-review-empty">{review.propertyCount ? 'No selected properties are currently flagged. Recorded sources and confidence do not establish physical fit, closure or safety.' : 'Add items and bags to this pack to review their evidence.'}</p>}
    <div className="evidence-review-groups">{groups.map(group => <article key={group.id} className="evidence-review-group">
      <div className="evidence-review-group-heading"><h3>{group.name}</h3>{onReview && !print && <button type="button" className="button button-secondary" aria-label={`${group.kind === 'missing' ? 'Open backup settings for' : 'Review'} ${group.name}`} onClick={() => onReview(group)}>
        {group.kind === 'missing' ? 'Backup settings' : group.kind === 'container' ? 'Review bag' : 'Review item'}
      </button>}</div>
      <ul>{group.properties.map(row => <li key={row.id} data-review-status={row.status}>
        <div><strong>{row.label}</strong><span className={'review-property-status ' + row.status}>{statusLabels[row.status]}</span></div>
        <p>{row.value}</p><p className="review-property-source">{propertyEvidenceText(row.evidence)}</p>
        {row.detail && <p>{row.detail}</p>}{row.evidence?.note && <small>{row.evidence.note}</small>}
      </li>)}</ul>
    </article>)}</div>
    <small>These reminders cover selected packing records. Estimated geometry remains an estimate even with confirmed measurements. Carrier applicability and source freshness are reviewed separately in Carrier rules. Real objects, support, opening clearance and closure still need physical checks.</small>
  </> : null;
  if (print) return <section className="packing-evidence-review evidence-review-print" aria-label="Packing evidence review"><h2>Evidence to check before packing</h2>{contents}</section>;
  return <details className="packing-evidence-review" aria-label="Packing evidence review" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span>Review packing evidence</span><span>{review.needsReviewCount} {review.needsReviewCount === 1 ? 'property' : 'properties'} to check</span></summary>
    {contents}
  </details>;
}
