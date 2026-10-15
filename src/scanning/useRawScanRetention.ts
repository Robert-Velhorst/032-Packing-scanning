import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import type { AppData } from '../types';
import type { ScanRetentionDays, ScanRetentionReply } from '../scan-retention';
import type { CaptureClient } from './native';

export function useRawScanRetention({ data, savedData, capture, deferred, checkAvailability, onRemoved }: { data?: AppData; savedData?: AppData; capture: CaptureClient; deferred: boolean; checkAvailability: boolean; onRemoved: (reply: ScanRetentionReply) => void }) {
  const [supported, setSupported] = useState(false), [status, setStatus] = useState('Checking raw scan cleanup availability…');
  const cursor = useRef<string | null>(null), running = useRef(false), lastPolicy = useRef<number | null>(null);
  const days = data?.settings.automaticScanDeletionDays ?? null, saved = !!data && data === savedData;
  useEffect(() => {
    if (!checkAvailability) return;
    let active = true;
    const unavailable='Automatic raw scan cleanup is available on supported Android installations. This device cannot remove their native source files.';
    if(!Capacitor.isNativePlatform()||Capacitor.getPlatform()!=='android'){setSupported(false);setStatus(unavailable);return()=>{active=false;};}
    import('./native').then(({getScanRetentionCapabilities})=>getScanRetentionCapabilities()).then(value => { if (active) { setSupported(value); setStatus(value ? 'Original scans are kept until you choose a deletion policy.' : unavailable); } }).catch(() => { if (active) setStatus('Raw scan cleanup availability could not be checked. Sources are retained; reopen this workspace to retry.'); });
    return () => { active = false; };
  }, [capture, checkAvailability]);
  useEffect(() => {
    if (days !== lastPolicy.current) { cursor.current = null; lastPolicy.current = days; }
    if (!supported) return;
    if (days === null) { setStatus('Automatic raw scan deletion is off. Previously removed sources cannot be recovered from a packing backup.'); return; }
    if (!saved || deferred) { setStatus('Raw scan cleanup waits for saved records and for open editors or file drafts to close.'); return; }
    let active = true;
    async function sweep() {
      if (!active || running.current || document.visibilityState !== 'visible' || capture.isCapturing()) return;
      running.current = true;
      let deleted = 0, skipped = 0, failed = 0;
      try {
        for (let batch = 0; batch < 5; batch++) {
          const reply = await capture.pruneExpiredScanSources(days as ScanRetentionDays, cursor.current ?? undefined);
          if (!active) return;
          cursor.current = reply.nextCursor;
          deleted += reply.deletedCount; skipped += reply.skippedCount; failed += reply.failedCount;
          onRemoved(reply);
          if (!reply.nextCursor || document.visibilityState !== 'visible' || capture.isCapturing()) break;
        }
        if (active) setStatus(`Raw scan age checked on this device. ${deleted} original ${deleted === 1 ? 'source removed' : 'sources removed'}.${skipped ? ` ${skipped} incomplete, invalid or future-dated sources were kept for manual review.` : ''}${failed ? ` ${failed} removals could not be confirmed; cleanup will retry.` : ''}${cursor.current ? ' More sources will be checked on the next pass.' : ''} Measurements, adopted geometry, photos and packed progress remain saved.`);
      } catch { if (active) setStatus('Raw scan cleanup could not finish. It will retry while this workspace is unlocked and visible. Saved planning geometry is retained.'); }
      finally { running.current = false; }
    }
    void sweep();
    let interval: number | undefined;
    const startInterval = () => {
      if (interval === undefined) interval = window.setInterval(() => void sweep(), 60000);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === 'visible') {
        void sweep();
        startInterval();
      } else if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    if (document.visibilityState === 'visible') startInterval();
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      active = false;
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, [supported, days, saved, deferred, capture, onRemoved]);
  return { supported, status };
}
