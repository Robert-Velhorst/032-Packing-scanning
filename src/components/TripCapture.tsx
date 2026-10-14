import { useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { Trip, TripActivity } from '../types';
interface CaptureModalProps { title:string; eyebrow:string; onClose:()=>void; children:ReactNode; busy?:boolean; }
type CaptureModal = ComponentType<CaptureModalProps>;

export function TripCapture({ initial, onClose, onSave, onDelete, Modal }: { initial?:Trip; onClose:()=>void; onSave:(name:string,destination:string,start:string,end:string,packingOnly:boolean,travellerNames:string[],activities:TripActivity[],laundryAvailable:boolean,existingId?:string)=>void; onDelete?:()=>void; Modal:CaptureModal }) {
  const [name,setName] = useState(initial?.sample ? '' : initial?.name ?? '');
  const [destination,setDestination] = useState(initial?.sample ? '' : initial?.destination ?? '');
  const [start,setStart] = useState(initial?.sample ? '' : initial?.startDate ?? '');
  const [end,setEnd] = useState(initial?.sample ? '' : initial?.endDate ?? '');
  const [packingOnly,setPackingOnly] = useState(initial?.packingOnly ?? true);
  const [travellers,setTravellers] = useState<string[]>(initial?.travellers.map((traveller)=>traveller.name) ?? ['You']);
  const [activities,setActivities] = useState<TripActivity[]>(initial?.activities ?? []);
  const [laundryAvailable,setLaundryAvailable] = useState(initial?.laundryAvailable ?? false);
  const toggleActivity = (activity:TripActivity) => setActivities((current) => current.includes(activity) ? current.filter((value) => value !== activity) : [...current,activity]);
  const submit = (event:FormEvent) => {
    event.preventDefault();
    const tripName = name.trim() || (destination.trim() ? `${destination.trim()} pack` : 'Packing session');
    const tripDestination = destination.trim();
    onSave(tripName,tripDestination,start,end,packingOnly,travellers,activities,laundryAvailable,initial && !initial.sample ? initial.id : undefined);
  };
  const activityChoices: Array<[TripActivity,string]> = [['city','City walking'],['business','Business'],['beach','Beach'],['outdoors','Outdoor activities'],['formal_event','Formal event'],['sports','Sports or exercise']];
  return <Modal title={initial && !initial.sample ? 'Pack details' : 'Create a pack'} eyebrow={initial && !initial.sample ? 'PACK DETAILS' : 'NEW PACK'} onClose={onClose}>
    <form onSubmit={submit} className="simple-modal-form">
      <label className="field"><span>Pack name</span><input autoFocus value={name} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Weekend in Lisbon" maxLength={70}/></label>
      <label className="field"><span>Destination <em>optional</em></span><input value={destination} onChange={(event)=>setDestination(event.target.value)} placeholder="e.g. Lisbon, Portugal" maxLength={100}/></label>
      <div className="date-fields"><label className="field"><span>Start date</span><input type="date" value={start} onChange={(event)=>setStart(event.target.value)}/></label><label className="field"><span>End date</span><input type="date" min={start||undefined} value={end} onChange={(event)=>setEnd(event.target.value)}/></label></div>
      <div className="traveller-fields"><div className="field-heading"><span>Travellers · assign personal items and bags</span>{travellers.length<8&&<button type="button" className="text-button" onClick={()=>setTravellers((current)=>[...current,`Traveller ${current.length+1}`])}><Plus size={14}/> Add person</button>}</div>{travellers.map((traveller,index)=><div className="traveller-row" key={index}><label className="field"><span>{index===0?'First traveller':`Traveller ${index+1}`}</span><input value={traveller} onChange={(event)=>setTravellers((current)=>current.map((value,row)=>row===index?event.target.value:value))} maxLength={40}/></label>{index>0&&<button type="button" className="quiet-icon delete-icon" aria-label={`Remove traveller ${index+1}`} onClick={()=>setTravellers((current)=>current.filter((_,row)=>row!==index))}><X size={15}/></button>}</div>)}</div>
      <div className="choice-block"><span className="field-label">What do you need?</span><label className="radio-row"><input type="radio" checked={packingOnly} onChange={()=>setPackingOnly(true)}/><span><strong>Packing only</strong><small>Start with the items you already have in mind.</small></span></label><label className="radio-row"><input type="radio" checked={!packingOnly} onChange={()=>setPackingOnly(false)}/><span><strong>Trip-aware list</strong><small>Get an editable starter checklist from dates and activities.</small></span></label></div>
      {!packingOnly && <div className="trip-context-inputs"><div className="field-heading"><span>Activities · choose any that apply</span></div><div className="trip-activity-grid">{activityChoices.map(([value,label])=><label className="check-row" key={value}><input type="checkbox" checked={activities.includes(value)} onChange={()=>toggleActivity(value)}/><span>{label}</span></label>)}</div><label className="check-row laundry-check"><input type="checkbox" checked={laundryAvailable} onChange={(event)=>setLaundryAvailable(event.target.checked)}/><span>Laundry will be available</span></label><small>Starter suggestions use your entries. Optional weather lookup becomes available after saving; health and carrier decisions are not inferred. You can edit the list after creating the pack.</small></div>}
      <div className="modal-actions">{onDelete && <button className="button button-danger" type="button" onClick={onDelete}>Delete pack</button>}<span className="modal-action-spacer"/><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{initial && !initial.sample ? 'Save details' : 'Create pack'}</button></div>
    </form>
  </Modal>;
}
