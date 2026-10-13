import type { LocalVoiceDriver, VoiceCallbacks } from './session';

interface Recognition {
  processLocally: boolean; lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string; confidence: number } }> }) => void) | null;
  start(): void; abort(): void;
}
export interface RecognitionConstructor {
  new(): Recognition;
  prototype: Recognition;
  available?(options: { langs: string[]; processLocally: boolean }): Promise<string>;
  install?(options: { langs: string[]; processLocally: boolean }): Promise<boolean>;
}

export function browserVoiceDriver(recognition: RecognitionConstructor | undefined, secure = true): LocalVoiceDriver {
  const local = secure && !!recognition && 'processLocally' in recognition.prototype && typeof recognition.available === 'function';
  const options = { langs: ['en-US'], processLocally: true };
  return {
    async availability() {
      if (!local) return { available: false, message: 'This browser cannot require on-device voice recognition. Use touch controls or a supported device.' };
      const result = await recognition!.available!(options);
      return { available: result === 'available', downloadable: result === 'downloadable' && typeof recognition!.install === 'function',
        message: result === 'downloadable' ? 'The on-device English speech model is not installed. You can download it below, then enable voice.'
          : result === 'downloading' ? 'The English speech model is downloading. Try voice again once it finishes.'
          : result === 'available' ? 'On-device English recognition is available.' : 'On-device English recognition is unavailable. Use the touch controls.' };
    },
    listen(callbacks: VoiceCallbacks) {
      if (!local) throw new Error('On-device recognition unavailable');
      const instance = new recognition!();
      instance.processLocally = true;
      if (instance.processLocally !== true) throw new Error('Local recognition requirement rejected');
      instance.lang = 'en-US'; instance.continuous = false; instance.interimResults = false; instance.maxAlternatives = 1;
      instance.onstart = callbacks.ready;
      instance.onend = callbacks.end;
      instance.onresult = (event) => {
        const result = event.results[event.resultIndex];
        if (result?.[0]) callbacks.result({ ...result[0], final: result.isFinal });
      };
      instance.onerror = (event) => callbacks.error(event.error === 'not-allowed' ? 'Microphone permission was denied. Allow it in device or browser settings, then enable voice again.'
        : event.error === 'language-not-supported' ? 'The on-device English speech model is unavailable. Use touch controls.'
        : 'Voice recognition stopped. Use touch controls or enable voice again.', event.error === 'no-speech');
      instance.start();
      return { abort: () => { instance.onstart = instance.onend = instance.onresult = instance.onerror = null; instance.abort(); } };
    },
    ...(local && typeof recognition!.install === 'function' ? { install: () => recognition!.install!(options) } : {}),
  };
}
