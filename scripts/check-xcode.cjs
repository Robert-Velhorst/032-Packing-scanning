// Exercise the CommonJS xcode -> uuid override against the real iOS project.
// Work only in memory: do not rewrite the checked-in Xcode project.
const assert = require('node:assert/strict');
const path = require('node:path');
const xcode = require('xcode');
const project = xcode.project(path.join(__dirname, '../ios/App/App.xcodeproj/project.pbxproj'));
project.parseSync();
assert.ok(project.getFirstTarget().uuid);
const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
assert.equal(ids.size, 100);
for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
const group = project.addPbxGroup([], 'PackingCompatibilityCheck', 'PackingCompatibilityCheck');
assert.match(group.uuid, /^[A-F0-9]{24}$/);
assert.ok(project.writeSync().includes('PackingCompatibilityCheck'));
console.log('Xcode project parsing, UUID generation and serialization passed.');
