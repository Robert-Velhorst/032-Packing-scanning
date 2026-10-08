import type { Trip } from './types.ts';
import type { TripSuggestion } from './trip-assistant.ts';

export const WEATHER_SOURCE = 'https://open-meteo.com/en/docs';
export const WEATHER_GEOCODING_SOURCE = 'https://open-meteo.com/en/docs/geocoding-api';
export interface WeatherPlace { id:number; name:string; region?:string; country:string; countryCode:string; latitude:number; longitude:number; timezone:string; }
export interface WeatherDay { date:string; minC:number|null; maxC:number|null; precipitationProbability:number|null; }
export interface WeatherForecast {
  provider:'open_meteo'; version:1; place:WeatherPlace; retrievedAt:string; sourceUrl:typeof WEATHER_SOURCE; sourceHash:string;
  gridLatitude:number; gridLongitude:number; days:WeatherDay[];
}
/** This context binds a reviewed forecast to a pack without sending trip dates upstream. */
export interface SavedWeather { destination:string; forecast:WeatherForecast; }
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const fields=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const text=(v:unknown,max=200):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function weatherDate(v:unknown):v is string {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const d=new Date(v+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===v;
}
export function isWeatherPlace(v:unknown):v is WeatherPlace {
  if(!record(v)||!fields(v,['id','name','region','country','countryCode','latitude','longitude','timezone'])||!Number.isSafeInteger(v.id)||Number(v.id)<=0
    ||!text(v.name)||!text(v.country)||!text(v.countryCode,2)||!/^[A-Z]{2}$/.test(v.countryCode)||!finite(v.latitude,-90,90)||!finite(v.longitude,-180,180)
    ||!text(v.timezone,100)||(v.region!==undefined&&!text(v.region)))return false;
  try{new Intl.DateTimeFormat('en',{timeZone:v.timezone});return true;}catch{return false;}
}
export function isWeatherForecast(v:unknown):v is WeatherForecast {
  if(!record(v)||!fields(v,['provider','version','place','retrievedAt','sourceUrl','sourceHash','gridLatitude','gridLongitude','days'])||v.provider!=='open_meteo'||v.version!==1
    ||!isWeatherPlace(v.place)||v.sourceUrl!==WEATHER_SOURCE||typeof v.sourceHash!=='string'||! /^[a-f0-9]{64}$/.test(v.sourceHash)
    ||typeof v.retrievedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(v.retrievedAt)||!Number.isFinite(Date.parse(v.retrievedAt))
    ||!finite(v.gridLatitude,-90,90)||!finite(v.gridLongitude,-180,180)||!Array.isArray(v.days)||!v.days.length||v.days.length>16)return false;
  return v.days.every((d,i)=>record(d)&&fields(d,['date','minC','maxC','precipitationProbability'])&&weatherDate(d.date)
    &&(i===0||Date.parse(d.date)-Date.parse((v.days as WeatherDay[])[i-1].date)===86400000)
    &&(d.minC===null||finite(d.minC,-100,70))&&(d.maxC===null||finite(d.maxC,-100,70))
    &&(d.minC===null||d.maxC===null||Number(d.minC)<=Number(d.maxC))&&(d.precipitationProbability===null||finite(d.precipitationProbability,0,100)));
}
export function isSavedWeather(v:unknown):v is SavedWeather {
  return record(v)&&fields(v,['destination','forecast'])&&text(v.destination,200)&&isWeatherForecast(v.forecast);
}
export const placeLabel=(p:WeatherPlace)=>[p.name,p.region,p.country].filter(Boolean).join(', ');
export const normalizedDestination=(s:string)=>s.trim().toLocaleLowerCase('en-GB').replace(/\s+/g,' ');
export function reviewWeather(trip:Pick<Trip,'packingOnly'|'destination'|'startDate'|'endDate'|'weather'>,now=Date.now()) {
  const saved=trip.weather;
  if(!saved)return {usable:false,days:[] as WeatherDay[],reason:'No forecast saved for this pack.',covered:0,total:0,missingFields:0};
  if(!isSavedWeather(saved))return {usable:false,days:[] as WeatherDay[],reason:'The saved forecast is invalid. Remove it and retrieve a new copy.',covered:0,total:0,missingFields:0};
  const age=now-Date.parse(saved.forecast.retrievedAt);
  let reason=trip.packingOnly?'Weather suggestions are paused for a packing-only session.':normalizedDestination(trip.destination)!==normalizedDestination(saved.destination)?'The destination changed. Review a new place and forecast.':age< -300000?'The retrieval time is in the future. Check the clock and retrieve again.':age>=6*3600000?'Saved forecast is stale. Refresh before using weather suggestions.':undefined;
  const validDates=weatherDate(trip.startDate)&&weatherDate(trip.endDate)&&trip.endDate>=trip.startDate;
  const total=validDates?Math.floor((Date.parse(trip.endDate!)-Date.parse(trip.startDate!))/86400000)+1:0;
  const days=validDates?saved.forecast.days.filter(d=>d.date>=trip.startDate!&&d.date<=trip.endDate!):[];
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:saved.forecast.place.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  if(!reason)reason=!validDates?'Add valid start and end dates to see forecast coverage.':trip.endDate!<today?'Trip dates have passed. Saved weather is historical context only.':!days.length?'Trip dates are outside this forecast. No weather suggestions can be made.':undefined;
  const missingFields=days.reduce((n,d)=>n+['minC','maxC','precipitationProbability'].filter(k=>d[k as keyof WeatherDay]===null).length,0);
  return {usable:!reason,days,reason,covered:days.length,total,missingFields};
}
export function weatherSuggestions(trip:Trip,now=Date.now()):TripSuggestion[] {
  const review=reviewWeather(trip,now);if(!review.usable)return [];
  const days=review.days,context=`Forecast for ${review.covered} of ${review.total} trip days at ${placeLabel(trip.weather!.forecast.place)}; ${review.covered<review.total?'uncovered dates need separate review. ':''}This is a packing reminder, not a safety forecast.`;
  const result:TripSuggestion[]=[];
  if(days.some(d=>d.minC!==null&&d.minC<=10))result.push({id:'weather-warm-layer',name:'Warm layer',category:'clothing',quantity:1,priority:'optional',accessPriority:3,matchTerms:['jacket','coat','sweater','fleece','jumper'],reason:`A covered daily minimum is 10 °C or lower. ${context}`});
  if(days.some(d=>d.maxC!==null&&d.maxC>=25))result.push({id:'weather-light-clothing',name:'Light clothing',category:'clothing',quantity:1,priority:'optional',accessPriority:2,matchTerms:['shirt','top','short','dress'],reason:`A covered daily maximum is 25 °C or higher. ${context}`});
  if(days.some(d=>d.precipitationProbability!==null&&d.precipitationProbability>=40))result.push({id:'weather-rain-layer',name:'Rain layer',category:'clothing',quantity:1,priority:'optional',accessPriority:4,matchTerms:['rain','waterproof','shell','poncho'],reason:`A covered daily precipitation probability is at least 40%. ${context}`});
  return result;
}
