import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLocalStep } from './reading';

vi.mock('./native', () => ({ nativeReadingAvailable: () => false }));
afterEach(() => vi.unstubAllGlobals());

describe('local spoken-step output', () => {
  it('never sends a step to a remote or default reading voice', async () => {
    const speechSynthesis = { getVoices: () => [{ localService: false, lang: 'en-US' }, { localService: true, lang: 'nl-NL' }], speak: vi.fn(), cancel: vi.fn() };
    vi.stubGlobal('window', { speechSynthesis });
    await expect(readLocalStep('Place the laptop in your bag.')).rejects.toThrow('No on-device English');
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
  });

  it('selects an installed local English voice even when a remote English voice comes first', async () => {
    const localVoice = { localService: true, lang: 'en-GB', name: 'Local English' };
    const speak = vi.fn((utterance) => utterance.onend());
    vi.stubGlobal('window', { speechSynthesis: { getVoices: () => [{ localService: false, lang: 'en-US' }, localVoice], speak, cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    await readLocalStep('Place the laptop in your bag.');
    expect(speak).toHaveBeenCalledOnce();
    expect(speak.mock.calls[0][0]).toMatchObject({ text: 'Place the laptop in your bag.', voice: localVoice, lang: 'en-GB' });
  });
});
