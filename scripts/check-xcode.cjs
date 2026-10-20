// Exercise the CommonJS xcode -> uuid override against the real iOS project.
// Work only in memory: do not rewrite the checked-in Xcode project.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const xcode = require('xcode');
const projectPath = path.join(__dirname, '../ios/App/App.xcodeproj/project.pbxproj');
// The parser overwrites duplicate keys. Check original object declarations before parsing.
// Requiring isa excludes UUID-keyed nested dictionaries such as TargetAttributes.
const declarations = [...fs.readFileSync(projectPath, 'utf8').matchAll(/^\s*([A-F0-9]{24})\s*(?:\/\*[^\n]*\*\/\s*)?=\s*\{\s*isa\s*=/gm)].map(match => match[1]);
assert.equal(new Set(declarations).size, declarations.length, 'Duplicate Xcode object IDs');
const project = xcode.project(projectPath);
project.parseSync();
assert.ok(project.getFirstTarget().uuid);
const objects = project.hash.project.objects;
assert.equal(Object.values(objects).flatMap(section => Object.values(section)).filter(value => value?.isa).length, declarations.length, 'Object declaration inventory is incomplete');
const target = objects.PBXNativeTarget[project.getFirstTarget().uuid];
const sources = target.buildPhases.map(phase => objects.PBXSourcesBuildPhase[phase.value]).filter(Boolean);
assert.equal(sources.length, 1, 'Expected one App Sources phase');
const sourceNames = sources[0].files.map(entry => {
  const build = objects.PBXBuildFile[entry.value];
  assert.ok(build?.fileRef, 'Sources entry has no build-file object');
  const reference = objects.PBXFileReference[build.fileRef];
  assert.ok(reference?.path, 'Sources build file has no file reference');
  return path.basename(reference.path.replace(/^"|"$/g, ''));
});
for (const name of fs.readdirSync(path.join(__dirname, '../ios/App/App')).filter(name => name.endsWith('.swift'))) {
  assert.equal(sourceNames.filter(source => source === name).length, 1, `${name} must appear exactly once in App Sources`);
}
const ids = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
assert.equal(ids.size, 100);
for (const id of ids) assert.match(id, /^[A-F0-9]{24}$/);
const group = project.addPbxGroup([], 'PackingCompatibilityCheck', 'PackingCompatibilityCheck');
assert.match(group.uuid, /^[A-F0-9]{24}$/);
assert.ok(project.writeSync().includes('PackingCompatibilityCheck'));
console.log('Xcode unique IDs, Swift source membership, parsing, UUID generation and serialization passed.');
