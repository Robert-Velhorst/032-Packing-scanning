// Synthetic cross-provider fixture only: no device/account key or user content.
import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

const path = process.argv[2];
assert.ok(path && statSync(path).size < 4096, 'Expected a bounded synthetic fixture');
const fixture = JSON.parse(readFileSync(path, 'utf8'));
assert.equal(fixture.plaintext, '{"fixture":"independent OpenSSL provider"}');
assert.match(fixture.sealed, /^(?:[a-f0-9]{2}){32,512}$/);
const sealed = Buffer.from(fixture.sealed, 'hex');
assert.equal(sealed.subarray(0, 4).toString(), 'PSC1');
const key = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const context = Buffer.from('packing-scanning-native-capture-v1:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb:cccccccc-cccc-cccc-cccc-cccccccccccc:capture.json');
const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(4, 16));
decipher.setAAD(context);
decipher.setAuthTag(sealed.subarray(-16));
const plaintext = Buffer.concat([decipher.update(sealed.subarray(16, -16)), decipher.final()]);
assert.equal(plaintext.toString(), fixture.plaintext);
console.log('CryptoKit ciphertext authenticated with the independent Node/OpenSSL provider.');
