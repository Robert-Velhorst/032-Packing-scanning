import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { LocalVoiceDriver, VoiceAvailability, VoiceCallbacks } from './session';

interface NativePackingVoice {
  getAvailability(): Promise<VoiceAvailability>;
  listen(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<void>;
  installModel(): Promise<void>;
  readStep(options: { text: string }): Promise<void>;
  stopReading(): Promise<void>;
  addListener(event: 'voiceEvent', callback: (event: { id: string; kind: string; transcript?: string; confidence?: number; message?: string; recoverable?: boolean }) => void): Promise<PluginListenerHandle>;
}
const PackingVoice = registerPlugin<NativePackingVoice>('PackingVoice');

export const nativeReadingAvailable = () => Capacitor.isPluginAvailable('PackingVoice');
export const readNativeStep = (text: string) => PackingVoice.readStep({ text });
export const stopNativeReading = () => PackingVoice.stopReading();

export function nativeVoiceDriver(): LocalVoiceDriver | undefined {
  if (!Capacitor.isPluginAvailable('PackingVoice')) return undefined;
  return {
    availability: () => PackingVoice.getAvailability(),
    listen(callbacks: VoiceCallbacks) {
      const id = crypto.randomUUID();
      let cancelled = false;
      let listener: PluginListenerHandle | undefined;
      const cleanup = () => { void listener?.remove(); listener = undefined; };
      const started = (async () => {
        listener = await PackingVoice.addListener('voiceEvent', (event) => {
          if (cancelled || event.id !== id) return;
          if (event.kind === 'ready') callbacks.ready();
          if (event.kind === 'result') callbacks.result({ transcript: event.transcript ?? '', confidence: event.confidence ?? 0, final: true });
          if (event.kind === 'error') callbacks.error(event.message ?? 'Voice recognition stopped.', event.recoverable);
          if (event.kind === 'end') callbacks.end();
        });
        if (cancelled) { cleanup(); return; }
        await PackingVoice.listen({ id });
        if (cancelled) await PackingVoice.stop({ id });
      })().catch((error: unknown) => { cleanup(); throw error; });
      return { started, abort: () => { cancelled = true; cleanup(); void PackingVoice.stop({ id }).catch(() => { /* Native lifecycle cleanup also stops the recognizer. */ }); } };
    },
    install: async () => { await PackingVoice.installModel(); return true; },
  };
}
