import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceStorage } from './storage';
import type { ProtectedSession } from './protected-storage';
import { assembleBackupJson, prepareBackupJson } from './backup';
import { createInitialData } from './seed';

afterEach(() => vi.unstubAllGlobals());

describe('photo backup export', () => {
  it('assembles the same readable backup JSON while budgeting photos before conversion', () => {
    const app = createInitialData(), exportedAt = '2026-10-17T00:00:00.000Z';
    const photos = [{ id: 'item-photo', dataUrl: 'data:image/png;base64,AP8=', createdAt: exportedAt }];
    const parts = prepareBackupJson(app, exportedAt);
    const actual = assembleBackupJson(parts, photos);
    const expected = JSON.stringify({ format: 'packing-scanning-backup', schemaVersion: app.schemaVersion, exportedAt, app, photos }, null, 2);
    const embeddedPhotos = JSON.stringify(photos, null, 2).replace(/\n/g, '\n  ');

    expect(actual).toBe(expected);
    expect(new Blob([parts.prefix, parts.suffix]).size).toBe(parts.bytesWithoutPhotos);
    expect(new Blob([actual]).size).toBe(parts.bytesWithoutPhotos + new Blob([embeddedPhotos]).size);
    expect(JSON.parse(actual)).toEqual({ format: 'packing-scanning-backup', schemaVersion: app.schemaVersion, exportedAt, app, photos });
  });

  it('limits concurrent photo encoding and preserves record order', async () => {
    let active = 0;
    let peak = 0;
    let readCount = 0;
    class TrackingFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
      readAsDataURL(blob: Blob) {
        readCount += 1;
        active += 1;
        peak = Math.max(peak, active);
        void blob.arrayBuffer().then((buffer) => new Promise<void>((resolve) => setTimeout(() => {
          const bytes = new Uint8Array(buffer);
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          this.result = `data:${blob.type};base64,${btoa(binary)}`;
          active -= 1;
          this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
          resolve();
        }, 0)));
      }
    }
    vi.stubGlobal('FileReader', TrackingFileReader);
    const records = Array.from({ length: 5 }, (_, index) => ({
      id: `photo-${index}`,
      blob: new Blob([new Uint8Array([index, 255])], { type: 'image/png' }),
      createdAt: `2026-10-17T00:00:0${index}.000Z`,
    }));
    const session = { photos: vi.fn().mockResolvedValue(records) } as unknown as ProtectedSession;

    const exported = await workspaceStorage(session).exportPhotos();

    expect(peak).toBe(2);
    expect(exported.map((photo) => photo.id)).toEqual(records.map((photo) => photo.id));
    expect(exported[0].dataUrl).toBe('data:image/png;base64,AP8=');
    expect(exported[4].createdAt).toBe(records[4].createdAt);
    const embeddedJson = JSON.stringify(exported, null, 2).replace(/\n/g, '\n  ');
    const exactBudget = new Blob([embeddedJson]).size;
    const readsBeforeExactBudget = readCount;
    await expect(workspaceStorage(session).exportPhotos(exactBudget)).resolves.toHaveLength(records.length);
    expect(readCount).toBe(readsBeforeExactBudget + records.length);
    const readsBeforeSmallBudget = readCount;
    await expect(workspaceStorage(session).exportPhotos(exactBudget - 1)).rejects.toThrow('This backup is over 80 MB.');
    expect(readCount).toBe(readsBeforeSmallBudget);
    await expect(workspaceStorage(session).exportPhotos(0)).rejects.toThrow('This backup is over 80 MB.');
    expect(readCount).toBe(readsBeforeSmallBudget);
  });
});
