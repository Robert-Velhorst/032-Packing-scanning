export type PackingVoiceCommand = 'next' | 'back' | 'skip' | 'packed' | 'repeat' | 'lock' | 'does_not_fit' | 'unavailable' | 'confirm' | 'cancel' | 'stop';

const COMMANDS: Record<string, PackingVoiceCommand> = {
  next: 'next', back: 'back', previous: 'back', skip: 'skip', packed: 'packed', 'mark packed': 'packed',
  repeat: 'repeat', 'read step': 'repeat', 'lock placement': 'lock',
  'does not fit': 'does_not_fit', "doesn't fit": 'does_not_fit', 'item unavailable': 'unavailable',
  confirm: 'confirm', cancel: 'cancel', 'stop listening': 'stop',
};

/** Only a complete command with the spoken prefix can cause an action. */
export function parsePackingVoiceCommand(transcript: unknown, confidence: unknown): PackingVoiceCommand | undefined {
  if (typeof transcript !== 'string' || typeof confidence !== 'number' || !Number.isFinite(confidence)
    || confidence < 0.75 || confidence > 1) return undefined;
  const normal = transcript.toLowerCase().replace(/[.,!?;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normal.startsWith('packing ')) return undefined;
  return COMMANDS[normal.slice(8)];
}
