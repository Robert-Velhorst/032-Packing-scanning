// Final-image smoke test. All accounts, keys and volumes here are synthetic.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const image = process.argv[2];
if (!image) throw new Error('Usage: node scripts/check-container.mjs IMAGE');
const name = `packing032-smoke-${randomUUID()}`, volume = `${name}-data`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 120000 }).trim();
let containerCreated = false, volumeCreated = false;
let base;
function accountRequest(path, headers, account) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(account);
    const req = request(`${base}/api/v1/account/${path}`, {
      method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, timeout: 10000,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, cookies: response.headers['set-cookie'] ?? [], data: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Account smoke request timed out.')));
    req.end(body);
  });
}
async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`${base}/health/ready`, { signal: AbortSignal.timeout(2000) })).ok) return; } catch {}
    await delay(1000);
  }
  throw new Error('Final image did not become ready within 60 attempts.');
}
try {
  docker('volume', 'create', '--label', 'packing032.synthetic-test=true', volume);
  volumeCreated = true;
  const origin = 'https://packing-smoke.invalid';
  docker('run', '--detach', '--name', name, '--read-only', '--tmpfs', '/tmp',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--publish', '127.0.0.1::3001', '--mount', `type=volume,src=${volume},dst=/app/.account-data`,
    '--env', `APP_ACCOUNT_ORIGIN=${origin}`, '--env', 'APP_ACCOUNT_ALLOW_REGISTRATION=true',
    '--env', 'APP_ACCOUNT_KEY_FILE=/app/.account-data/synthetic-test.key', image,
    'node', '--input-type=module', '-e',
    "import{existsSync,writeFileSync}from'node:fs';import{randomBytes}from'node:crypto';const key='/app/.account-data/synthetic-test.key';if(!existsSync(key))writeFileSync(key,randomBytes(32),{mode:0o600});await import('./server/index.ts');");
  containerCreated = true;
  base = `http://${docker('port', name, '3001/tcp')}`;
  await ready();
  const config = JSON.parse(docker('inspect', name))[0];
  assert.equal(config.Config.User, '1000:1000');
  assert.equal(config.HostConfig.ReadonlyRootfs, true);
  assert.ok(config.HostConfig.CapDrop.includes('ALL'));
  const homepage = await fetch(base);
  assert.equal(homepage.status, 200);
  assert.equal(homepage.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.ok((await homepage.text()).includes('<html'));
  assert.equal((await fetch(`${base}/server/accounts.ts`)).status, 404);
  assert.equal((await fetch(`${base}/api/v1/weather/status`)).status, 200);
  const headers = { Host: 'packing-smoke.invalid', Origin: origin, 'Content-Type': 'application/json' };
  const account = { username: 'container-smoke', name: 'Synthetic smoke account', password: 'synthetic image test passphrase 032' };
  const registration = await accountRequest('registrations', headers, account);
  assert.equal(registration.status, 201);
  const cookie = registration.cookies.join(';');
  assert.ok(cookie.includes('Secure') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'));
  const profileId = registration.data.data.profile.id;
  docker('stop', '--time', '20', name);
  assert.equal(JSON.parse(docker('inspect', name))[0].State.ExitCode, 0);
  docker('start', name);
  base = `http://${docker('port', name, '3001/tcp')}`;
  await ready();
  const login = await accountRequest('sessions', headers, account);
  assert.equal(login.status, 200);
  assert.equal(login.data.data.profile.id, profileId);
  console.log('Final image: non-root/read-only startup, readiness, HTTP guards, secure-cookie attributes and account persistence across graceful restart passed.');
  console.log('HTTP test uses a synthetic Host/Origin on loopback; public DNS/TLS and physical devices require separate acceptance.');
} finally {
  if (containerCreated) docker('rm', '--force', name);
  if (volumeCreated) docker('volume', 'rm', volume);
}
