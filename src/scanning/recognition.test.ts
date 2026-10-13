import {describe,it,expect} from 'vitest';
import {parseItemRecognition,recognitionHash,recognitionModel,recognitionLabels} from './recognition';
import {parseScanResult} from './contract';
const result=()=>({version:1,model:recognitionModel,modelSha256:recognitionHash,source:'camera_center_square',status:'complete',candidates:[{classId:72,score:0.8}]});
describe('transient item recognition',()=>{
  it('accepts only the pinned model and bounded scores with fixed name/category mappings',()=>{
    expect(parseItemRecognition(result()).candidates).toEqual([{classId:72,score:0.8}]);expect(recognitionLabels[72]).toEqual({name:'Laptop',category:'electronics'});
  });
  it.each([NaN,Infinity,-1,0.54,1.01,'0.9'])('rejects invalid model score %s',score=>{
    expect(parseItemRecognition({...result(),candidates:[{classId:72,score}]}).status).toBe('unavailable');
  });
  it('rejects mismatched hashes, unsupported identities, duplicate, unsorted and excessive suggestions',()=>{
    for(const v of [{...result(),modelSha256:'f'.repeat(64)},{...result(),version:2},{...result(),source:'upload'},{...result(),status:'unavailable'},
      {...result(),candidates:[{classId:17,score:0.8}]},{...result(),candidates:[{classId:72.5,score:0.8}]},{...result(),candidates:[{classId:72,score:0.8},{classId:72,score:0.7}]},
      {...result(),candidates:[{classId:72,score:0.7},{classId:76,score:0.8}]},{...result(),candidates:[26,27,30,31].map(classId=>({classId,score:0.8}))},
      {...result(),candidates:[{classId:72,score:0.8,name:'medicine'}]},{...result(),weight:100}])expect(parseItemRecognition(v).status).toBe('unavailable');
  });
  it('preserves valid dimensions independently of malformed suggestions and never stores them in a scan record',()=>{
    const record={id:'scan-1',target:'item',createdAt:'2026-10-01T12:00:00Z',platform:'android',method:'arcore_depth',completedPasses:2,modelStoredLocally:true};
    const input={record,dimensionsMm:{length:100,width:50,height:25},warnings:[],recognition:result()};
    expect(parseScanResult(input,'item').recognition?.candidates[0].classId).toBe(72);
    expect(parseScanResult(input,'item').record).not.toHaveProperty('recognition');
    expect(parseScanResult({...input,recognition:{bad:true}},'item').dimensionsMm).toEqual(input.dimensionsMm);
    expect(parseScanResult({...input,record:{...record,target:'container_interior'}},'container_interior')).not.toHaveProperty('recognition');
  });
  it('distinguishes a completed detection with no supported labels from an unavailable detector',()=>{
    expect(parseItemRecognition({...result(),candidates:[]}).status).toBe('complete');
    expect(parseItemRecognition(undefined).status).toBe('unavailable');
  });
});
