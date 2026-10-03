import type { AccountApi } from './account-http.ts';
import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import type { CarrierService } from './carrier-service.ts';
import type { WeatherService } from './weather-service.ts';

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
export function createAppServer(options: { dist: string; carrierService: CarrierService; weatherService?: WeatherService; allowedOrigins?: string[]; accountApi?: AccountApi }) {
  const root = resolve(options.dist), allowedOrigins = new Set(options.allowedOrigins ?? []);
  let windowStart = Date.now(), requests = 0;
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (options.accountApi) response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const json = (status: number, payload: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://localhost'); } catch { json(400, { error: { code: 'invalid_request', message: 'Invalid request.' } }); return; }
    if (url.pathname === '/api/v1/account' || url.pathname.startsWith('/api/v1/account/')) {
      if (options.accountApi) { await options.accountApi.handle(request, response, url); return; }
      if (url.pathname === '/api/v1/account/session' && request.method === 'GET' && !url.search) json(200, { data: { available: false, registrations: false, profile: null, csrf: null } });
      else json(503, { error: { code: 'account_unavailable', message: 'Accounts are not enabled on this server. Local guest packing is available.' } });
      return;
    }
    if (url.pathname.startsWith('/api/v1/weather/')) {
      const origin=request.headers.origin;
      if(origin&&origin!==`http://${request.headers.host}`&&origin!==`https://${request.headers.host}`&&!allowedOrigins.has(origin)){json(403,{error:{code:'origin_refused',message:'Weather lookup origin is not allowed.'}});return;}
      if(origin&&allowedOrigins.has(origin)){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');}
      if(request.method!=='GET'){response.setHeader('Allow','GET');json(405,{error:{code:'method_not_allowed',message:'Use GET.'}});return;}
      const action=url.pathname.slice('/api/v1/weather/'.length),keys=[...url.searchParams.keys()];
      if(!['status','places','forecast'].includes(action)){json(404,{error:{code:'not_found',message:'Weather endpoint not found.'}});return;}
      if(Number(request.headers['content-length']??0)>0||request.headers['transfer-encoding']||
        (action==='status'?keys.length!==0:keys.length!==1||keys[0]!==(action==='places'?'q':'placeId'))){json(400,{error:{code:'invalid_request',message:'Invalid weather lookup parameters.'}});return;}
      if(action==='status'){json(200,{data:{available:options.weatherService?.available??false}});return;}
      const query=url.searchParams.get('q')??'',id=url.searchParams.get('placeId')??'';
      if(action==='places'?(query.trim().length<2||query.length>100||/[\x00-\x1f\x7f]/.test(query)):(!/^[1-9]\d{0,11}$/.test(id)||!Number.isSafeInteger(Number(id)))){json(400,{error:{code:'invalid_request',message:'Enter a place name or choose a returned place.'}});return;}
      if(!options.weatherService?.available){json(503,{error:{code:'weather_unavailable',message:'Live weather is unavailable on this server. Saved forecasts remain on your device.'}});return;}
      if(Date.now()-windowStart>=60000){windowStart=Date.now();requests=0;}
      if(++requests>120){response.setHeader('Retry-After','60');json(429,{error:{code:'rate_limited',message:'Too many requests. Retry in a minute.'}});return;}
      try{json(200,{data:action==='places'?await options.weatherService.search(query):await options.weatherService.forecast(Number(id))});}
      catch{response.setHeader('Retry-After','60');json(503,{error:{code:'source_unavailable',message:'Weather could not be retrieved or verified. Your saved copy is unchanged; retry later.'}});}
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname !== '/api/v1/carrier-rules/easyjet') { json(404, { error: { code: 'not_found', message: 'Carrier endpoint not found.' } }); return; }
      const origin = request.headers.origin;
      if (origin && allowedOrigins.has(origin)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); json(405, { error: { code: 'method_not_allowed', message: 'Use GET.' } }); return; }
      if (url.search || Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding']) {
        json(400, { error: { code: 'invalid_request', message: 'This public endpoint accepts no parameters or body.' } }); return;
      }
      if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); requests = 0; }
      if (++requests > 120) { response.setHeader('Retry-After', '60'); json(429, { error: { code: 'rate_limited', message: 'Too many requests. Retry in a minute.' } }); return; }
      try { json(200, await options.carrierService.get()); }
      catch { response.setHeader('Retry-After', '60'); json(503, { error: { code: 'source_unavailable', message: 'The official carrier page could not be retrieved or parsed. Use a saved copy or manual record and check your booking.' } }); }
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.setHeader('Allow', 'GET, HEAD'); response.writeHead(405); response.end(); return; }
    try {
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      const actual = await realpath(file);
      if (!actual.startsWith(`${root}${sep}`)) throw new Error('Outside static root');
      const content = await readFile(actual);
      response.writeHead(200, { 'Content-Type': TYPES[extname(actual)] ?? 'application/octet-stream', 'Cache-Control': /[.-][a-zA-Z0-9_-]{8,}\.(js|css)$/.test(actual) ? 'public, max-age=31536000, immutable' : 'no-cache' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
}
