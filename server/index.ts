import { readFileSync } from 'node:fs';
import { AccountStore } from './accounts.ts';
import { AccountApi } from './account-http.ts';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CarrierService } from './carrier-service.ts';
import { createAppServer } from './http.ts';
import { WeatherService } from './weather-service.ts';

const project = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.APP_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('APP_PORT must be a valid port.');
const allowedOrigins = (process.env.APP_ALLOWED_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
for (const origin of allowedOrigins) {
  const parsed = new URL(origin);
  if (origin !== parsed.origin && origin !== 'capacitor://localhost') throw new Error('APP_ALLOWED_ORIGINS must contain exact origins.');
}
const accountOrigin = process.env.APP_ACCOUNT_ORIGIN;
const accountKeyFile = process.env.APP_ACCOUNT_KEY_FILE;
if (Boolean(accountOrigin) !== Boolean(accountKeyFile)) throw new Error('Configure both APP_ACCOUNT_ORIGIN and APP_ACCOUNT_KEY_FILE, or leave accounts disabled.');
const accountStore = accountOrigin && accountKeyFile ? new AccountStore(resolve(project, process.env.APP_ACCOUNT_DB_FILE ?? '.account-data/accounts.sqlite'), readFileSync(resolve(project, accountKeyFile))) : undefined;
const accountApi = accountStore && accountOrigin ? new AccountApi(accountStore, accountOrigin, process.env.APP_ACCOUNT_ALLOW_REGISTRATION === 'true') : undefined;
if(process.env.WEATHER_API_KEY&&process.env.WEATHER_API_KEY_FILE)throw Error('Configure only one weather key source.');
const weatherKey=process.env.WEATHER_API_KEY_FILE?readFileSync(resolve(project,process.env.WEATHER_API_KEY_FILE),'utf8').trim():process.env.WEATHER_API_KEY;
const server = createAppServer({
  weatherService: new WeatherService((process.env.WEATHER_ACCESS ?? 'off') as 'off'|'noncommercial'|'commercial',weatherKey),
  dist: resolve(project, 'dist'), allowedOrigins, accountApi,
  carrierService: new CarrierService(resolve(project, process.env.CARRIER_CACHE_FILE ?? '.carrier-cache/easyjet.json')),
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(port, process.env.APP_HOST ?? '127.0.0.1', () => console.log(`Packing app and public carrier lookup ready on port ${port}.`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => accountStore?.close()));
