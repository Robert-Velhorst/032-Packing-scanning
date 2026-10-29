import {readFileSync, writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function selectSimulator(document) {
  const runtimes = document.runtimes.filter(runtime =>
    runtime.isAvailable === true && !runtime.isInternal &&
    /^\d+\.\d+(?:\.\d+)?$/.test(runtime.version) &&
    runtime.name === `iOS ${runtime.version}` && Number(runtime.version.split('.')[0]) >= 18);
  runtimes.sort((a,b) => a.version.localeCompare(b.version,'en',{numeric:true}));
  if (!runtimes.length) throw Error('An installed final iOS 18+ simulator runtime is required; no SDK download is performed.');
  const runtime = runtimes.at(-1);
  const devices = (runtime.supportedDeviceTypes ?? []).filter(device =>
    device.productFamily === 'iPhone' && /^com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-[A-Za-z0-9-]+$/.test(device.identifier));
  if (!devices.length) throw Error('The selected latest final iOS runtime declares no supported iPhone device type.');
  const preferred = devices.find(device => device.identifier === 'com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro') ?? devices[0];
  if (!/^com\.apple\.CoreSimulator\.SimRuntime\.iOS-[0-9-]+$/.test(runtime.identifier)) throw Error('Invalid iOS runtime identifier.');
  return {runtime:runtime.identifier,version:runtime.version,deviceType:preferred.identifier,deviceName:preferred.name};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const selected = selectSimulator(JSON.parse(readFileSync(process.argv[2],'utf8')));
  writeFileSync(process.argv[3], JSON.stringify(selected,null,2)+'\n',{flag:'wx'});
  process.stdout.write(`${selected.runtime}\t${selected.deviceType}`);
}
