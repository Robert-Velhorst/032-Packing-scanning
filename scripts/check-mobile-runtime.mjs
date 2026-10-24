// Inspect toolchains only. Never start the app, install an SDK or contact a provider.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const profile = JSON.parse(readFileSync(new URL('../mobile-runtime.json', import.meta.url), 'utf8'));
if (profile.schema_version !== 1) throw new Error('Unsupported mobile runtime profile');
for (const version of [profile.java.version, profile.android.build_tools, profile.xcode.version, profile.xcode.ios_sdk]) {
  if (!/^\d+(?:\.\d+)*$/.test(version)) throw new Error('Select a numeric stable SDK version');
}
if (!/^android-\d+(?:\.\d+)*$/.test(profile.android.platform)) throw new Error('Invalid Android platform');
const android = profile.android;
if (!Number.isInteger(android.compile_major) || !Number.isInteger(android.compile_minor)
    || !Number.isInteger(android.target_major) || android.compile_minor < 0
    || android.target_major !== android.compile_major
    || !(android.platform === `android-${android.compile_major}.${android.compile_minor}`
      || (android.compile_minor === 0 && android.platform === `android-${android.compile_major}`))) {
  throw new Error('Android SDK fields must describe the same stable platform');
}
const selectedNode = process.versions.node;
if (!/^\d+\.\d+\.\d+$/.test(selectedNode)) throw new Error('Select a stable Node release');
const parts = selectedNode.split('.').map(Number);
const minimum = profile.node_minimum_stable[parts[0]]?.split('.').map(Number);
if (!minimum || parts[1] < minimum[1] || (parts[1] === minimum[1] && parts[2] < minimum[2])) {
  throw new Error('Select a patched stable Node release from mobile-runtime.json');
}

function command(file, args) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${file} failed: ${result.stderr}`);
  return (result.stdout + result.stderr).trim();
}

const mode = process.argv[2];
if (mode === 'profile') {
  const values = {
    'java-version': profile.java.version,
    'android-platform': profile.android.platform,
    'android-build-tools': profile.android.build_tools,
    'xcode-developer-dir': `/Applications/Xcode_${profile.xcode.version}.app/Contents/Developer`,
  };
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error('Invalid runtime output');
    console.log(`${name}=${value}`);
  }
} else if (mode === 'android') {
  const executable = (name) => process.env.JAVA_HOME
    ? path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : ''))
    : name;
  const java = command(executable('java'), ['-XshowSettings:properties', '-version']);
  const compiler = command(executable('javac'), ['--version']);
  const properties = Object.fromEntries([...java.matchAll(/^\s*(java\.[\w.]+)\s*=\s*(.*?)\s*$/gm)]
    .map((match) => [match[1], match[2]]));
  const version = /^javac (\d+(?:\.\d+)*)(?:\+\d+)?$/m.exec(compiler)?.[1];
  if (properties['java.specification.version'] !== String(profile.java.feature)
      || !(version === profile.java.version || version?.startsWith(profile.java.version + '.'))) {
    throw new Error(`Select stable JDK ${profile.java.version}; observed ${compiler}`);
  }
  if (process.env.MOBILE_QUALIFICATION === '1'
      && (properties['java.runtime.version'] !== profile.java.qualification_runtime
          || properties['java.vendor.version'] !== profile.java.qualification_vendor_version)) {
    throw new Error(`Qualification requires the pinned Zulu build: ${JSON.stringify(properties)}`);
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!sdk || !existsSync(path.join(sdk, 'platforms', profile.android.platform, 'android.jar'))
      || !existsSync(path.join(sdk, 'build-tools', profile.android.build_tools))) {
    throw new Error(`Select Android SDK ${profile.android.platform} and build-tools ${profile.android.build_tools}`);
  }
  console.log(JSON.stringify({ profile, node: selectedNode, compiler, java_properties: properties,
    android_sdk_root: sdk,
    platform_properties: readFileSync(path.join(sdk, 'platforms', profile.android.platform, 'source.properties'), 'utf8'),
    build_tools_properties: readFileSync(path.join(sdk, 'build-tools', profile.android.build_tools, 'source.properties'), 'utf8'),
    operator_sdk_installed: false, application_started: false }, null, 2));
} else if (mode === 'ios') {
  if (process.platform !== 'darwin') throw new Error('Xcode inspection requires macOS');
  const xcode = command('xcodebuild', ['-version']).replaceAll('\r', '');
  if (xcode !== `Xcode ${profile.xcode.version}\nBuild version ${profile.xcode.build}`) {
    throw new Error(`Select final Xcode ${profile.xcode.version} build ${profile.xcode.build}; observed ${xcode}`);
  }
  const sdk = command('xcrun', ['--sdk', 'iphoneos', '--show-sdk-version']);
  const simulatorSdk = command('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-version']);
  if (sdk !== profile.xcode.ios_sdk || simulatorSdk !== profile.xcode.ios_sdk) {
    throw new Error(`Expected device and simulator SDK ${profile.xcode.ios_sdk}`);
  }
  console.log(JSON.stringify({ profile, node: selectedNode, xcode, iphoneos: sdk,
    iphonesimulator: simulatorSdk, swift: command('xcrun', ['swiftc', '--version']),
    operator_sdk_installed: false, application_started: false }, null, 2));
} else {
  throw new Error('Usage: node scripts/check-mobile-runtime.mjs profile|android|ios');
}
