import type { AppData } from './types.ts';

export const SCAN_RETENTION_DAYS = [7, 30, 90] as const;
export type ScanRetentionDays = typeof SCAN_RETENTION_DAYS[number];
export interface ScanRetentionReply {
  version: 1; confirmedAt: string; removedIds: string[]; checkedCount: number;
  deletedCount: number; skippedCount: number; failedCount: number; nextCursor: string | null;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validScanRetentionDays(value: unknown): value is ScanRetentionDays | null | undefined {
  return value === undefined || value === null || SCAN_RETENTION_DAYS.some(days => days === value);
}
export function parseScanRetentionReply(value: unknown): ScanRetentionReply {
  const r = value as Partial<ScanRetentionReply> | null;
  if (!r || r.version !== 1 || typeof r.confirmedAt !== 'string' || !Number.isFinite(Date.parse(r.confirmedAt))
    || !Array.isArray(r.removedIds) || r.removedIds.length > 100 || r.removedIds.some(id => typeof id !== 'string' || !uuid.test(id)) || new Set(r.removedIds).size !== r.removedIds.length
    || ![r.checkedCount, r.deletedCount, r.skippedCount, r.failedCount].every(count => Number.isInteger(count) && count! >= 0 && count! <= 100)
    || r.removedIds.length + r.skippedCount! + r.failedCount! > r.checkedCount! || r.deletedCount! > r.removedIds.length
    || r.nextCursor !== null && (typeof r.nextCursor !== 'string' || !uuid.test(r.nextCursor))) throw Error('Raw scan cleanup returned an invalid confirmation. Saved planning records were not changed.');
  return r as ScanRetentionReply;
}
/** Change source availability only: geometry, measurements, photos and progress stay exact. */
export function recordRemovedScanSources(data: AppData, reply: ScanRetentionReply): AppData {
  const ids = new Set(reply.removedIds); let changed = false;
  function mark<T extends AppData['libraryItems'][number] | AppData['containers'][number]>(record: T): T {
    if (record.scan?.platform !== 'android' || !ids.has(record.scan.id) || record.scan.sourceRetention?.reason === 'raw_scan_retention') return record;
    changed = true;
    return { ...record, scan: { ...record.scan, modelStoredLocally: false, sourceRetention: { reason: 'raw_scan_retention', confirmedAt: reply.confirmedAt } } };
  }
  const libraryItems = data.libraryItems.map(mark), containers = data.containers.map(mark);
  return changed ? { ...data, libraryItems, containers } : data;
}
