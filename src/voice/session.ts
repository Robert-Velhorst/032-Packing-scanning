import { parsePackingVoiceCommand, type PackingVoiceCommand } from './commands';

export interface VoiceAvailability { available: boolean; message: string; downloadable?: boolean }
export interface VoiceResult { transcript: string; confidence: number; final: boolean }
export interface VoiceCallbacks {
  ready: () => void;
  result: (result: VoiceResult) => void;
  error: (message: string, recoverable?: boolean) => void;
  end: () => void;
}
export interface LocalVoiceDriver {
  availability(): Promise<VoiceAvailability>;
  listen(callbacks: VoiceCallbacks): { abort: () => void; started?: Promise<void> };
  install?(): Promise<boolean>;
}
export interface VoiceState { phase: 'off' | 'checking' | 'starting' | 'listening' | 'waiting' | 'unavailable' | 'error'; message: string; downloadable?: boolean }

/** User-started, foreground-only command sessions. No transcripts/audio are retained. */
export class PackingVoiceSession {
  private wanted = false;
  private paused = false;
  private prepared = false;
  private generation = 0;
  private abort?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private driver: LocalVoiceDriver, private context: () => string,
    private command: (command: PackingVoiceCommand) => void, private state: (state: VoiceState) => void,
    private authorizeCommand?: () => Promise<void>) {}

  async enable(): Promise<void> {
    this.stop(false);
    this.wanted = true;
    const generation = this.generation;
    this.state({ phase: 'checking', message: 'Checking on-device English voice support…' });
    try {
      const support = await this.driver.availability();
      if (!this.wanted || generation !== this.generation) return;
      if (!support.available) {
        this.wanted = false;
        this.state({ phase: 'unavailable', message: support.message, downloadable: support.downloadable });
        return;
      }
      this.prepared = true;
      this.resetIdleTimer();
      await this.open();
    } catch {
      if (generation === this.generation && this.wanted) this.fail('Voice support could not be checked. Use the touch controls or try again.');
    }
  }

  stop(announce = true): void {
    this.wanted = false;
    this.paused = false;
    this.prepared = false;
    this.invalidate();
    clearTimeout(this.idleTimer);
    if (announce) this.state({ phase: 'off', message: 'Microphone off. Touch controls remain available.' });
  }

  /** Changing a step must discard in-flight words about the previous item. */
  contextChanged(): void {
    if (!this.wanted || !this.prepared) return;
    this.invalidate();
    if (!this.paused) this.schedule();
  }

  pause(): void {
    if (!this.wanted) return;
    this.paused = true;
    if (this.prepared) this.invalidate();
    this.state({ phase: 'waiting', message: 'Microphone paused while the step is read aloud.' });
  }
  resume(): void { if (this.wanted && this.paused) { this.paused = false; this.schedule(); } }

  private invalidate(): void {
    this.generation++;
    clearTimeout(this.timer);
    const abort = this.abort; this.abort = undefined;
    try { abort?.(); } catch { /* Cancellation remains terminal; stale callbacks are ignored. */ }
  }
  private resetIdleTimer(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.stop(false); this.state({ phase: 'off', message: 'Microphone off after five minutes without a recognised command. Enable voice to continue.' }); }, 5 * 60 * 1000);
  }
  private fail(message: string): void { this.stop(false); this.state({ phase: 'error', message }); }
  private async dispatch(command: PackingVoiceCommand, generation: number, context: string): Promise<void> {
    const current=()=>this.wanted&&!this.paused&&generation===this.generation&&context===this.context();
    this.state({phase:'waiting',message:'Checking the active packing workspace…'});
    try{
      await this.authorizeCommand!();
      if(!current())return;
      this.resetIdleTimer();this.command(command);this.schedule();
    }catch{if(current())this.fail('The packing workspace could not accept this command. Unlock it if needed, then enable voice again.');}
  }
  private schedule(): void {
    if (!this.wanted || this.paused || !this.prepared) return;
    const generation = this.generation;
    this.state({ phase: 'waiting', message: 'Voice enabled. Preparing the next command…' });
    this.timer = setTimeout(() => { if (generation === this.generation) void this.open(); }, 900);
  }
  private async open(): Promise<void> {
    if (!this.wanted || this.paused || !this.prepared) return;
    const generation = ++this.generation;
    const context = this.context();
    let finished = false;
    const current = () => this.wanted && !this.paused && generation === this.generation && context === this.context();
    this.state({ phase: 'starting', message: 'Starting on-device listening. Your device may ask for microphone permission.' });
    const finish = () => {
      if (finished || !current()) return;
      finished = true; this.invalidate(); this.schedule();
    };
    try {
      const listening = this.driver.listen({
        ready: () => { if (current()) this.state({ phase: 'listening', message: 'Listening on this device. Begin each command with “Packing”.' }); },
        result: (result) => {
          if (!current() || finished || !result.final) return;
          const command = parsePackingVoiceCommand(result.transcript, result.confidence);
          if (!command) { this.state({ phase: 'listening', message: 'Command unclear. Try “Packing, next”, or use the touch controls.' }); return; }
          finished = true;
          this.invalidate();
          if (command === 'stop') { this.stop(); return; }
          if(this.authorizeCommand){void this.dispatch(command,this.generation,context);return;}
          this.resetIdleTimer();
          this.command(command);
          this.schedule();
        },
        error: (message, recoverable) => { if (!current() || finished) return; if (recoverable) finish(); else this.fail(message); },
        end: finish,
      });
      if (!current() || finished) listening.abort(); else this.abort = listening.abort;
      await listening.started;
    } catch { if (current()) this.fail('Listening could not start. Check microphone permission or use the touch controls.'); }
  }
}
