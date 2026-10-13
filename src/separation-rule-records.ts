import type { Trip } from './types.ts';

export const MAX_SEPARATION_RULES = 50;
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 500;

/** One rule per unordered entry pair; unknown fields cannot introduce a hidden preference. */
export function separationRuleError(trip: Pick<Trip,'entries'|'separationRules'>): string | undefined {
  if (trip.separationRules === undefined) return;
  if (!Array.isArray(trip.separationRules) || trip.separationRules.length > MAX_SEPARATION_RULES) return `Keep at most ${MAX_SEPARATION_RULES} separation rules.`;
  const ids = new Set<string>(), pairs = new Set<string>();
  for (const rule of trip.separationRules) {
    if (!rule || typeof rule !== 'object' || Object.keys(rule).some(key => !['id','firstEntryId','secondEntryId','kind','clearanceMm','note'].includes(key))
      || !text(rule.id) || ids.has(rule.id) || !text(rule.firstEntryId) || !text(rule.secondEntryId) || rule.firstEntryId === rule.secondEntryId
      || !['different_bags','different_compartments','clearance'].includes(rule.kind)) return 'Choose two distinct pack entries and a valid separation rule.';
    ids.add(rule.id);
    if ([rule.firstEntryId,rule.secondEntryId].some(id => trip.entries.filter(entry => entry.id === id).length !== 1)) return 'A separation rule refers to a missing or ambiguous pack entry. Correct the rule before planning.';
    const pair = JSON.stringify([rule.firstEntryId,rule.secondEntryId].sort());
    if (pairs.has(pair)) return 'Keep one separation rule for each pair of pack entries.';
    pairs.add(pair);
    if (rule.kind === 'clearance' ? typeof rule.clearanceMm !== 'number' || !Number.isFinite(rule.clearanceMm) || rule.clearanceMm <= 0 || rule.clearanceMm > 10000
      : rule.clearanceMm !== undefined) return 'Record a finite positive geometric gap up to 10,000 mm only for a clearance rule.';
    if (rule.note !== undefined && (typeof rule.note !== 'string' || rule.note.length > 500)) return 'Keep the separation note within 500 characters.';
  }
}
