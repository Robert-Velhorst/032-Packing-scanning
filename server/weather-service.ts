import { createHash } from 'node:crypto';
import { isWeatherForecast, isWeatherPlace, WEATHER_SOURCE, type WeatherForecast, type WeatherPlace } from '../src/weather.ts';

type Access='off'|'noncommercial'|'commercial';
export class WeatherUnavailable extends Error {}
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new WeatherUnavailable('Invalid weather source.');return v as Record<string,unknown>;};
export function parseWeatherPlace(value:unknown):WeatherPlace {
  const v=object(value),p={id:v.id,name:v.name,...(v.admin1?{region:v.admin1}:{}),country:v.country,countryCode:v.country_code,latitude:v.latitude,longitude:v.longitude,timezone:v.timezone};
  if(!isWeatherPlace(p))throw new WeatherUnavailable('Invalid place source.');return p;
}
export function parseWeatherForecast(value:unknown,place:WeatherPlace,retrievedAt:string,raw:string):WeatherForecast {
  const v=object(value),d=object(v.daily),u=object(v.daily_units);
  if(v.timezone!==place.timezone||u.time!=='iso8601'||u.temperature_2m_min!=='°C'||u.temperature_2m_max!=='°C'||u.precipitation_probability_max!=='%'
    ||!Array.isArray(d.time)||!d.time.length||d.time.length>16||!['temperature_2m_min','temperature_2m_max','precipitation_probability_max'].every(k=>Array.isArray(d[k])&&(d[k] as unknown[]).length===(d.time as unknown[]).length))throw new WeatherUnavailable('Weather structure or units changed.');
  const forecast={provider:'open_meteo',version:1,place,retrievedAt,sourceUrl:WEATHER_SOURCE,sourceHash:createHash('sha256').update(raw).digest('hex'),gridLatitude:v.latitude,gridLongitude:v.longitude,
    days:d.time.map((date,i)=>({date,minC:(d.temperature_2m_min as unknown[])[i],maxC:(d.temperature_2m_max as unknown[])[i],precipitationProbability:(d.precipitation_probability_max as unknown[])[i]}))};
  if(!isWeatherForecast(forecast))throw new WeatherUnavailable('Invalid forecast values.');return forecast;
}
/** Fixed upstreams, explicit access mode, no disk cache or personal request logging. */
export class WeatherService {
  private calls:number[]=[];
  private access:Access; private key?:string; private fetcher:typeof fetch; private now:()=>number;
  constructor(access:Access='off',key?:string,fetcher:typeof fetch=fetch,now:()=>number=()=>Date.now()) {
    if(!['off','noncommercial','commercial'].includes(access)||access==='commercial'&&(!key||!key.trim())||access!=='commercial'&&key)throw Error('Configure weather access as off, noncommercial, or commercial with a server-side key.');
    this.access=access;this.key=key;this.fetcher=fetcher;this.now=now;
  }
  get available(){return this.access!=='off';}
  private async request(host:string,path:string,params:Record<string,string>,signal=AbortSignal.timeout(12000)) {
    if(!this.available)throw new WeatherUnavailable('Weather is not configured.');
    this.calls=this.calls.filter(t=>this.now()-t<86400000);
    if(this.calls.length>=900||this.calls.filter(t=>this.now()-t<60000).length>=20)throw new WeatherUnavailable('Weather source request limit reached.');
    this.calls.push(this.now());
    const url=new URL(path,`https://${this.access==='commercial'?'customer-':''}${host}`);
    for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
    if(this.key)url.searchParams.set('apikey',this.key);
    const response=await this.fetcher(url,{signal,redirect:'error',credentials:'omit',headers:{Accept:'application/json'}});
    if(!response.ok||!response.headers.get('content-type')?.includes('application/json')||Number(response.headers.get('content-length')??0)>150000)throw new WeatherUnavailable('Weather source unavailable.');
    if(!response.body)throw new WeatherUnavailable('Empty weather response.');
    const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
    try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>150000)throw new WeatherUnavailable('Weather response too large.');raw+=decoder.decode(next.value,{stream:true});}raw+=decoder.decode();}
    finally{await reader.cancel().catch(()=>{});}
    return {value:JSON.parse(raw) as unknown,raw};
  }
  async search(query:string):Promise<WeatherPlace[]> {
    if(query.trim().length<2||query.length>100||/[\x00-\x1f\x7f]/.test(query))throw new WeatherUnavailable('Use a place name between 2 and 100 characters.');
    const {value}=await this.request('geocoding-api.open-meteo.com','/v1/search',{name:query.trim(),count:'5',language:'en',format:'json'}),v=object(value);
    if(v.error)throw new WeatherUnavailable('Place search failed.');
    if(v.results===undefined)return [];
    if(!Array.isArray(v.results)||v.results.length>5)throw new WeatherUnavailable('Invalid search result.');
    const places=v.results.map(parseWeatherPlace);if(new Set(places.map(p=>p.id)).size!==places.length)throw new WeatherUnavailable('Ambiguous place identities.');return places;
  }
  async forecast(id:number):Promise<WeatherForecast> {
    if(!Number.isSafeInteger(id)||id<=0)throw new WeatherUnavailable('Invalid place identity.');
    const signal=AbortSignal.timeout(18000);
    const p=await this.request('geocoding-api.open-meteo.com','/v1/get',{id:String(id)},signal),place=parseWeatherPlace(p.value);
    if(place.id!==id)throw new WeatherUnavailable('Place identity changed.');
    const {value,raw}=await this.request('api.open-meteo.com','/v1/forecast',{latitude:String(place.latitude),longitude:String(place.longitude),daily:'temperature_2m_min,temperature_2m_max,precipitation_probability_max',forecast_days:'16',timezone:place.timezone,temperature_unit:'celsius',precipitation_unit:'mm',timeformat:'iso8601'},signal);
    const forecast=parseWeatherForecast(value,place,new Date(this.now()).toISOString(),raw);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:place.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(this.now()));
    if(forecast.days[0].date!==today)throw new WeatherUnavailable('Forecast date coverage changed.');
    return forecast;
  }
}
