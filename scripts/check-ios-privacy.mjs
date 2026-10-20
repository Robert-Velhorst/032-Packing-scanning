import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const plist=path=>JSON.parse(execFileSync('/usr/bin/plutil',['-convert','json','-o','-',path],{encoding:'utf8'}));
const expected=plist('ios/App/App/PrivacyInfo.xcprivacy');
assert.ok(Array.isArray(expected.NSPrivacyAccessedAPITypes));
assert.deepEqual(plist(process.argv[2]),expected,'The built app is missing or changed its app-level API privacy declarations.');
console.log('Built iOS app includes the source API privacy manifest.');
