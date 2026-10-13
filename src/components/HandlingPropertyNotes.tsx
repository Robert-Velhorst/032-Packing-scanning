import type { Container, LibraryItem } from '../types';
import { handlingPropertyRows, propertyEvidenceText } from '../property-evidence';

export function HandlingPropertyNotes({ item, expanded = false }: { item: LibraryItem; expanded?: boolean }) {
  return <details className="property-evidence-notes" open={expanded}><summary>Handling properties · source and confidence</summary>
    {handlingPropertyRows(item).map(row => <p key={row.label}><strong>{row.label}:</strong> {row.value} · {propertyEvidenceText(row.evidence)}{row.evidence?.note && <small>{row.evidence.note}</small>}</p>)}
    <small>Missing evidence does not confirm that an item is robust or safe to rotate. Review the real object before following the plan.</small>
  </details>;
}

export function OpeningEvidenceNotes({ bag }: { bag: Container }) {
  return <p className="opening-evidence-note"><strong>Opening evidence:</strong> {propertyEvidenceText(bag.openingEvidence)}{bag.openingEvidence?.note && <small>{bag.openingEvidence.note}</small>}</p>;
}
