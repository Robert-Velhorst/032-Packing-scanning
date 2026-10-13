import {beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({native:true,platform:'android',available:true,bridge:{pickBackup:vi.fn(),saveBackup:vi.fn(),readBackup:vi.fn(),discardBackup:vi.fn()}}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>fixture.native,getPlatform:()=>fixture.platform,isPluginAvailable:()=>fixture.available},registerPlugin:()=>fixture.bridge}));
import {nativeBackupFilesAvailable,pickNativeBackup,saveNativeBackup,readNativeBackup,discardNativeBackup} from './native-files';
const lease='11111111-1111-4111-8111-111111111111',ticket='22222222-2222-4222-8222-222222222222',target='33333333-3333-4333-8333-333333333333';
beforeEach(()=>{vi.resetAllMocks();fixture.native=true;fixture.platform='android';fixture.available=true;});
describe('native backup boundary',()=>{
  it('requires Android native files and a current lease without browser fallback',async()=>{
    for(const configure of [()=>{fixture.native=false;},()=>{fixture.platform='ios';},()=>{fixture.available=false;}]){configure();expect(nativeBackupFilesAvailable()).toBe(false);await expect(pickNativeBackup(lease)).rejects.toThrow(/Unlock/);fixture.native=true;fixture.platform='android';fixture.available=true;}
    await expect(pickNativeBackup()).rejects.toThrow(/Unlock/);expect(fixture.bridge.pickBackup).not.toHaveBeenCalled();
  });
  it('keeps cancellation separate from confirmed selections and refuses malformed replies',async()=>{
    fixture.bridge.pickBackup.mockResolvedValueOnce({selected:false});expect(await pickNativeBackup(lease)).toBeUndefined();
    fixture.bridge.pickBackup.mockResolvedValueOnce({selected:true,ticket,target});expect(await pickNativeBackup(lease)).toEqual({ticket,target});
    fixture.bridge.pickBackup.mockResolvedValueOnce({selected:true,ticket,target:'other-folder'});await expect(pickNativeBackup(lease)).rejects.toThrow(/invalid/);
    fixture.bridge.pickBackup.mockRejectedValueOnce(Error('provider closed'));await expect(pickNativeBackup(lease)).rejects.toThrow('provider closed');
  });
  it('requires actual save confirmation and reports native failure instead of claiming download',async()=>{
    fixture.bridge.saveBackup.mockResolvedValueOnce({saved:false}).mockResolvedValueOnce({saved:true}).mockResolvedValueOnce({});
    expect(await saveNativeBackup('{}',lease)).toBe(false);expect(await saveNativeBackup('{}',lease)).toBe(true);await expect(saveNativeBackup('{}',lease)).rejects.toThrow(/not confirmed/);
    fixture.bridge.saveBackup.mockRejectedValueOnce(Error('partial destination'));await expect(saveNativeBackup('{}',lease)).rejects.toThrow('partial destination');
  });
  it('binds review to the fresh lease and exact ticket, and never uses a returned path or URL',async()=>{
    fixture.bridge.readBackup.mockResolvedValue({text:'{"format":"packing-scanning-backup"}'});
    const selected={ticket,target},file=await readNativeBackup(selected,lease);expect(await file.text()).toContain('packing-scanning-backup');expect(fixture.bridge.readBackup).toHaveBeenCalledWith({lease,ticket});
    fixture.bridge.readBackup.mockResolvedValue({url:'https://private.example/backup'});await expect(readNativeBackup(selected,lease)).rejects.toThrow(/cannot be opened/);
    fixture.bridge.discardBackup.mockResolvedValue(undefined);await discardNativeBackup(selected);expect(fixture.bridge.discardBackup).toHaveBeenCalledWith({ticket});
  });
});
