import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectSimulator} from './simulator-selection.mjs';
const phone = suffix => ({productFamily:'iPhone',identifier:`com.apple.CoreSimulator.SimDeviceType.iPhone-${suffix}`,name:`iPhone ${suffix}`});
const runtime = (version,devices=[phone('16-Pro')],extra={}) => ({isAvailable:true,isInternal:false,version,name:`iOS ${version}`,identifier:`com.apple.CoreSimulator.SimRuntime.iOS-${version.replaceAll('.','-')}`,supportedDeviceTypes:devices,...extra});
test('current runtime selects its declared Duo rather than incompatible legacy model',()=>{
  const selected=selectSimulator({runtimes:[runtime('27.0'),runtime('27.1',[phone('Duo')])]});
  assert.equal(selected.version,'27.1');assert.equal(selected.deviceType,phone('Duo').identifier);
});
test('preserves preferred model when latest runtime supports it',()=>assert.equal(selectSimulator({runtimes:[runtime('27.1',[phone('18-Pro'),phone('16-Pro')])]}).deviceType,phone('16-Pro').identifier));
test('numeric version ordering is independent of provider order',()=>assert.equal(selectSimulator({runtimes:[runtime('27.10'),runtime('27.9')]}).version,'27.10'));
test('unavailable and internal runtimes are not used',()=>assert.equal(selectSimulator({runtimes:[runtime('27.1'),runtime('27.2',undefined,{isAvailable:false}),runtime('27.3',undefined,{isInternal:true})]}).version,'27.1'));
test('release candidate and beta runtime labels are not final releases',()=>assert.equal(selectSimulator({runtimes:[runtime('27.1'),runtime('27.2',undefined,{name:'iOS 27.2 RC'}),runtime('27.3beta1')]}).version,'27.1'));
test('fails closed when latest runtime lacks supported iPhones',()=>assert.throws(()=>selectSimulator({runtimes:[runtime('27.0'),runtime('27.1',[])]}),/no supported iPhone/));
test('fails closed for absent or too-old runtimes',()=>{assert.throws(()=>selectSimulator({runtimes:[]}),/installed final/);assert.throws(()=>selectSimulator({runtimes:[runtime('17.6')]}),/installed final/);});
test('rejects invalid runtime identifiers and device identifiers',()=>{assert.throws(()=>selectSimulator({runtimes:[runtime('27.1',undefined,{identifier:'untrusted\tvalue'})]}),/Invalid/);assert.throws(()=>selectSimulator({runtimes:[runtime('27.1',[phone('Duo\nother')])]}),/no supported iPhone/);});
