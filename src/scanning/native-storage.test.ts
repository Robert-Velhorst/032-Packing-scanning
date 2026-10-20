import {beforeEach,describe,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({bridge:{getCapturePreview:vi.fn(),reconstructCapture:vi.fn(),reconstructInterior:vi.fn(),getRetentionCapabilities:vi.fn(),pruneExpiredSources:vi.fn(),getStorageState:vi.fn(),openWorkspaceStorage:vi.fn(),deleteCapture:vi.fn(),clearCaptures:vi.fn(),touchStorage:vi.fn(),getCapabilities:vi.fn(),scanObject:vi.fn()},native:true,platform:'android'}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>fixture.native,getPlatform:()=>fixture.platform,isPluginAvailable:()=>true},registerPlugin:()=>fixture.bridge}));
import {captureClient,getScanRetentionCapabilities,canPreviewSavedGeometry,canReconstructSavedGeometry} from './native';
import type {ScanRecord} from '../types';
import {getCaptureStorageState,openCaptureWorkspace} from './native-storage';
const old='11111111-1111-4111-8111-111111111111',next='22222222-2222-4222-8222-222222222222';
beforeEach(()=>{vi.resetAllMocks();fixture.native=true;fixture.platform='android';fixture.bridge.deleteCapture.mockResolvedValue({deleted:true});fixture.bridge.clearCaptures.mockResolvedValue({deleted:1});fixture.bridge.getCapabilities.mockResolvedValue({supported:true,platform:'android'});});
describe('native workspace boundary',()=>{
  it('accepts the iOS handshake and binds supported saved depth review to its original lease',async()=>{
    fixture.platform='ios';fixture.bridge.getStorageState.mockResolvedValue({version:1,revision:old,lease:old,protectedWorkspace:true});
    expect((await getCaptureStorageState())?.lease).toBe(old);
    const record:ScanRecord={id:next,target:'item',createdAt:'2026-10-20T12:00:00Z',platform:'ios',method:'arkit_scene_depth',completedPasses:3,modelStoredLocally:true,
      geometry:{format:'ply_point_cloud',units:'metres',coordinateFrame:'capture_local_right_handed',pointCount:386}};
    const preview={id:next,target:'item',format:'point_cloud_preview',units:'millimetres',sourceHash:'a'.repeat(64),pointCount:386,samplePointCount:1,pointsMm:[2.5,2.5,2.5,1],
      envelope:{method:'oriented_surface_envelope_v1',basis:'capture_aligned',paddingMm:2.5,dimensionsMm:{length:85,width:85,height:85}}};
    fixture.bridge.getCapturePreview.mockResolvedValue(preview);
    const client=captureClient(old);expect(canPreviewSavedGeometry(record)).toBe(true);expect(canReconstructSavedGeometry(record)).toBe(true);
    const loaded=await client.readSavedGeometry(record);expect(loaded).toEqual(preview);expect(fixture.bridge.getCapturePreview).toHaveBeenCalledWith({id:next,lease:old});
    const solid={id:next,target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:preview.sourceHash,sourcePointCount:386,
      method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid:{x:9,y:9,z:9},occupiedCells:Array.from({length:729},(_,i)=>i),
      observedCellCount:386,enclosedCellCount:343,surfaceFaceCount:486,dimensionsMm:{length:90,width:90,height:90},warnings:[]};
    fixture.bridge.reconstructCapture.mockResolvedValue(solid);
    expect((await client.reconstructSavedCapture(record,loaded)).solid).toEqual(solid);expect(fixture.bridge.reconstructCapture).toHaveBeenCalledWith({id:next,lease:old});
    fixture.bridge.reconstructCapture.mockResolvedValue({...solid,sourceHash:'b'.repeat(64)});
    await expect(client.reconstructSavedCapture(record,loaded)).rejects.toThrow(/incomplete or inconsistent/);
    expect(canReconstructSavedGeometry({...record,target:'container_interior'})).toBe(true);
    let finishSolid!:(value:unknown)=>void;fixture.bridge.reconstructCapture.mockImplementationOnce(()=>new Promise(resolve=>{finishSolid=resolve;}));
    const lateClient=captureClient(old),late=lateClient.reconstructSavedCapture(record,loaded);lateClient.revoke();finishSolid(solid);await expect(late).rejects.toThrow(/locked/);
    expect(canPreviewSavedGeometry({...record,method:'guided_object_capture'})).toBe(false);
    let finish!:(value:unknown)=>void;fixture.bridge.getCapturePreview.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=client.readSavedGeometry(record);client.revoke();finish(preview);await expect(pending).rejects.toThrow(/locked/);
  });
  it('binds iOS cavity review to its original source, reviewed opening and lease',async()=>{
    fixture.platform='ios';
    const record:ScanRecord={id:next,target:'container_interior',createdAt:'2026-10-20T12:00:00Z',platform:'ios',method:'arkit_scene_depth',completedPasses:3,modelStoredLocally:true,
      geometry:{format:'ply_point_cloud',units:'metres',coordinateFrame:'capture_local_right_handed',pointCount:386}};
    const source={id:next,target:'container_interior' as const,format:'point_cloud_preview' as const,units:'millimetres' as const,sourceHash:'a'.repeat(64),pointCount:386,samplePointCount:1,pointsMm:[2.5,2.5,2.5,1],
      envelope:{method:'oriented_surface_envelope_v1' as const,basis:'capture_aligned' as const,paddingMm:2.5,dimensionsMm:{length:85,width:85,height:85}}};
    const review={openingAxis:2 as const,openingSign:1 as const,seedMm:{x:42.5,y:42.5,z:42.5}};
    const freeCells:number[]=[],observedCells:number[]=[],openingCells:number[]=[];
    for(let z=0;z<9;z++)for(let y=0;y<9;y++)for(let x=0;x<9;x++){
      const cell=x+9*(y+9*z);if(x>0&&x<8&&y>0&&y<8&&z>0){freeCells.push(cell);if(z===8)openingCells.push(cell);}else observedCells.push(cell);
    }
    const cavity={id:next,target:'container_interior',format:'voxel_cavity_v1',units:'millimetres',method:'seeded_observed_interior_v1',sourceHash:source.sourceHash,sourcePointCount:386,
      grid:{x:9,y:9,z:9},boundsMm:source.envelope.dimensionsMm,cellSizeMm:{length:85/9,width:85/9,height:85/9},seedMm:review.seedMm,
      opening:{axis:2,sign:1,planeMm:85,cells:openingCells},freeCells,observedCells,wallCellCount:observedCells.length,surfaceFaceCount:322,estimatedVolumeMm3:freeCells.length*(85/9)**3,warnings:[]};
    const client=captureClient(old);fixture.bridge.reconstructInterior.mockResolvedValue(cavity);
    expect((await client.reconstructSavedInterior(record,source,review)).cavity).toEqual(cavity);
    expect(fixture.bridge.reconstructInterior).toHaveBeenCalledWith({id:next,...review,lease:old});
    await expect(client.reconstructSavedInterior(record,source,{...review,openingSign:-1})).rejects.toThrow(/inconsistent/);
    let finish!:(value:unknown)=>void;fixture.bridge.reconstructInterior.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=client.reconstructSavedInterior(record,source,review);client.revoke();finish(cavity);await expect(pending).rejects.toThrow(/locked/);
    expect(canReconstructSavedGeometry({...record,method:'guided_object_capture'})).toBe(false);
  });
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
