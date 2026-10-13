import type { Container, Evidence, LibraryItem } from './types.ts';

export const handlingEvidenceKeys = ['flexibilityEvidence', 'fragileEvidence', 'keepUprightEvidence'] as const;
const sources = ['measured', 'known', 'estimated', 'user_confirmed', 'provider'];
const labels: Record<Evidence['source'], string> = {
  measured: 'Measured', known: 'Known record', estimated: 'Estimate',
  user_confirmed: 'Confirmed by you', provider: 'Provider record',
};

/** Missing evidence stays missing; malformed evidence is never a confirmation. */
export function isPropertyEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const e = value as Record<string, unknown>;
  if (!Object.keys(e).every(key => ['source', 'confidence', 'collectedAt', 'note'].includes(key))) return false;
  if (!sources.includes(String(e.source)) || typeof e.confidence !== 'number' || !Number.isFinite(e.confidence)
    || e.confidence < 0 || e.confidence > 1 || typeof e.collectedAt !== 'string') return false;
  // A real UTC instant: Date.parse alone normalizes impossible calendar dates.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(e.collectedAt)) return false;
  const time = Date.parse(e.collectedAt);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace('.000Z', 'Z') !== e.collectedAt.replace('.000Z', 'Z')) return false;
  return e.note === undefined || typeof e.note === 'string' && e.note.length <= 2000;
}

export function handlingEvidenceError(item: Pick<LibraryItem, typeof handlingEvidenceKeys[number]>): string | undefined {
  if (handlingEvidenceKeys.some(key => item[key] !== undefined && !isPropertyEvidence(item[key]))) {
    return 'Handling-property evidence is invalid. Review its source, confidence and review date.';
  }
}

export function openingEvidenceError(bag: Pick<Container, 'openingEvidence'>): string | undefined {
  if (bag.openingEvidence !== undefined && !isPropertyEvidence(bag.openingEvidence)) {
    return 'Opening evidence is invalid. Review its source, confidence and review date.';
  }
}

/** Editing a value cannot reuse the old value's confirmation or review date. */
export function changedPropertyEvidence(previous: Evidence | undefined, now = new Date().toISOString()): Evidence | undefined {
  if (!previous) return undefined;
  return { source: 'estimated', confidence: Math.min(isPropertyEvidence(previous) ? previous.confidence : .5, .5),
    collectedAt: now, note: 'Value changed after its previous review. Review this value again before relying on it.' };
}

export function propertyEvidenceText(evidence: Evidence | undefined): string {
  if (!evidence) return 'Not reviewed · confidence unknown';
  if (!isPropertyEvidence(evidence)) return 'Invalid evidence · review required';
  return `${labels[evidence.source]} · ${Math.round(evidence.confidence * 100)}% recorded confidence · reviewed ${evidence.collectedAt.slice(0, 10)}`;
}

export function handlingPropertyRows(item: LibraryItem) {
  return [
    { label: 'Flexibility', value: item.flexibility.replaceAll('_', ' '), evidence: item.flexibilityEvidence },
    { label: 'Fragility', value: item.fragile ? 'Fragile · no stacking' : 'No fragile flag', evidence: item.fragileEvidence },
    { label: 'Upright handling', value: item.keepUpright ? 'Keep upright' : 'No upright restriction', evidence: item.keepUprightEvidence },
  ];
}

export function needsPropertyReview(evidence: Evidence | undefined): boolean {
  return !isPropertyEvidence(evidence) || evidence.source === 'estimated' || evidence.confidence < .8;
}
