import type { Evidence, LibraryItem } from './types.ts';

type LoadItem = Pick<LibraryItem, 'fragile' | 'maxTopLoadGrams' | 'topLoadEvidence'>;

export function topLoadError(item: LoadItem): string | undefined {
  if (item.maxTopLoadGrams === undefined) return item.topLoadEvidence === undefined ? undefined : 'Enter the stacking limit that this source describes.';
  if (!Number.isFinite(item.maxTopLoadGrams) || item.maxTopLoadGrams < 0 || item.maxTopLoadGrams > 100000)
    return 'Allowed weight above must be between zero and 100,000 grams.';
  const evidence: Evidence | undefined = item.topLoadEvidence;
  if (!evidence || !['measured', 'known', 'estimated', 'user_confirmed', 'provider'].includes(evidence.source)
    || !Number.isFinite(evidence.confidence) || evidence.confidence < 0 || evidence.confidence > 1
    || typeof evidence.collectedAt !== 'string' || !Number.isFinite(Date.parse(evidence.collectedAt)))
    return 'Record how you know the allowed weight above.';
}
