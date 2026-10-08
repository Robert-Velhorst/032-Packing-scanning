import {beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({bridge:{getRetentionCapabilities:vi.fn(),pruneExpiredSources:vi.fn(),getStorageState:vi.fn(),openWorkspaceStorage:vi.fn(),deleteCapture:vi.fn(),clearCaptures:vi.fn(),touchStorage:vi.fn(),getCapabilities:vi.fn(),scanObject:vi.fn()},native:true,platform:'android'}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>fixture.native,getPlatform:()=>fixture.platform,isPluginAvailable:()=>true},registerPlugin:()=>fixture.bridge}));
import {captureClient,getCaptureStorageState,openCaptureWorkspace,getScanRetentionCapabilities} from './native';
const old='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.resetAllMocks();fixture.native=true;fixture.platform='android';fixture.bridge.deleteCapture.mockResolvedValue({deleted:true});fixture.bridge.clearCaptures.mockResolvedValue({deleted:1});fixture.bridge.getCapabilities.mockResolvedValue({supported:true,platform:'android'});});
describe('native workspace boundary',()=>{
  it('requires a valid handshake and does not silently fall back after native failure',async()=>{
    fixture.bridge.getStorageState.mockResolvedValue({version:1,revision:old,lease:null,protectedWorkspace:false});expect((await getCaptureStorageState())?.lease).toBeNull();
    fixture.bridge.getStorageState.mockResolvedValue({version:1,revision:old});await expect(getCaptureStorageState()).rejects.toThrow(/invalid/);
    fixture.bridge.getStorageState.mockRejectedValue(new Error('offline native bridge'));await expect(getCaptureStorageState()).rejects.toThrow(/offline/);
    fixture.bridge.getStorageState.mockRejectedValue({code:'UNIMPLEMENTED'});expect(await getCaptureStorageState()).toBeUndefined();
    fixture.platform='ios';expect(await getCaptureStorageState()).toBeUndefined();fixture.native=false;expect(await getCaptureStorageState()).toBeUndefined();
  });
  it('borrows key bytes only for the bridge call and erases that temporary array on success and failure',async()=>{
    const key=new Uint8Array(32).fill(7);fixture.bridge.openWorkspaceStorage.mockResolvedValue({version:1,revision:next,lease:next,protectedWorkspace:true});
    expect((await openCaptureWorkspace(old,old,next,key)).lease).toBe(next);
    expect(fixture.bridge.openWorkspaceStorage.mock.calls[0][0].keyBytes).toEqual(Array(32).fill(0));expect([...key]).toEqual(Array(32).fill(7));
    fixture.bridge.openWorkspaceStorage.mockRejectedValue(new Error('refused'));await expect(openCaptureWorkspace(old,old,next,key)).rejects.toThrow(/refused/);expect(fixture.bridge.openWorkspaceStorage.mock.calls[1][0].keyBytes).toEqual(Array(32).fill(0));
  });
  it('retains the captured lease and rejects late replies after closing instead of redirecting work',async()=>{
    let finish!:(value:{deleted:boolean})=>void;fixture.bridge.deleteCapture.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const previous=captureClient(old),pending=previous.deleteScanCapture('source-a');previous.revoke();const current=captureClient(next);await current.deleteScanCapture('source-b');
    finish({deleted:true});await expect(pending).rejects.toThrow(/locked/);await expect(previous.clearScanCaptures()).rejects.toThrow(/locked/);
    expect(fixture.bridge.deleteCapture.mock.calls.map(call=>call[0])).toEqual([{id:'source-a',lease:old},{id:'source-b',lease:next}]);
    await current.clearScanCaptures();expect(fixture.bridge.clearCaptures).toHaveBeenCalledWith({lease:next});
  });
  it('does not start a camera handoff after its pending capability check has been revoked',async()=>{
    let finish!:(value:unknown)=>void;fixture.bridge.getCapabilities.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const client=captureClient(old),pending=client.scanObject('item');expect(client.isCapturing()).toBe(false);client.revoke();finish({supported:true,platform:'android'});
    await expect(pending).rejects.toThrow(/locked/);expect(fixture.bridge.scanObject).not.toHaveBeenCalled();
  });
  it('binds cleanup to a live lease and accepts only a supported policy and valid confirmation',async()=>{
    const reply={version:1,confirmedAt:'2026-10-01T00:00:00Z',removedIds:[old],checkedCount:1,deletedCount:1,skippedCount:0,failedCount:0,nextCursor:null};fixture.bridge.pruneExpiredSources.mockResolvedValue(reply);const client=captureClient(old);
    expect(await client.pruneExpiredScanSources(7,next)).toEqual(reply);expect(fixture.bridge.pruneExpiredSources).toHaveBeenCalledWith({lease:old,days:7,afterId:next});
    fixture.bridge.pruneExpiredSources.mockResolvedValue({...reply,removedIds:['../other']});await expect(client.pruneExpiredScanSources(7)).rejects.toThrow(/invalid confirmation/);
    fixture.platform='ios';await expect(client.pruneExpiredScanSources(7)).rejects.toThrow(/Android/);fixture.platform='android';client.revoke();await expect(client.pruneExpiredScanSources(7)).rejects.toThrow(/locked/);
  });
  it('does not accept a delayed cleanup reply after the workspace is revoked',async()=>{
    let finish!:(value:unknown)=>void;fixture.bridge.pruneExpiredSources.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));const client=captureClient(old),pending=client.pruneExpiredScanSources(30);client.revoke();finish({version:1,confirmedAt:'2026-10-01T00:00:00Z',removedIds:[],checkedCount:0,deletedCount:0,skippedCount:0,failedCount:0,nextCursor:null});await expect(pending).rejects.toThrow(/locked/);
  });
  it('reports unsupported platforms and legacy plugins without inventing cleanup support',async()=>{
    fixture.native=false;expect(await getScanRetentionCapabilities()).toBe(false);expect(fixture.bridge.getRetentionCapabilities).not.toHaveBeenCalled();fixture.native=true;fixture.bridge.getRetentionCapabilities.mockRejectedValue({code:'UNIMPLEMENTED'});expect(await getScanRetentionCapabilities()).toBe(false);fixture.bridge.getRetentionCapabilities.mockResolvedValue({version:1,supported:true});expect(await getScanRetentionCapabilities()).toBe(true);fixture.bridge.getRetentionCapabilities.mockResolvedValue({supported:true});await expect(getScanRetentionCapabilities()).rejects.toThrow(/Invalid/);
  });

});


describe('optional recognition bridge',()=>{
  const result={record:{id:'native-scan',target:'item',createdAt:'2026-10-01T12:00:00Z',platform:'android',method:'arcore_depth',completedPasses:2,modelStoredLocally:true},dimensionsMm:{length:100,width:50,height:25},warnings:[]};
  it('only forwards recognition when explicitly requested and advertised by the current scanner',async()=>{
    fixture.bridge.scanObject.mockResolvedValue(result);const client=captureClient(old);
    await client.scanObject('item',true);expect(fixture.bridge.scanObject).toHaveBeenLastCalledWith({target:'item',lease:old});
    fixture.bridge.getCapabilities.mockResolvedValue({supported:true,platform:'android',recognitionSupported:true});
    await client.scanObject('item');expect(fixture.bridge.scanObject).toHaveBeenLastCalledWith({target:'item',lease:old});
    await client.scanObject('item',true);expect(fixture.bridge.scanObject).toHaveBeenLastCalledWith({target:'item',lease:old,recognize:true});
    fixture.bridge.scanObject.mockResolvedValue({...result,record:{...result.record,target:'container_interior'}});
    await client.scanObject('container_interior',true);expect(fixture.bridge.scanObject).toHaveBeenLastCalledWith({target:'container_interior',lease:old});
  });
  it('discards a delayed recognition reply after the workspace is revoked',async()=>{
    fixture.bridge.getCapabilities.mockResolvedValue({supported:true,platform:'android',recognitionSupported:true});
    let finish!:(v:unknown)=>void;fixture.bridge.scanObject.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const client=captureClient(old),pending=client.scanObject('item',true);
    await vi.waitFor(()=>expect(fixture.bridge.scanObject).toHaveBeenCalled());client.revoke();finish({...result,recognition:{status:'complete'}});
    await expect(pending).rejects.toThrow(/locked/);expect(client.isCapturing()).toBe(false);
  });
});
