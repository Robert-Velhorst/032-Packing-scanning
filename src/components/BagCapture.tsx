import { lazy, Suspense, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Ruler, ScanLine } from 'lucide-react';
import { bagMassRecordError } from '../mass-constraints';
import { PropertyEvidenceFields } from './PropertyEvidenceFields';
import { changedPropertyEvidence } from '../property-evidence';
import { CompartmentFields } from './CompartmentFields';
import { useDeviceWorkspace } from './DeviceWorkspace';
import { adoptInterior, interiorGeometry, interiorSupportError, interiorTravelLabel } from '../packing-interior';
import type { ReconstructedInterior } from '../scanning/interior-cavity';
import type { Container, Evidence, Traveller, UnavailableSpace, ContainerCompartment, UnitSystem, PackingInterior } from '../types';
import { InteriorSupportReview } from './InteriorSupportReview';
import { UnavailableSpaceFields } from './UnavailableSpaceFields';
import { containerSpaceError } from '../container-space';
import { calibrateLongestEdge } from '../scanning/calibration';
import { measurementFromInput } from '../measurement-input';
const SavedScanPreview = lazy(() => import('./SavedScanPreview').then(module => ({ default: module.SavedScanPreview })));
interface BagCaptureModalProps { title:string; eyebrow:string; onClose:()=>void; children:ReactNode; busy?:boolean; }
type BagCaptureModal = ComponentType<BagCaptureModalProps>;
interface BagCaptureHelpers {
  evidence:(source:Evidence['source'],note?:string)=>Evidence;
  mmToDisplay:(value:number,unit:UnitSystem)=>string;
  displayToMm:(value:number,unit:UnitSystem)=>number;
  lengthInput:(value:number|undefined,unit:UnitSystem)=>string;
  massInput:(value:number|undefined,unit:UnitSystem)=>string;
  dimLabel:(unit:UnitSystem)=>string;
  sourceLabel:(source:Evidence['source'])=>string;
}
interface BagCaptureProps {
  initial?:Container; unit:UnitSystem; travellers:Traveller[]; scanSupported:boolean; scanUnavailableReason?:string;
  onClose:()=>void;
  onSave:(bag:Omit<Container,'id'|'createdAt'>,draftSourceIds:string[])=>Promise<void>;
  helpers:BagCaptureHelpers; Modal:BagCaptureModal;
}
export function BagCapture({ initial, unit, travellers, scanSupported, scanUnavailableReason, onClose, onSave, helpers, Modal }: BagCaptureProps) {
  const { evidence, mmToDisplay, displayToMm, lengthInput, massInput, dimLabel, sourceLabel } = helpers;
  const {scanObject,deleteScanCapture}=useDeviceWorkspace().capture;
  const [name,setName]=useState(initial?.name ?? '');
  const [kind,setKind]=useState<Container['kind']>(initial?.kind ?? 'cabin_case');
  const [length,setLength]=useState(lengthInput(initial?.inside.length,unit));
  const [width,setWidth]=useState(lengthInput(initial?.inside.width,unit));
  const [height,setHeight]=useState(lengthInput(initial?.inside.height,unit));
  const [openLength,setOpenLength]=useState(lengthInput(initial?.opening.length,unit));
  const [openWidth,setOpenWidth]=useState(lengthInput(initial?.opening.width,unit));
  const [openingEvidence,setOpeningEvidence]=useState<Evidence|undefined>(initial?.openingEvidence);
  const [outerLength,setOuterLength]=useState(lengthInput(initial?.outerDimensionsMm?.length,unit));
  const [outerWidth,setOuterWidth]=useState(lengthInput(initial?.outerDimensionsMm?.width,unit));
  const [outerHeight,setOuterHeight]=useState(lengthInput(initial?.outerDimensionsMm?.height,unit));
  const [outerSource,setOuterSource]=useState<Evidence['source']>(initial?.outerDimensionsEvidence?.source ?? 'user_confirmed');
  const [tare,setTare]=useState(massInput(initial?.tareGrams,unit));
  const [tareSource,setTareSource]=useState<Evidence['source']>(initial?.tareEvidence?.source ?? 'user_confirmed');
  const [limit,setLimit]=useState(massInput(initial?.massLimitGrams,unit));
  const [compartments,setCompartments]=useState<ContainerCompartment[]>(()=>structuredClone(initial?.compartments??[]));
  const reviewCompartmentsAgain=()=>setCompartments(current=>current.map(c=>({...c,supportEvidence:evidence('estimated','Inside frame changed; check the recorded compartment positions, openings and supporting bases again.')})));
  const [unavailableSpaces,setUnavailableSpaces]=useState<UnavailableSpace[]>(()=>structuredClone(initial?.unavailableSpaces??[]));
  const [lidClearance,setLidClearance]=useState(lengthInput(initial?.lidClearanceMm,unit));
  const [lidSource,setLidSource]=useState<Evidence['source']>(initial?.lidClearanceEvidence?.source??'estimated');
  const [insideEvidence,setInsideEvidence]=useState<Evidence>(initial?.insideEvidence ?? evidence('user_confirmed','Inside dimensions entered by the user; not instrument-verified. Opening evidence is reviewed separately.'));
  const [packingInterior,setPackingInterior]=useState<PackingInterior|undefined>(()=>initial?.packingInterior?structuredClone(initial.packingInterior):undefined);
  const interiorDraft=useMemo(()=>{try{return packingInterior?interiorGeometry(packingInterior):undefined;}catch{return undefined;}},[packingInterior]);
  const [scan,setScan]=useState(initial?.scan);
  const [calibrationBasis,setCalibrationBasis]=useState(initial?.scan ? initial.scan.dimensionsEstimateMm ?? initial.inside : undefined);
  const [scaleCalibration,setScaleCalibration]=useState(initial?.scaleCalibration);
  const [scanDimensionsEdited,setScanDimensionsEdited]=useState(false);
  const [scaleReference,setScaleReference]=useState(initial?.scaleCalibration ? mmToDisplay(initial.scaleCalibration.referenceLengthMm,unit) : '');
  const [travellerIds,setTravellerIds]=useState<string[]>(initial?.travellerIds ?? travellers.map((person)=>person.id));
  const [error,setError]=useState('');
  const [scanning,setScanning]=useState(false),[saving,setSaving]=useState(false),[cleaning,setCleaning]=useState(false);
  const operation=useRef(false),draftSources=useRef(new Set<string>());
  const busy=scanning||saving||cleaning;
  const captureInterior=async()=>{
    if(operation.current)return;operation.current=true;
    setScanning(true); setError('');
    try {
      const result=await scanObject('container_interior');
      if(result.record.id!==initial?.scan?.id)draftSources.current.add(result.record.id);
      let cleanupFailed=false;
      if(scan&&scan.id!==initial?.scan?.id)try{await deleteScanCapture(scan.id);draftSources.current.delete(scan.id);}catch{cleanupFailed=true;}
      setLength(mmToDisplay(result.dimensionsMm.length,unit)); setWidth(mmToDisplay(result.dimensionsMm.width,unit)); setHeight(mmToDisplay(result.dimensionsMm.height,unit));
      setInsideEvidence({source:'estimated',confidence:0.5,collectedAt:result.record.createdAt,note:'Uncalibrated 3D estimate from a guided scan. Check usable interior dimensions and the narrowest opening with a physical measurement.'});
      setPackingInterior(undefined);
      setOpeningEvidence(changedPropertyEvidence(openingEvidence));
      reviewCompartmentsAgain();
      setScan(result.record);
      setCalibrationBasis(result.dimensionsMm);
      setScaleCalibration(undefined);
      setScanDimensionsEdited(false);
      setScaleReference('');
      setError([...(cleanupFailed?['The new scan is ready, but the previous draft source could not be removed. Save or cancel will retry its cleanup.']:[]),...result.warnings].join(' '));
    } catch(scanError) { const message=scanError instanceof Error?scanError.message:'The scan could not be completed.';if(message!=='Scan cancelled.')setError(message); }
    finally { operation.current=false;setScanning(false); }
  };
  const closeEditor=async()=>{
    if(operation.current)return;operation.current=true;setCleaning(true);setError('');
    try{for(const id of [...draftSources.current]){await deleteScanCapture(id);draftSources.current.delete(id);}onClose();}
    catch{setError('The draft source captures could not all be removed. Your saved bag is unchanged. Save the draft or try cancelling again.');}
    finally{operation.current=false;setCleaning(false);}
  };
  const removeScan=async()=>{
    if(operation.current)return;operation.current=true;setCleaning(true);
    try{if(scan&&scan.id!==initial?.scan?.id){await deleteScanCapture(scan.id);draftSources.current.delete(scan.id);}setScan(undefined);setScaleReference('');}
    catch{setError('The new 3D source capture could not be removed. The draft is retained.');}
    finally{operation.current=false;setCleaning(false);}
  };
  const editInsideDimension=(axis:'length'|'width'|'height',setter:(value:string)=>void,value:string)=>{
    setter(value);
    const oldValue=axis==='length'?length:axis==='width'?width:height;
    if(value!==oldValue)reviewCompartmentsAgain();
    setPackingInterior(undefined);
    if(!scan&&!packingInterior)return;
    setScanDimensionsEdited(true);
    const nextValues={
      length:displayToMm(Number(axis==='length'?value:length),unit),
      width:displayToMm(Number(axis==='width'?value:width),unit),
      height:displayToMm(Number(axis==='height'?value:height),unit),
    };
    if(Object.values(nextValues).every((part)=>Number.isFinite(part)&&part>0))setCalibrationBasis(nextValues);
    setScaleCalibration(undefined);
    setInsideEvidence({source:'estimated',confidence:0.5,collectedAt:new Date().toISOString(),note:'Scan-based interior dimensions were edited by the traveller; confirm all displayed values and the narrowest opening before relying on fit.'});
  };
  const calibrateInteriorScale=()=>{
    if(!scan&&!packingInterior)return;
    const referenceLengthMm=displayToMm(Number(scaleReference),unit);
    try{
      const estimate=packingInterior?.cavity.boundsMm??calibrationBasis??scan?.dimensionsEstimateMm??{length:displayToMm(Number(length),unit),width:displayToMm(Number(width),unit),height:displayToMm(Number(height),unit)};
      const calibrated=calibrateLongestEdge(estimate,referenceLengthMm);
      const ratio=packingInterior?referenceLengthMm/Math.max(...Object.values(packingInterior.cavity.boundsMm)):undefined;
      const model=packingInterior?{...packingInterior,scale:ratio!,supportReview:ratio===packingInterior.scale?packingInterior.supportReview:undefined}:undefined;
      const dimensions=model?interiorGeometry(model).dimensions:calibrated.dimensionsMm;
      if(model)setPackingInterior(model);
      if(model)setOpeningEvidence(changedPropertyEvidence(openingEvidence));
      if(dimensions.length!==Number(length)*(unit==='metric'?1:25.4)||dimensions.width!==Number(width)*(unit==='metric'?1:25.4)||dimensions.height!==Number(height)*(unit==='metric'?1:25.4))reviewCompartmentsAgain();
      setLength(lengthInput(dimensions.length,unit));setWidth(lengthInput(dimensions.width,unit));setHeight(lengthInput(dimensions.height,unit));
      setScaleCalibration({method:'measured_longest_edge',referenceLengthMm,calibratedAt:new Date().toISOString()});
      setInsideEvidence({source:'estimated',confidence:0.65,collectedAt:new Date().toISOString(),note:`3D scan scale calibrated with a traveller-measured longest edge (${Math.round(referenceLengthMm)} mm). Rounded corners, intrusions, compartments and the opening remain unmeasured; confirm usable space physically.`});
      setScanDimensionsEdited(false);setError('');
    }catch(calibrationError){setError(calibrationError instanceof Error?calibrationError.message:'The scan scale could not be calibrated.');}
  };
  const adoptCavity=(geometry:ReconstructedInterior,travelUp:PackingInterior['travelUp'])=>{
    const basis=geometry.cavity.boundsMm;
    if(scanDimensionsEdited)throw Error('The scan dimensions were edited independently. Calibrate the original source scale before adopting a cavity.');
    const ratio=scaleCalibration?scaleCalibration.referenceLengthMm/Math.max(...Object.values(basis)):1;
    const model=adoptInterior(geometry.cavity,travelUp,ratio);
    const dimensions=interiorGeometry(model).dimensions;
    setPackingInterior(model);
    setOpeningEvidence(changedPropertyEvidence(openingEvidence));
    reviewCompartmentsAgain();
    setLength(lengthInput(dimensions.length,unit));setWidth(lengthInput(dimensions.width,unit));setHeight(lengthInput(dimensions.height,unit));
    setInsideEvidence({source:'estimated',confidence:0.5,collectedAt:model.adoptedAt,note:'Estimated connected scan cavity in the reviewed opening-up frame. The traveller reviewed the lowest floor, inside corner and travel-up end; physical completeness and fit remain unverified.'});
    setError('');
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(operation.current)return;
    const dims=[length,width,height,openLength,openWidth].map(Number);
    const outerValues=[outerLength,outerWidth,outerHeight];
    const hasOuterValues=outerValues.some((value)=>value.trim()!=='');
    if(!name.trim()){setError('Name this bag.');return;}
    if(dims.some((value)=>!Number.isFinite(value)||value<=0)){setError('Enter all inside dimensions and opening dimensions.');return;}
    if(hasOuterValues&&outerValues.some((value)=>!Number.isFinite(Number(value))||Number(value)<=0)){setError(`Enter all three outside dimensions in ${dimLabel(unit)}, or leave them blank.`);return;}
    if(dims[3]>dims[0]||dims[4]>dims[1]){setError('Opening dimensions should not be larger than the bag interior.');return;}
    if(travellers.length>0&&travellerIds.length===0){setError('Choose at least one traveller for this bag.');return;}
    const scale=(value:string,original?:number)=>measurementFromInput(value,unit==='metric'?1:25.4,original);
    const weight=(value:string,original?:number)=>measurementFromInput(value,unit==='metric'?1:28.3495,original);
    const massError = bagMassRecordError({ tareGrams: tare.trim() === '' ? undefined : Number(tare), massLimitGrams: limit.trim() === '' ? undefined : Number(limit) });
    if(massError){setError(massError);return;}
    const preciseInside=interiorDraft?.dimensions??initial?.inside;
    const inside={length:scale(length,preciseInside?.length),width:scale(width,preciseInside?.width),height:scale(height,preciseInside?.height)};
    const lidClearanceMm=lidClearance.trim()===''?undefined:scale(lidClearance,initial?.lidClearanceMm);
    const lidClearanceEvidence=lidClearanceMm!==undefined?(lidClearanceMm===initial?.lidClearanceMm&&lidSource===initial?.lidClearanceEvidence?.source?initial.lidClearanceEvidence:{...evidence(lidSource,'Vertical space deliberately left below the lid; physically confirm closure.'),confidence:lidSource==='estimated'?.5:1}):undefined;
    const spaceError=containerSpaceError({inside,packingInterior,compartments:compartments.length?compartments:undefined,unavailableSpaces,lidClearanceMm,lidClearanceEvidence})??interiorSupportError(packingInterior);
    if(spaceError){setError(spaceError);return;}
    const outerDimensionsMm=hasOuterValues?{length:scale(outerLength,initial?.outerDimensionsMm?.length),width:scale(outerWidth,initial?.outerDimensionsMm?.width),height:scale(outerHeight,initial?.outerDimensionsMm?.height)}:undefined;
    if(outerDimensionsMm){
      const outsideSides=Object.values(outerDimensionsMm).sort((a,b)=>b-a);
      const insideSides=Object.values(inside).sort((a,b)=>b-a);
      if(outsideSides.some((side,index)=>side<insideSides[index])){setError('Outside measurements cannot be smaller than the usable inside space. Check the measurements and units.');return;}
    }
    const outerUnchanged=outerDimensionsMm&&initial?.outerDimensionsMm&&Object.keys(outerDimensionsMm).every((axis)=>outerDimensionsMm[axis as keyof typeof outerDimensionsMm]===initial.outerDimensionsMm![axis as keyof typeof outerDimensionsMm]);
    operation.current=true;setSaving(true);setError('');
    try{await onSave({
      name:name.trim(),kind,inside,...(compartments.length?{compartments}:{}),...(packingInterior?{packingInterior}:{}),
      ...(unavailableSpaces.length?{unavailableSpaces}:{}),...(lidClearanceMm!==undefined?{lidClearanceMm,lidClearanceEvidence}:{}),
      ...(outerDimensionsMm?{outerDimensionsMm,outerDimensionsEvidence:outerUnchanged&&initial?.outerDimensionsEvidence?.source===outerSource?initial.outerDimensionsEvidence:{...evidence(outerSource,'Outside dimensions entered by the traveller. Include handles and wheels when the carrier source counts them.'),confidence:outerSource==='estimated'?0.5:1}}:{}),
      opening:{length:scale(openLength,initial?.opening.length),width:scale(openWidth,initial?.opening.width)},openingEvidence,insideEvidence,
      ...(scan?{scan}:{}),...(scaleCalibration?{scaleCalibration}:{}),
      ...(tare?{tareGrams:weight(tare,initial?.tareGrams),tareEvidence:weight(tare,initial?.tareGrams)===initial?.tareGrams&&initial?.tareEvidence?.source===tareSource?initial.tareEvidence:{...evidence(tareSource,'Empty bag weight entered by the traveller.'),confidence:tareSource==='estimated'?0.5:1}}:{}),
      ...(limit?{massLimitGrams:weight(limit,initial?.massLimitGrams),massLimitEvidence:weight(limit,initial?.massLimitGrams)===initial?.massLimitGrams&&initial?.massLimitEvidence?initial.massLimitEvidence:evidence('user_confirmed','Weight limit entered by the user; verify the applicable rule.')}:{ }),travellerIds,
    },[...draftSources.current]);}
    catch(saveError){setError(saveError instanceof Error&& !['AbortError','QuotaExceededError','UnknownError'].includes(saveError.name)?saveError.message:'The bag could not be saved on this device. Your draft has not been saved; your previous bag is retained. Retry saving or cancel the draft.');}
    finally{operation.current=false;setSaving(false);}
  };
  return <Modal title={initial?'Edit bag':'Add a bag'} eyebrow="BAG INVENTORY" onClose={()=>void closeEditor()} busy={busy}><form className="simple-modal-form bag-form" onSubmit={event=>void submit(event)} aria-busy={busy}><fieldset className="bag-editor-fields" disabled={busy}>
    <label className="field"><span>Bag name</span><input autoFocus value={name} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Blue cabin case" maxLength={70}/></label>
    <label className="field"><span>Type</span><select value={kind} onChange={(event)=>setKind(event.target.value as Container['kind'])}>{[['cabin_case','Cabin case'],['checked_case','Checked case'],['personal_item','Personal item'],['backpack','Backpack'],['duffel','Duffel'],['other','Other']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <div className="field-block"><div className="field-heading"><span>Usable inside dimensions · {dimLabel(unit)}</span><Ruler size={15}/></div>
      <button className="button button-secondary scan-size-button" type="button" onClick={captureInterior} disabled={!scanSupported||scanning}><ScanLine size={16}/>{scanning?'Scanning…':'Scan empty interior'}</button>
      {!scanSupported&&<small className="scan-availability">{scanUnavailableReason ?? 'Guided 3D scanning is not available on this device. You can enter or measure the size here.'}</small>}
      {(scan||packingInterior)&&<div className="scan-calibration"><p>Measure the longest edge of the original source envelope to set its uniform scale. For an adopted cavity, the displayed usable inside dimensions exclude observed boundary cells and may be smaller. Check all boundaries and the narrowest opening physically.</p><label className="field"><span>Measured longest source edge · {dimLabel(unit)}</span><input aria-label="Measured longest inside edge" type="number" inputMode="decimal" min="0.1" max={unit==='metric'?10000:393.7} step="any" value={scaleReference} onChange={event=>setScaleReference(event.target.value)} placeholder={unit==='metric'?'e.g. 500':'e.g. 19.7'}/></label><button className="button button-secondary" type="button" onClick={calibrateInteriorScale} disabled={!scaleReference}>Calibrate scan scale</button>{scaleCalibration&&!scanDimensionsEdited&&<small className="scan-availability">Uniform scale calibrated; remaining boundaries and physical fit are estimates.</small>}</div>}
      {scan&&<><Suspense fallback={<div role="status">Opening saved scan preview…</div>}><SavedScanPreview key={scan.id} record={scan} onAdoptInterior={adoptCavity}/></Suspense><button className="text-button" type="button" onClick={removeScan}>Remove saved 3D scan</button></>}
      {packingInterior&&<section className="adopted-interior" aria-label="Adopted estimated cavity"><h3>Estimated cavity in this draft</h3>{interiorDraft?<><p>{interiorDraft.freeCells.length.toLocaleString()} free cells · {(interiorDraft.surface.volumeMm3/1e6).toFixed(3)} estimated litres · uniform scale {packingInterior.scale.toFixed(4)}. The reviewed opening faces up for packing; the bag's {interiorTravelLabel(packingInterior)} end in that view faces up during travel.</p><p>Inside dimensions use the new corner at the smallest free side edges and lowest free floor. Recheck recorded restrictions in this frame. Editing a size independently switches this draft to rectangular space.</p><small>Source {packingInterior.cavity.id} · {packingInterior.cavity.sourcePointCount.toLocaleString()} original points. Original capture unchanged. Save applies this draft; cancel keeps the saved bag.</small><InteriorSupportReview key={packingInterior.cavity.id+':'+packingInterior.scale+':'+packingInterior.travelUp.axis+':'+packingInterior.travelUp.sign} model={packingInterior} onChange={setPackingInterior}/></>:<p className="form-error" role="alert">The saved cavity needs correction. Review the source again or explicitly switch this draft to recorded rectangular space. Cancel preserves the saved record and packed positions.</p>}<button className="button button-secondary" type="button" onClick={()=>{setPackingInterior(undefined);reviewCompartmentsAgain();}}>Use recorded rectangular space</button></section>}
      <div className="dimension-fields">{([['length','Length',length,setLength],['width','Width',width,setWidth],['height','Height',height,setHeight]] as const).map(([axis,label,value,setter])=><label className="field" key={axis}><span>{label}</span><input aria-label={`Inside ${label}`} type="number" inputMode="decimal" min="0.1" step="any" value={value} onChange={event=>editInsideDimension(axis,setter,event.target.value)}/></label>)}</div>
    </div>
    <div className="field-block"><div className="field-heading"><span>Narrowest opening · {dimLabel(unit)}</span></div><div className="dimension-fields">{[['Length',openLength,setOpenLength],['Width',openWidth,setOpenWidth]].map(([label,value,setter])=><label className="field" key={String(label)}><span>{String(label)}</span><input aria-label={`Opening ${String(label)}`} type="number" inputMode="decimal" min="0.1" step="any" value={String(value)} onChange={event=>{(setter as (value:string)=>void)(event.target.value);setOpeningEvidence(changedPropertyEvidence(openingEvidence));}}/></label>)}</div><PropertyEvidenceFields label="Opening" measurable evidence={openingEvidence} onChange={setOpeningEvidence}/></div>
    <CompartmentFields compartments={compartments} onChange={setCompartments} unit={unit}/>
    <UnavailableSpaceFields spaces={unavailableSpaces} onChange={setUnavailableSpaces} unit={unit}/>
    <div className="field-block lid-clearance-fields"><h3>Space below the lid</h3><p>Leave this vertical space free across the whole bag. Measure it below the opening in the packing view. This view may differ from the travel-up direction you reviewed. It does not establish closure or cushioning.</p><label className="field"><span>Lid clearance · {dimLabel(unit)} <em>optional</em></span><input aria-label="Lid clearance" type="number" min="0" step="any" inputMode="decimal" value={lidClearance} onChange={event=>setLidClearance(event.target.value)}/></label>{lidClearance.trim()!==''&&<label className="field"><span>Lid clearance source</span><select aria-label="Lid clearance source" value={lidSource} onChange={event=>setLidSource(event.target.value as Evidence['source'])}>{(['estimated','measured','user_confirmed'] as const).map(source=><option key={source} value={source}>{sourceLabel(source)}</option>)}{!['estimated','measured','user_confirmed'].includes(lidSource)&&<option value={lidSource}>{sourceLabel(lidSource)}</option>}</select></label>}</div>
    <div className="field-block carrier-outer-dimensions"><div className="field-heading"><span>Outside dimensions for carrier checks · {dimLabel(unit)} <em>optional</em></span></div><p>Measure the full outside as the bag will travel. Include handles and wheels when the carrier counts them.</p><div className="dimension-fields">{([['length','Length',outerLength,setOuterLength],['width','Width',outerWidth,setOuterWidth],['height','Height',outerHeight,setOuterHeight]] as const).map(([axis,label,value,setter])=><label className="field" key={axis}><span>{label}</span><input aria-label={`Outside ${label}`} type="number" inputMode="decimal" min="0.1" step="any" value={value} onChange={(event)=>setter(event.target.value)}/></label>)}</div><label className="field"><span>Outside size source</span><select value={outerSource} onChange={(event)=>setOuterSource(event.target.value as Evidence['source'])}>{(['measured','known','estimated','user_confirmed'] as const).map((source)=><option key={source} value={source}>{sourceLabel(source)}</option>)}{outerSource==='provider'&&<option value="provider">Provider record</option>}</select></label></div>
    <div className="mass-row"><label className="field"><span>Empty weight <em>optional · {unit==='metric'?'grams':'ounces'}</em></span><input aria-label="Empty bag weight" type="number" min="0" step="any" inputMode="decimal" value={tare} onChange={(event)=>setTare(event.target.value)}/></label><label className="field"><span>Weight limit <em>optional · {unit==='metric'?'grams':'ounces'}</em></span><input aria-label="Bag weight limit" type="number" min="0.1" step="any" inputMode="decimal" value={limit} onChange={(event)=>setLimit(event.target.value)}/></label></div>
    {tare&&<label className="field"><span>Empty weight source</span><select value={tareSource} onChange={(event)=>setTareSource(event.target.value as Evidence['source'])}>{(['measured','known','estimated','user_confirmed'] as const).map((source)=><option key={source} value={source}>{sourceLabel(source)}</option>)}{tareSource==='provider'&&<option value="provider">Provider record</option>}</select></label>}
    {travellers.length>1&&<div className="traveller-fields"><div className="field-heading"><span>Who can use this bag?</span></div>{travellers.map((person)=><label className="check-row" key={person.id}><input type="checkbox" checked={travellerIds.includes(person.id)} onChange={(event)=>setTravellerIds((current)=>event.target.checked?[...current,person.id]:current.filter((id)=>id!==person.id))}/><span>{person.name}</span></label>)}</div>}
    <div className="capture-disclosure"><strong>Confirm the usable interior.</strong> Review alone estimates an envelope; explicit cavity adoption changes the usable inside frame. Hidden intrusions, corners and compartments may reduce real space. Measure the narrowest opening and physically check fit.</div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={closeEditor}>Cancel</button><button className="button button-primary" type="submit">{saving?'Saving bag…':cleaning?'Removing draft scans…':initial?'Save bag':'Add bag'}</button></div>
  </fieldset></form></Modal>;
}