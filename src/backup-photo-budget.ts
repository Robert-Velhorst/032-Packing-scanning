export interface PhotoExportRecord { id: string; blob: Blob; createdAt: string; }

export function estimatePhotoJsonEntryBytes(record: PhotoExportRecord) {
  const emptyPhoto = JSON.stringify({ id: record.id, createdAt: record.createdAt, dataUrl: '' }, null, 2);
  const dataUrlPrefix = `data:${record.blob.type};base64,`;
  // Account for nesting in the backup's photos array and the base64 expansion.
  return new Blob([emptyPhoto]).size + 20 + dataUrlPrefix.length + 4 * Math.ceil(record.blob.size / 3);
}

export function estimatePhotoArrayJsonBytesFromTotals(count: number, entryBytes: number) {
  return count ? count * 2 + 4 + entryBytes : 2;
}

export function estimatePhotoArrayJsonBytes(records: PhotoExportRecord[]) {
  let entryBytes = 0;
  for (const record of records) entryBytes += estimatePhotoJsonEntryBytes(record);
  return estimatePhotoArrayJsonBytesFromTotals(records.length, entryBytes);
}
