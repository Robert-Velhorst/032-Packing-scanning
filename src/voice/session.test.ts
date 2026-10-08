import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePackingVoiceCommand } from './commands';
import { PackingVoiceSession, type LocalVoiceDriver, type VoiceCallbacks, type VoiceState } from './session';

const sessions: PackingVoiceSession[] = [];
afterEach(() => { sessions.splice(0).forEach((session) => session.stop(false)); vi.useRealTimers(); });
function fixture(authorize?:()=>Promise<void>) {
  const calls: VoiceCallbacks[] = [], commands: string[] = [], states: VoiceState[] = [];
  let context = 'item-1';
  const abort = vi.fn();
  const driver: LocalVoiceDriver = { availability: vi.fn(async () => ({ available: true, message: 'ready' })), listen: vi.fn((callbacks) => { calls.push(callbacks); return { abort }; }) };
  const session = new PackingVoiceSession(driver, () => context, (command) => commands.push(command), (state) => states.push(state), authorize);
  sessions.push(session);
  return { session, driver, calls, commands, states, abort, context: (value: string) => { context = value; } };
}

describe('English packing command parser', () => {
  it('recognises only a complete command with the spoken prefix', () => {
    expect(parsePackingVoiceCommand('Packing, next!', 0.9)).toBe('next');
    expect(parsePackingVoiceCommand(' PACKING  item unavailable. ', 1)).toBe('unavailable');
    expect(parsePackingVoiceCommand("packing doesn't fit", 0.8)).toBe('does_not_fit');
    expect(parsePackingVoiceCommand('packing mark packed', 0.75)).toBe('packed');
    for (const transcript of ['next', 'do not packing next', 'packing next and packed', 'packing never mark packed', 'packing does not fit my other bag']) expect(parsePackingVoiceCommand(transcript, 1)).toBeUndefined();
    for (const confidence of [undefined, 0, 0.74, -1, NaN, Infinity, 2]) expect(parsePackingVoiceCommand('packing packed', confidence)).toBeUndefined();
  });
});

describe('opt-in local speech sessions', () => {
  it('does not listen until explicitly enabled and does not start without the local model', async () => {
    const f = fixture(); expect(f.driver.listen).not.toHaveBeenCalled();
    f.driver.availability = async () => ({ available: false, downloadable: true, message: 'Download needed' });
    await f.session.enable(); expect(f.driver.listen).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toMatchObject({ phase: 'unavailable', downloadable: true });
  });

  it('cancels an asynchronous support check without later starting the microphone', async () => {
    const f = fixture(); let resolve!: (value: { available: boolean; message: string }) => void;
    f.driver.availability = () => new Promise((done) => { resolve = done; });
    const enabling = f.session.enable(); f.session.stop(); resolve({ available: true, message: 'ready' });
    await enabling; expect(f.driver.listen).not.toHaveBeenCalled(); expect(f.states.at(-1)?.phase).toBe('off');
  });

  it('ignores interim, uncertain, duplicate and late results', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.enable();
    const callback = f.calls[0];
    callback.result({ transcript: 'packing packed', confidence: 1, final: false });
    callback.result({ transcript: 'packing packed', confidence: 0.2, final: true });
    expect(f.commands).toEqual([]);
    callback.result({ transcript: 'packing packed', confidence: 0.9, final: true });
    callback.result({ transcript: 'packing packed', confidence: 0.9, final: true }); callback.end();
    expect(f.commands).toEqual(['packed']); expect(f.abort).toHaveBeenCalledOnce();
    f.session.stop(); await vi.advanceTimersByTimeAsync(1000); expect(f.calls).toHaveLength(1);
  });

  it('cannot bypass a pending local-model check when the user changes steps', async () => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (value: { available: boolean; message: string }) => void;
    f.driver.availability = () => new Promise((done) => { resolve = done; });
    const enabling = f.session.enable(); f.context('item-2'); f.session.contextChanged();
    await vi.advanceTimersByTimeAsync(2000); expect(f.driver.listen).not.toHaveBeenCalled();
    resolve({ available: false, message: 'Model missing' }); await enabling;
    expect(f.driver.listen).not.toHaveBeenCalled(); expect(f.states.at(-1)?.phase).toBe('unavailable');
  });

  it('can read a step while the model check is pending without prematurely starting listening', async () => {
    vi.useFakeTimers(); const f = fixture(); let resolve!: (value: { available: boolean; message: string }) => void;
    f.driver.availability = () => new Promise((done) => { resolve = done; });
    const enabling = f.session.enable(); f.session.pause(); resolve({ available: true, message: 'ready' }); await enabling;
    expect(f.driver.listen).not.toHaveBeenCalled(); f.session.resume(); await vi.advanceTimersByTimeAsync(900);
    expect(f.calls).toHaveLength(1);
  });

  it('discards words about the old step and restarts with the new context', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.enable(); const old = f.calls[0];
    f.context('item-2'); f.session.contextChanged(); old.result({ transcript: 'packing item unavailable', confidence: 1, final: true });
    expect(f.commands).toEqual([]); await vi.advanceTimersByTimeAsync(900);
    expect(f.calls).toHaveLength(2); f.calls[1].result({ transcript: 'packing next', confidence: 1, final: true }); expect(f.commands).toEqual(['next']);
  });

  it('pauses during spoken instructions and rejects playback feedback', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.enable(); const before = f.calls[0]; f.session.pause();
    before.result({ transcript: 'packing next', confidence: 1, final: true });
    await vi.advanceTimersByTimeAsync(2000); expect(f.calls).toHaveLength(1); expect(f.commands).toEqual([]);
    f.session.resume(); await vi.advanceTimersByTimeAsync(900); expect(f.calls).toHaveLength(2);
  });

  it('stops on permission errors without automatically retrying', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.enable(); f.calls[0].error('Permission denied');
    await vi.advanceTimersByTimeAsync(2000); expect(f.calls).toHaveLength(1); expect(f.states.at(-1)?.phase).toBe('error');
  });

  it('handles recoverable silence but stops after five minutes without a command', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.enable(); f.calls[0].error('Silence', true);
    await vi.advanceTimersByTimeAsync(900); expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000); expect(f.states.at(-1)?.phase).toBe('off');
    expect(f.states.at(-1)?.message).toContain('five minutes');
  });

  it('can cancel while the native permission/start promise is pending', async () => {
    const f = fixture(); let resolve!: () => void;
    f.driver.listen = vi.fn((callbacks) => { f.calls.push(callbacks); return { abort: f.abort, started: new Promise<void>((done) => { resolve = done; }) }; });
    const enabling = f.session.enable(); await Promise.resolve(); f.session.stop();
    expect(f.abort).toHaveBeenCalledOnce(); resolve(); await enabling;
    f.calls[0].ready(); f.calls[0].result({ transcript: 'packing packed', confidence: 1, final: true }); expect(f.commands).toEqual([]);
  });

  it('obeys the spoken stop command and never dispatches it as a packing change', async () => {
    vi.useFakeTimers(); const f = fixture(); await f.session.enable();
    f.calls[0].result({ transcript: 'packing stop listening', confidence: 1, final: true });
    await vi.advanceTimersByTimeAsync(1000); expect(f.commands).toEqual([]); expect(f.calls).toHaveLength(1); expect(f.states.at(-1)?.phase).toBe('off');
  });

  it('waits for live workspace authority and accepts a recognised result only once', async()=>{
    vi.useFakeTimers();let resolve!:()=>void;const authorize=vi.fn(()=>new Promise<void>(done=>{resolve=done;}));
    const f=fixture(authorize);await f.session.enable();const callback=f.calls[0];
    callback.result({transcript:'packing packed',confidence:1,final:true});
    callback.result({transcript:'packing packed',confidence:1,final:true});callback.end();
    expect(authorize).toHaveBeenCalledOnce();expect(f.commands).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);expect(f.calls).toHaveLength(1);
    resolve();await Promise.resolve();expect(f.commands).toEqual(['packed']);
    await vi.advanceTimersByTimeAsync(900);expect(f.calls).toHaveLength(2);
  });

  it('ignores partial or unclear speech without renewing workspace authority',async()=>{
    const authorize=vi.fn(async()=>{}),f=fixture(authorize);await f.session.enable();
    for(const result of [{transcript:'packing packed',confidence:1,final:false},{transcript:'packing packed',confidence:.74,final:true},{transcript:'next',confidence:1,final:true}])f.calls[0].result(result);
    expect(authorize).not.toHaveBeenCalled();expect(f.commands).toEqual([]);
    f.calls[0].result({transcript:'packing stop listening',confidence:1,final:true});
    expect(authorize).not.toHaveBeenCalled();expect(f.states.at(-1)?.phase).toBe('off');
  });

  it('refuses a command and stops listening when workspace renewal fails',async()=>{
    vi.useFakeTimers();const f=fixture(async()=>{throw Error('Native scope expired');});await f.session.enable();
    f.calls[0].result({transcript:'packing packed',confidence:1,final:true});await Promise.resolve();
    expect(f.commands).toEqual([]);expect(f.states.at(-1)).toMatchObject({phase:'error'});
    await vi.advanceTimersByTimeAsync(2000);expect(f.calls).toHaveLength(1);
  });

  it.each(['stop','context','pause','idle'] as const)('discards delayed workspace approval after %s',async(reason)=>{
    vi.useFakeTimers();let resolve!:()=>void;const f=fixture(()=>new Promise<void>(done=>{resolve=done;}));await f.session.enable();
    f.calls[0].result({transcript:'packing item unavailable',confidence:1,final:true});
    if(reason==='stop')f.session.stop();
    if(reason==='context'){f.context('item-2');f.session.contextChanged();}
    if(reason==='pause')f.session.pause();
    if(reason==='idle')await vi.advanceTimersByTimeAsync(5*60*1000);
    resolve();await Promise.resolve();expect(f.commands).toEqual([]);
  });

  it('renews command idleness only after workspace approval succeeds',async()=>{
    vi.useFakeTimers();let resolve!:()=>void;const f=fixture(()=>new Promise<void>(done=>{resolve=done;}));await f.session.enable();
    await vi.advanceTimersByTimeAsync(240000);f.calls[0].result({transcript:'packing next',confidence:1,final:true});
    await vi.advanceTimersByTimeAsync(30000);resolve();await Promise.resolve();expect(f.commands).toEqual(['next']);
    await vi.advanceTimersByTimeAsync(60000);expect(f.states.at(-1)?.phase).not.toBe('off');
    await vi.advanceTimersByTimeAsync(240000);expect(f.states.at(-1)?.phase).toBe('off');
  });
});
