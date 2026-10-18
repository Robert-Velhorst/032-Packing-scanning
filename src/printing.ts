import { Capacitor, registerPlugin } from '@capacitor/core';
const PackingPrint = registerPlugin<{ printSequence(): Promise<void> }>('PackingPrint');
export const printingAvailable = () => !Capacitor.isNativePlatform() || Capacitor.isPluginAvailable('PackingPrint');

async function waitForSequencePhotos(sequence: Element): Promise<void> {
  const pending = () => sequence.querySelectorAll('.sequence-photo[data-photo-state="deferred"], .sequence-photo[data-photo-state="loading"]').length;
  if (!pending()) return;
  if (typeof MutationObserver === 'undefined') throw new Error('Photos are still loading. Try printing again.');
  await new Promise<void>((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => {
      if (pending()) return;
      if (timeout) clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error('One or more saved photos are still loading. Try printing again.'));
    }, 15000);
    observer.observe(sequence, { attributes: true, attributeFilter: ['data-photo-state'], subtree: true });
    if (!pending()) {
      if (timeout) clearTimeout(timeout);
      observer.disconnect();
      resolve();
    }
  });
}

/** Invoked only by the traveller's print button; never print on navigation or load. */
export async function printPackingSequence(): Promise<void> {
  const sequence = document.querySelector('.packing-sequence-page');
  if (!sequence) throw new Error('Open the packing sequence before printing.');
  if (document.hidden) throw new Error('Return to the packing sequence before printing.');
  await waitForSequencePhotos(sequence);
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('.packing-sequence-page img'));
  await Promise.all(images.map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('A photo is still loading. Try printing again.')); }, 5000);
    const cleanup = () => { clearTimeout(timeout); image.removeEventListener('load', done); image.removeEventListener('error', done); };
    const done = () => { cleanup(); resolve(); };
    image.addEventListener('load', done); image.addEventListener('error', done);
  })));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  if (document.hidden || !sequence.isConnected || document.querySelector('.packing-sequence-page') !== sequence) throw new Error('The sequence changed before printing. Open it and try again.');
  if (Capacitor.isPluginAvailable('PackingPrint')) await PackingPrint.printSequence();
  else if (!Capacitor.isNativePlatform()) window.print();
  else throw new Error('Printing is unavailable on this device. The sequence remains available offline.');
}
