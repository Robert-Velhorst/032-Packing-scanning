import { useEffect, useRef, useState } from 'react';
import { browserVoiceDriver, type RecognitionConstructor } from './browser';
import { nativeVoiceDriver } from './native';
import { PackingVoiceSession, type LocalVoiceDriver, type VoiceState } from './session';
import type { PackingVoiceCommand } from './commands';

export function usePackingVoice(context: string, onCommand: (command: PackingVoiceCommand) => void, authorizeCommand: () => Promise<void>) {
  const callbacks = useRef({ context, onCommand, authorizeCommand });
  callbacks.current = { context, onCommand, authorizeCommand };
  const [state, setState] = useState<VoiceState>({ phase: 'off', message: 'Microphone off. Voice is optional.' });
  const [installing, setInstalling] = useState(false);
  const driver = useRef<LocalVoiceDriver | undefined>(undefined);
  const session = useRef<PackingVoiceSession | undefined>(undefined);
  useEffect(() => {
    const host = window as Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    driver.current = nativeVoiceDriver() ?? browserVoiceDriver(host.SpeechRecognition ?? host.webkitSpeechRecognition, window.isSecureContext);
    const active = new PackingVoiceSession(driver.current, () => callbacks.current.context, (command) => callbacks.current.onCommand(command), setState, () => callbacks.current.authorizeCommand());
    session.current = active;
    const hidden = () => { if (document.hidden) active.stop(); };
    const leaving = () => active.stop();
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', leaving);
    return () => {
      active.stop(false); session.current = undefined;
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', leaving);
    };
  }, []);
  useEffect(() => { session.current?.contextChanged(); }, [context]);
  const enabled = ['checking', 'starting', 'listening', 'waiting'].includes(state.phase);
  return {
    state, enabled, installing,
    enable: () => { if (!document.hidden) void session.current?.enable(); },
    stop: () => session.current?.stop(), pause: () => session.current?.pause(), resume: () => session.current?.resume(),
    install: async () => {
      if (!driver.current?.install || installing) return;
      setInstalling(true);
      try {
        const installed = await driver.current.install();
        setState({ phase: 'off', message: installed ? 'Speech model download requested. Once it finishes, enable voice.' : 'The speech model could not be installed. Use touch controls or try again.' });
      } catch { setState({ phase: 'error', message: 'The speech model could not be downloaded. Use the touch controls.' }); }
      finally { setInstalling(false); }
    },
  };
}
