import { nativeReadingAvailable, readNativeStep, stopNativeReading } from './native';

export async function readLocalStep(text: string): Promise<void> {
  if (nativeReadingAvailable()) return readNativeStep(text);
  if (!('speechSynthesis' in window)) throw new Error('Spoken steps are unavailable. Follow the text on screen.');
  const voice = window.speechSynthesis.getVoices().find((candidate) => candidate.localService && /^en(?:-|$)/i.test(candidate.lang));
  if (!voice) throw new Error('No on-device English reading voice is installed. Follow the text, or install one in your device settings.');
  window.speechSynthesis.cancel();
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice; utterance.lang = voice.lang;
    utterance.onend = () => resolve();
    utterance.onerror = () => reject(new Error('Reading stopped. You can follow the step on screen.'));
    window.speechSynthesis.speak(utterance);
  });
}
export function stopReading(): void {
  if (nativeReadingAvailable()) { void stopNativeReading().catch(() => {}); return; }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}
