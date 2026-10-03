import {useEffect,useRef,useState} from 'react';
import type {Trip,UnitSystem} from '../types';
import {isSavedWeather,placeLabel,reviewWeather,WEATHER_SOURCE,WEATHER_GEOCODING_SOURCE,type SavedWeather,type WeatherForecast,type WeatherPlace} from '../weather';
import {fetchWeather,weatherEndpoint} from '../weather-client';

export function useWeatherClock(){const [now,setNow]=useState(Date.now());useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60000);return()=>clearInterval(timer);},[]);return now;}
const temperature=(c:number|null,unit:UnitSystem)=>c===null?'Not supplied':`${(unit==='metric'?c:c*9/5+32).toLocaleString('en-GB',{maximumFractionDigits:1})} °${unit==='metric'?'C':'F'}`;
export function WeatherNotes({trip,unit,now=Date.now()}:{trip:Trip;unit:UnitSystem;now?:number}){
  if(!trip.weather)return null;
  if(!isSavedWeather(trip.weather))return <section className="weather-notes"><h2>Saved weather</h2><p role="alert">The saved forecast is invalid. Remove it and retrieve a new copy.</p></section>;
  const forecast=trip.weather.forecast,review=reviewWeather(trip,now);
  return <section className="weather-notes" aria-label="Saved weather">
    <h3>{placeLabel(forecast.place)}</h3><p>Forecast retrieved {new Date(forecast.retrievedAt).toLocaleString()} · {forecast.place.timezone}</p>
    <p className={!review.usable||review.covered<review.total?'weather-warning':''} role="status">{review.reason??`${review.covered} of ${review.total} trip days covered${review.covered<review.total?' · remaining dates are outside this forecast':''}.`}</p>
    {!!review.missingFields&&<p className="weather-warning">{review.missingFields} weather values are missing for covered dates. Missing values cannot establish dry, warm or cold conditions.</p>}
    <details><summary>Daily forecast and source</summary><div className="weather-days">{forecast.days.map(day=><div key={day.date}><strong>{day.date}</strong><span>{temperature(day.minC,unit)} to {temperature(day.maxC,unit)}</span><span>Precipitation probability: {day.precipitationProbability===null?'not supplied':`${day.precipitationProbability}%`}</span></div>)}</div><p>Requested place: {forecast.place.latitude}, {forecast.place.longitude}. Forecast grid: {forecast.gridLatitude}, {forecast.gridLongitude}. The grid can differ from the chosen place.</p><p className="weather-hash">Source response SHA-256: {forecast.sourceHash}</p></details>
    <p>Forecasts can change. These reminders do not establish local conditions, clothing suitability or travel safety.</p>
    <p><a href={WEATHER_SOURCE} target="_blank" rel="noreferrer">Weather data: Open-Meteo ↗</a> · <a href={WEATHER_GEOCODING_SOURCE} target="_blank" rel="noreferrer">Location data: GeoNames via Open-Meteo ↗</a></p>
  </section>;
}
export function WeatherLookup({trip,unit,onSave}:{trip:Trip;unit:UnitSystem;onSave:(weather:SavedWeather|undefined)=>void}){
  const endpoint=weatherEndpoint(),now=useWeatherClock();
  const [available,setAvailable]=useState<boolean|undefined>(),[query,setQuery]=useState(trip.destination),[places,setPlaces]=useState<WeatherPlace[]>([]),[selected,setSelected]=useState(''),[preview,setPreview]=useState<WeatherForecast>(),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
  const request=useRef<AbortController|undefined>(undefined);
  useEffect(()=>{if(!endpoint)return;const controller=new AbortController();void fetchWeather(endpoint,'status',{},controller.signal).then(setAvailable).catch(()=>{if(!controller.signal.aborted)setAvailable(false);});return()=>controller.abort();},[endpoint]);
  useEffect(()=>()=>{request.current?.abort();request.current=undefined;},[]);
  async function lookup(action:'places'|'forecast'){
    if(request.current||!endpoint||!available)return;
    if(!navigator.onLine){setFailed(true);setMessage('You are offline. Saved weather remains available; refresh when connected.');return;}
    const controller=new AbortController();request.current=controller;setBusy(true);setFailed(false);setMessage(action==='places'?'Searching places…':'Retrieving a forecast for the chosen place…');
    const deadline=setTimeout(()=>controller.abort(),20000);
    try{
      if(action==='places'){
        const result=await fetchWeather(endpoint,'places',{q:query.trim()},controller.signal);if(controller.signal.aborted)return;
        setPlaces(result);setSelected('');setPreview(undefined);setMessage(result.length?'Choose the exact place, then retrieve its forecast.':'No matching place. Try a city and country.');
      }else{
        const result=await fetchWeather(endpoint,'forecast',{placeId:selected},controller.signal);if(controller.signal.aborted)return;
        const chosen=places.find(p=>String(p.id)===selected);if(!chosen||result.place.id!==chosen.id||result.place.latitude!==chosen.latitude||result.place.longitude!==chosen.longitude||result.place.timezone!==chosen.timezone)throw Error('The selected place changed. Search and review it again.');
        setPreview(result);setMessage('Forecast retrieved. Review coverage and save it to use packing reminders.');
      }
    }catch(error){if(request.current===controller){setFailed(true);setMessage(controller.signal.aborted?'Lookup timed out. Saved weather is unchanged.':error instanceof Error?error.message:'Weather lookup failed. Saved weather is unchanged.');}}
    finally{clearTimeout(deadline);if(request.current===controller){request.current=undefined;setBusy(false);}}
  }
  return <section className="weather-lookup" aria-label="Optional weather lookup">
    <div className="weather-heading"><div><p className="eyebrow">OPTIONAL TRIP CONTEXT</p><h2>Weather for your checklist</h2></div>{trip.weather&&<button className="button button-secondary" onClick={()=>{onSave(undefined);setMessage('Saved weather removed. Existing checklist items are unchanged.');}}>Remove saved weather</button>}</div>
    {!trip.packingOnly&&<><p>Search sends only the place text you enter to this app's weather service and Open-Meteo. Retrieving sends the selected place identity and coordinates. Dates, travellers, items and photos are not sent. Nothing is looked up automatically.</p>
      {(!endpoint||available===false)&&<p className="weather-warning">Live weather is unavailable in this version or on this server. Saved forecasts remain usable offline, with their age and coverage shown.</p>}
      <form onSubmit={event=>{event.preventDefault();void lookup('places');}} className="weather-search"><label className="field"><span>Place to look up</span><input value={query} maxLength={100} minLength={2} required disabled={busy} onChange={event=>{setQuery(event.target.value);setPlaces([]);setSelected('');setPreview(undefined);}} placeholder="City, country"/></label><button className="button button-secondary" disabled={busy||!endpoint||!available} type="submit">Search places</button></form>
      {!!places.length&&<><label className="field"><span>Confirm exact place</span><select aria-label="Confirm exact place" value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setPreview(undefined);}}><option value="">Choose a place…</option>{places.map(p=><option key={p.id} value={p.id}>{placeLabel(p)} · {p.timezone}</option>)}</select></label><button className="button button-secondary" disabled={busy||!selected} onClick={()=>void lookup('forecast')}>Retrieve forecast for this place</button></>}
    </>}
    {message&&<p role={failed?'alert':'status'} className={failed?'weather-warning':''}>{message}</p>}
    {preview&&<div className="weather-preview"><p className="eyebrow">UNSAVED FORECAST REVIEW</p><WeatherNotes trip={{...trip,weather:{destination:trip.destination,forecast:preview}}} unit={unit} now={now}/><button className="button button-primary" disabled={!trip.destination.trim()} onClick={()=>{onSave({destination:trip.destination,forecast:preview});setPreview(undefined);setMessage('Forecast saved on this device. Review optional reminders before adding belongings.');}}>Save forecast to this pack</button>{!trip.destination.trim()&&<p>Enter this pack's destination before saving the forecast.</p>}</div>}
    <WeatherNotes trip={trip} unit={unit} now={now}/>
  </section>;
}
