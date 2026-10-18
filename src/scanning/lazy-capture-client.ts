import type { CaptureClient } from './native';

/** Keep native scanning code out of the web entry chunk until capture is used. */
export function captureClient(lease?: string): CaptureClient {
  let closed = false;
  let capturing = false;
  let client: Promise<CaptureClient> | undefined;
  const actual = () => client ??= import('./native').then(module => {
    const value = module.captureClient(lease);
    if (closed) value.revoke();
    return value;
  });
  const run = <T,>(action: (value: CaptureClient) => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(new Error('The capture workspace is locked or has changed.'));
    return actual().then(value => {
      if (closed) throw new Error('The capture workspace is locked or has changed.');
      return action(value);
    });
  };

  return {
    revoke: () => {
      closed = true;
      if (client) void client.then(value => value.revoke(), () => undefined);
    },
    isCapturing: () => capturing,
    touch: () => run(value => value.touch()),
    scanObject: async (target, recognize) => {
      if (closed) throw new Error('The capture workspace is locked or has changed.');
      capturing = true;
      try { return await run(value => value.scanObject(target, recognize)); }
      finally { capturing = false; }
    },
    deleteScanCapture: id => run(value => value.deleteScanCapture(id)),
    clearScanCaptures: () => run(value => value.clearScanCaptures()),
    pruneExpiredScanSources: (days, afterId) => run(value => value.pruneExpiredScanSources(days, afterId)),
    readSavedGeometry: record => run(value => value.readSavedGeometry(record)),
    reconstructSavedCapture: (record, source) => run(value => value.reconstructSavedCapture(record, source)),
    reconstructSavedInterior: (record, source, review) => run(value => value.reconstructSavedInterior(record, source, review)),
  };
}
