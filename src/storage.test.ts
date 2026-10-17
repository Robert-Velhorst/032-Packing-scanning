import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspaceStorage } from './storage';
import type { ProtectedSession } from './protected-storage';

afterEach(() => vi.unstubAllGlobals());

describe('photo backup export', () => {
  it('limits concurrent photo encoding and preserves record order', async () => {
    let active = 0;
    let peak = 0;
    class TrackingFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
      onerror: ((this: FileReader, event: ProgressEvent<FileReader>) => unknown) | null = null;
      readAsDataURL(blob: Blob) {
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
  });
});
