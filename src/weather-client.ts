import { Capacitor } from '@capacitor/core';
import { isWeatherForecast,isWeatherPlace,type WeatherForecast,type WeatherPlace } from './weather.ts';
export function weatherEndpoint():string|undefined {
  if(!Capacitor.isNativePlatform())return '/api/v1/weather';
  const configured=import.meta.env.VITE_WEATHER_API_ORIGIN;if(!configured)return;
  try{const u=new URL(configured);if(u.protocol==='https:'&&!u.username&&!u.password&&u.origin===configured)return `${u.origin}/api/v1/weather`;}catch{/* Invalid configured origin fails closed. */}
}
export async function fetchWeather<T extends 'status'|'places'|'forecast'>(endpoint:string,action:T,params:Record<string,string>,signal:AbortSignal):Promise<T extends 'status'?boolean:T extends 'places'?WeatherPlace[]:WeatherForecast> {
  const query=new URLSearchParams(params),response=await fetch(`${endpoint}/${action}${query.size?'?'+query:''}`,{signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
  if(!response.ok)throw new Error(response.status===503?'Live weather is unavailable or its source could not be verified. Saved weather is unchanged.':response.status===429?'Too many lookups. Wait a minute before retrying.':'Weather lookup failed. Saved weather is unchanged.');
  if(!response.headers.get('content-type')?.includes('application/json')||Number(response.headers.get('content-length')??0)>150000||!response.body)throw Error('Invalid weather response.');
  const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let raw='',bytes=0;
  try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>150000)throw Error('Weather response is too large.');raw+=decoder.decode(next.value,{stream:true});}raw+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}
  const body=JSON.parse(raw) as {data?:unknown};const data=body?.data;
  if(action==='status'){
    if(!data||typeof data!=='object'||typeof (data as {available?:unknown}).available!=='boolean')throw Error('Invalid weather status.');
    return (data as {available:boolean}).available as never;
  }
  if(action==='places'){
    if(!Array.isArray(data)||data.length>5||!data.every(isWeatherPlace)||new Set(data.map(p=>p.id)).size!==data.length)throw Error('Invalid weather place response.');
  }else if(!isWeatherForecast(data)||Date.parse(data.retrievedAt)>Date.now()+300000)throw Error('Invalid weather forecast response.');
  return data as never;
}
