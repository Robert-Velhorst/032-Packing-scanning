import { measurementInput, measurementFromInput } from '../measurement-input';
import {RecognitionReview} from './RecognitionReview';
import type {ItemRecognition} from '../scanning/recognition';
import { changedPropertyEvidence, handlingEvidenceError } from '../property-evidence';
import { PropertyEvidenceFields } from './PropertyEvidenceFields';
import { topLoadError } from '../stack-load';
import { packingFormsError } from '../packing-forms';
import { PackingFormFields } from './PackingFormFields';
import { SavedScanPreview } from './SavedScanPreview';
import { PackingShapeCard } from './PackingShapeCard';
import { packingShapeError } from '../packing-geometry';
import type { PackingShape, PackingForm } from '../types';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Camera, ImagePlus, Ruler, ScanLine, X } from 'lucide-react';
import type { Evidence, EvidenceSource, Flexibility, ItemCategory, LibraryItem, ScaleCalibration, UnitSystem } from '../types';
import { useDeviceWorkspace } from './DeviceWorkspace';
import { calibrateLongestEdge } from '../scanning/calibration';
import type { ReconstructedGeometry } from '../scanning/reconstructed-solid';
import type { SavedGeometryPreview } from '../scanning/saved-geometry';
import type { ScanRecord } from '../types';
import type {ItemEditorDraft} from '../item-photo-draft';
import type {TripSuggestion} from '../trip-assistant';

export type ItemDraft = Omit<LibraryItem, 'id' | 'createdAt' | 'updatedAt'>;

interface Props {
  initial?: LibraryItem;
  suggestedItem?: { name: string; category: ItemCategory };
  unit: UnitSystem;
  scanSupported: boolean;
  recognitionSupported?:boolean;
  scanUnavailableReason?: string;
  existingPhotoUrl?: string;
  resumed?:ItemEditorDraft;
  resumedPhoto?:Blob;
  sourceTripId?:string;
  suggestion?:TripSuggestion;
  onPhotoStaged:()=>void;
  onClose: () => void;
  onSave: (item: ItemDraft, photo?: Blob) => Promise<void> | void;
}

const evidenceLabels: Record<EvidenceSource, string> = {
  measured: 'Measured by you', known: 'Known product dimensions', estimated: 'Estimate', user_confirmed: 'Confirmed by you', provider: 'Verified provider record',
};

export function ItemCapture({ initial, suggestedItem, unit, scanSupported, recognitionSupported, scanUnavailableReason, existingPhotoUrl, resumed, resumedPhoto, sourceTripId, suggestion, onPhotoStaged, onClose, onSave }: Props) {
  const device=useDeviceWorkspace();
  const {deleteScanCapture,scanObject}=device.capture;
  const [name, setName] = useState(resumed?.name ?? (initial?.name ?? suggestedItem?.name ?? ''));
  const [category, setCategory] = useState<ItemCategory>(resumed?.category ?? (initial?.category ?? suggestedItem?.category ?? 'other'));
  const showLength = (value: number) => measurementInput(value, unit === 'metric' ? 1 : 25.4);
  const fromLength = (value: number) => unit === 'metric' ? value : value * 25.4;
  const showMass = (value: number) => measurementInput(value, unit === 'metric' ? 1 : 28.3495);
  const [length, setLength] = useState(resumed?.length ?? (initial?.dimensions.length ? showLength(initial.dimensions.length) : ''));
  const [width, setWidth] = useState(resumed?.width ?? (initial?.dimensions.width ? showLength(initial.dimensions.width) : ''));
  const [height, setHeight] = useState(resumed?.height ?? (initial?.dimensions.height ? showLength(initial.dimensions.height) : ''));
  const [mass, setMass] = useState(resumed?.mass ?? (initial?.massGrams !== undefined ? showMass(initial.massGrams) : ''));
  const [dimensionSource, setDimensionSource] = useState<EvidenceSource>(resumed?.dimensionSource ?? (initial?.dimensionEvidence.source ?? 'user_confirmed'));
  const [massSource, setMassSource] = useState<EvidenceSource>(resumed?.massSource ?? (initial?.massEvidence?.source ?? 'user_confirmed'));
  const [flexibility, setFlexibility] = useState<Flexibility>(resumed?.flexibility ?? (initial?.flexibility ?? 'rigid'));
  const [fragile, setFragile] = useState(resumed?.fragile ?? (initial?.fragile ?? false));
  const [topLoad, setTopLoad] = useState(resumed?.topLoad ?? (initial?.maxTopLoadGrams !== undefined ? showMass(initial.maxTopLoadGrams) : ''));
  const [topLoadSource, setTopLoadSource] = useState<EvidenceSource>(resumed?.topLoadSource ?? (initial?.topLoadEvidence?.source ?? 'user_confirmed'));
  const [keepUpright, setKeepUpright] = useState(resumed?.keepUpright ?? (initial?.keepUpright ?? false));
  const [flexibilityEvidence, setFlexibilityEvidence] = useState<Evidence | undefined>(resumed ? resumed.flexibilityEvidence : initial?.flexibilityEvidence);
  const [fragileEvidence, setFragileEvidence] = useState<Evidence | undefined>(resumed ? resumed.fragileEvidence : initial?.fragileEvidence);
  const [keepUprightEvidence, setKeepUprightEvidence] = useState<Evidence | undefined>(resumed ? resumed.keepUprightEvidence : initial?.keepUprightEvidence);
  const [scan, setScan] = useState<ScanRecord | undefined>(resumed ? resumed.scan : (initial?.scan));
  const [formsNeedRecovery,setFormsNeedRecovery]=useState(resumed?.formsNeedRecovery ?? (Boolean(initial?.packingForms!==undefined&&packingFormsError({...initial,flexibility:'freeform'}))));
  const [packingForms,setPackingForms]=useState<PackingForm[]>(()=>structuredClone(resumed?.packingForms??initial?.packingForms??[]));
  const [packingShape,setPackingShape]=useState<PackingShape|undefined>(resumed ? resumed.packingShape : (initial?.packingShape));
  const [calibrationBasis, setCalibrationBasis] = useState(resumed ? resumed.calibrationBasis : (initial?.scan ? initial.scan.dimensionsEstimateMm ?? initial.dimensions : undefined));
  const [scaleCalibration, setScaleCalibration] = useState<ScaleCalibration | undefined>(resumed ? resumed.scaleCalibration : (initial?.scaleCalibration));
  const [scannedEstimate, setScannedEstimate] = useState(resumed?.scannedEstimate ?? (initial?.scan !== undefined));
  const [scanDimensionsEdited, setScanDimensionsEdited] = useState(resumed?.scanDimensionsEdited ?? (false));
  const [scaleReference, setScaleReference] = useState(resumed?.scaleReference ?? (initial?.scaleCalibration ? showLength(initial.scaleCalibration.referenceLengthMm) : ''));
  const [scanning, setScanning] = useState(false);
  const [recognize,setRecognize]=useState(false);
  const [recognition,setRecognition]=useState<ItemRecognition>();
  const [photo, setPhoto] = useState<Blob|undefined>(resumedPhoto);
  const [photoUrl, setPhotoUrl] = useState(resumed?.removePhoto?undefined:existingPhotoUrl);
  const [removePhoto, setRemovePhoto] = useState(resumed?.removePhoto ?? (false));
  const [error, setError] = useState('');
  const errorMessage=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(error)errorMessage.current?.scrollIntoView({block:'nearest'});},[error]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    if (!photo && !removePhoto && existingPhotoUrl) setPhotoUrl(existingPhotoUrl);
  }, [existingPhotoUrl, photo, removePhoto]);

  const choosePhoto = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (file.size > 12 * 1024 * 1024) { setError('Choose a photo under 12 MB.'); return; }
    setPhoto(file);
    setRemovePhoto(false);
    setError('');
  };

  const pickPhoto=async(source:'camera'|'library')=>{
    const snapshot:ItemEditorDraft={version:1,initial,suggestion,sourceTripId,unit,name,category,length,width,height,mass,dimensionSource,massSource,flexibility,fragile,topLoad,topLoadSource,keepUpright,flexibilityEvidence,fragileEvidence,keepUprightEvidence,scan,formsNeedRecovery,packingForms,packingShape,calibrationBasis,scaleCalibration,scannedEstimate,scanDimensionsEdited,scaleReference,removePhoto};
    if(await device.pickItemPhoto(snapshot,source))onPhotoStaged();
  };

  const captureDimensions = async () => {
    setScanning(true);
    setError('');
    setRecognition(undefined);
    try {
      const result = await scanObject('item',recognize&&recognitionSupported===true);
      if (scan && scan.id !== initial?.scan?.id) await deleteScanCapture(scan.id);
      setLength(showLength(result.dimensionsMm.length));
      setWidth(showLength(result.dimensionsMm.width));
      setHeight(showLength(result.dimensionsMm.height));
      setDimensionSource('estimated');
      setScan(result.record);
      if(recognize&&recognitionSupported&&result.recognition)setRecognition(result.recognition);
      setPackingShape(undefined);
      setCalibrationBasis(result.dimensionsMm);
      setScaleCalibration(undefined);
      setScannedEstimate(true);
      setScanDimensionsEdited(false);
      setScaleReference('');
      if (result.warnings.length) setError(result.warnings.join(' '));
    } catch (scanError) {
      const message = scanError instanceof Error ? scanError.message : 'The scan could not be completed.';
      if (message !== 'Scan cancelled.') setError(message);
    } finally { setScanning(false); }
  };

  const closeEditor = async () => {
    if(saving||scanning||device.fileBusy)return;
    if (scan && scan.id !== initial?.scan?.id) {
      try { await deleteScanCapture(scan.id); }
      catch { setError('The new 3D source capture could not be removed. Save the item or try closing again.'); return; }
    }
    onClose();
  };

  const removeScan = async () => {
    if (scan && scan.id !== initial?.scan?.id) {
      try { await deleteScanCapture(scan.id); }
      catch { setError('The new 3D source capture could not be removed.'); return; }
    }
    setScan(undefined);
    setPackingShape(undefined);
  };

  const editDimension = (axis: 'length' | 'width' | 'height', setter: (value: string) => void, value: string) => {
    setter(value);
    if(packingShape){setPackingShape(undefined);setError('Changed dimensions remove the adopted shape from this draft. Review and adopt it again with a uniform scale, or keep rectangular bounds.');}
    if (!scan) return;
    setScanDimensionsEdited(true);
    const entered = {
        length: fromLength(Number(axis === 'length' ? value : length)),
        width: fromLength(Number(axis === 'width' ? value : width)),
        height: fromLength(Number(axis === 'height' ? value : height)),
    };
    if (Object.values(entered).every((part) => Number.isFinite(part) && part > 0)) setCalibrationBasis(entered);
    setScaleCalibration(undefined);
  };

  const calibrateScale = () => {
    if (!scan) return;
    const referenceLengthMm = fromLength(Number(scaleReference));
    try {
      const estimate = calibrationBasis ?? scan.dimensionsEstimateMm ?? {
        length: fromLength(Number(length)),
        width: fromLength(Number(width)),
        height: fromLength(Number(height)),
      };
      const calibrated = calibrateLongestEdge(estimate, referenceLengthMm);
      if(packingShape)setPackingShape({...packingShape,fittedDimensionsMm:calibrated.dimensionsMm});
      setLength(showLength(calibrated.dimensionsMm.length));
      setWidth(showLength(calibrated.dimensionsMm.width));
      setHeight(showLength(calibrated.dimensionsMm.height));
      setDimensionSource('estimated');
      setScaleCalibration({ method: 'measured_longest_edge', referenceLengthMm, calibratedAt: new Date().toISOString() });
      setScanDimensionsEdited(false);
      setError('');
    } catch (calibrationError) {
      setError(calibrationError instanceof Error ? calibrationError.message : 'The scan scale could not be calibrated.');
    }
  };

  const adoptShape=(geometry:ReconstructedGeometry,source:SavedGeometryPreview)=>{
    const fittedDimensionsMm={length:measurementFromInput(length,unit==='metric'?1:25.4,initial?.dimensions.length),width:measurementFromInput(width,unit==='metric'?1:25.4,initial?.dimensions.width),height:measurementFromInput(height,unit==='metric'?1:25.4,initial?.dimensions.height)};
    const next:PackingShape={solid:geometry.solid,sourceEnvelopeMm:source.envelope.dimensionsMm,fittedDimensionsMm,adoptedAt:new Date().toISOString()};
    if(packingShape?.upright&&packingShape.solid.id===next.solid.id&&packingShape.solid.sourceHash===next.solid.sourceHash
      &&(['length','width','height'] as const).every(axis=>packingShape.sourceEnvelopeMm[axis]===next.sourceEnvelopeMm[axis]))next.upright=packingShape.upright;
    const issue=packingShapeError({dimensions:fittedDimensionsMm,packingShape:next});
    if(issue)throw new Error('The size fields do not match a uniform scale of this source. Calibrate the original scan scale or remeasure all sides; the shape was not adopted.');
    setPackingShape(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const dimensions = [length, width, height].map(Number);
    if (!name.trim()) { setError('Give this item a name.'); return; }
    if (dimensions.some((value) => !Number.isFinite(value) || value <= 0)) { setError(`Enter all three dimensions in ${unit === 'metric' ? 'millimetres' : 'inches'}.`); return; }
    if (mass && (!Number.isFinite(Number(mass)) || Number(mass) <= 0)) { setError(`Weight must be a positive number of ${unit === 'metric' ? 'grams' : 'ounces'}.`); return; }
    const now = new Date().toISOString();
    const savedDimensions = { length: measurementFromInput(length, unit === 'metric' ? 1 : 25.4, initial?.dimensions.length), width: measurementFromInput(width, unit === 'metric' ? 1 : 25.4, initial?.dimensions.width), height: measurementFromInput(height, unit === 'metric' ? 1 : 25.4, initial?.dimensions.height) };
    const dimensionsUnchanged = initial && Object.keys(savedDimensions).every(axis => savedDimensions[axis as keyof typeof savedDimensions] === initial.dimensions[axis as keyof typeof savedDimensions]);
    const savedMass = mass ? measurementFromInput(mass, unit === 'metric' ? 1 : 28.3495, initial?.massGrams) : undefined;
    const maxTopLoadGrams = topLoad.trim() === '' ? undefined : measurementFromInput(topLoad, unit === 'metric' ? 1 : 28.3495, initial?.maxTopLoadGrams);
    const topLoadEvidence = maxTopLoadGrams === undefined ? undefined : maxTopLoadGrams === initial?.maxTopLoadGrams && topLoadSource === initial?.topLoadEvidence?.source ? initial.topLoadEvidence : { source: topLoadSource, confidence: topLoadSource === 'estimated' ? 0.5 : 1, collectedAt: now, note: 'Additional static weight allowed above in the planned orientation; not a pressure or impact limit.' };
    const loadError = topLoadError({ fragile, maxTopLoadGrams, topLoadEvidence });
    if (loadError) { setError(loadError); return; }
    const handlingError = handlingEvidenceError({ flexibilityEvidence, fragileEvidence, keepUprightEvidence });
    if (handlingError) { setError(handlingError); return; }
    if(formsNeedRecovery){setError('The saved packing forms need correction. The original record is retained until you explicitly clear the invalid forms or cancel.');return;}
    const formError=packingFormsError({flexibility,packingForms});if(formError){setError(formError);return;}
    const shapeError=packingShapeError({dimensions:savedDimensions,packingShape});
    if(shapeError){setError(shapeError);return;}
    if(keepUpright&&packingShape&&!packingShape.upright){setError('Choose and confirm the real top direction in the adopted shape review, or turn off Keep this item upright. Nothing was saved.');return;}
    setSaving(true);
    try {
      await onSave({
        name: name.trim(), category,
        dimensions: savedDimensions,
        dimensionEvidence: dimensionsUnchanged && dimensionSource === initial?.dimensionEvidence.source && scan?.id === initial?.scan?.id && scaleCalibration?.calibratedAt === initial?.scaleCalibration?.calibratedAt ? initial.dimensionEvidence : { source: dimensionSource, confidence: dimensionSource === 'estimated' ? (scaleCalibration && !scanDimensionsEdited ? 0.65 : 0.5) : 1, collectedAt: now, note: dimensionSource === 'estimated' ? (scaleCalibration && !scanDimensionsEdited ? `3D scan scale calibrated with a traveller-measured longest edge (${Math.round(scaleCalibration.referenceLengthMm)} mm). Other shape boundaries remain estimates; verify all sides before relying on fit.` : scannedEstimate ? (scanDimensionsEdited ? 'Scan-based dimensions were edited by the traveller; verify all three displayed values before relying on fit.' : 'Uncalibrated 3D scan estimate. Confirm the dimensions with a physical measurement before relying on fit.') : 'Estimate entered by the user; verify before relying on fit.') : undefined },
        ...(mass ? { massGrams: savedMass, ...(savedMass === initial?.massGrams && initial?.massRangeGrams ? { massRangeGrams: initial.massRangeGrams } : {}), massEvidence: savedMass === initial?.massGrams && massSource === initial?.massEvidence?.source ? initial.massEvidence : { source: massSource, confidence: massSource === 'estimated' ? 0.55 : 1, collectedAt: now, note: massSource === 'estimated' ? 'Estimate entered by the user; not a scale reading.' : undefined } } : {}),
        flexibility, fragile, keepUpright, flexibilityEvidence, fragileEvidence, keepUprightEvidence,
        ...(packingForms.length?{packingForms}:{}),
        ...(maxTopLoadGrams !== undefined ? { maxTopLoadGrams, topLoadEvidence } : {}),
        ...(scan ? { scan } : {}),
        ...(packingShape ? {packingShape} : {}),
        ...(scaleCalibration ? { scaleCalibration } : {}),
        ...((photo || (initial?.photoId && !removePhoto)) ? { photoId: initial?.photoId } : {}),
      }, photo);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The item could not be saved on this device.');
    } finally { setSaving(false); }
  };

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
    <section className="modal capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title">
      <header className="modal-header"><div><p className="eyebrow">ITEM LIBRARY</p><h2 id="capture-title">{initial ? 'Edit item' : 'Add an item'}</h2></div><button className="icon-button" type="button" aria-label="Close" onClick={closeEditor}><X size={20}/></button></header>
      <form onSubmit={submit}>
        <div className="capture-layout">
          <div className={`capture-photo${device.native?' native-reference-photo':''}`}>
            {photoUrl ? <img src={photoUrl} alt="Item reference"/> : <div className="photo-placeholder"><Camera size={26}/><span>Add a reference photo</span><small>Kept on this device</small></div>}
            {device.native?<><button type="button" className="button button-secondary photo-button" disabled={saving||scanning||device.fileBusy||!device.photosSupported||!!device.pendingPhoto} onClick={()=>void pickPhoto('library')}><ImagePlus size={16}/> Choose reference photo</button><button type="button" className="button button-secondary photo-button" disabled={saving||scanning||device.fileBusy||!device.photosSupported||!!device.pendingPhoto} onClick={()=>void pickPhoto('camera')}><Camera size={16}/> Take reference photo</button><small className="native-photo-note">{device.photosSupported?'Your draft is held encrypted while the photo screen is open. Resume after unlocking, then save or cancel.':'Native item photos require the updated Android app.'}</small>{device.photoNotice&&<small role="status" className="native-photo-note">{device.photoNotice}</small>}</>:<label className="button button-secondary photo-button"><ImagePlus size={16}/>{photoUrl ? 'Change photo' : 'Add photo'}<input type="file" accept="image/*" capture="environment" onChange={(event) => choosePhoto(event.currentTarget.files?.[0])}/></label>}
            {photoUrl && <button className="text-button photo-remove" type="button" onClick={() => { setPhoto(undefined); setPhotoUrl(undefined); setRemovePhoto(true); }}>Remove photo</button>}
          </div>
          <div className="capture-fields">
            {recognitionSupported&&<div className="recognition-option"><label className="check-row"><input type="checkbox" checked={recognize} disabled={scanning||saving} onChange={event=>{setRecognize(event.target.checked);if(!event.target.checked)setRecognition(undefined);}}/><span>Suggest an item name from this scan</span></label><small>Optional, processed on this device. Keep the item centred when finishing. Review suggestions after accepting the size estimate.</small></div>}
            {recognition&&<RecognitionReview result={recognition} onChoose={(nextName,nextCategory)=>{setName(nextName);setCategory(nextCategory);setRecognition(undefined);}} onDismiss={()=>setRecognition(undefined)}/>}
            <label className="field"><span>Item name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Travel adapter" maxLength={80}/></label>
            <label className="field"><span>Category</span><select value={category} onChange={(event) => setCategory(event.target.value as ItemCategory)}>{[['clothing','Clothing'],['footwear','Footwear'],['electronics','Electronics'],['toiletries','Toiletries'],['medicine','Medicine'],['documents','Documents'],['accessories','Accessories'],['other','Other']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <div className="field-block"><div className="field-heading"><span>Size · {unit === 'metric' ? 'millimetres' : 'inches'}</span><Ruler size={15}/></div><button className="button button-secondary scan-size-button" type="button" onClick={captureDimensions} disabled={!scanSupported || scanning}><ScanLine size={16}/>{scanning ? 'Scanning…' : 'Scan size'}</button>{!scanSupported && <small className="scan-availability">{scanUnavailableReason ?? 'Guided 3D capture is not available on this device.'}</small>}{scan && <><small className="scan-availability">{scan.modelStoredLocally ? 'Original scan points are recorded on this device. Saved shape boundaries remain estimates.' : 'Saved scan details and measurements remain; original scan points are unavailable. Adopted shape boundaries remain estimates.'}</small><div className="scan-calibration"><p>To set the scan scale, measure the item's longest edge and enter that length here. The other shape boundaries remain estimates.</p><label className="field"><span>Measured longest edge · {unit === 'metric' ? 'millimetres' : 'inches'}</span><input aria-label="Measured longest edge" inputMode="decimal" type="number" min="0.1" max={unit === 'metric' ? 10000 : 393.7} step="any" value={scaleReference} onChange={(event) => setScaleReference(event.target.value)} placeholder={unit === 'metric' ? 'e.g. 250' : 'e.g. 9.8'}/></label><button className="button button-secondary" type="button" onClick={calibrateScale} disabled={!scaleReference}>Calibrate scan scale</button>{scaleCalibration && !scanDimensionsEdited && <small className="scan-availability">Scale calibrated from your measured edge; confirm the remaining sides before relying on fit.</small>}</div><SavedScanPreview key={scan.id} record={scan} onAdopt={adoptShape}/><button className="text-button" type="button" onClick={removeScan}>Remove saved 3D scan</button></>}{<div className="dimension-fields">{([['length','Length',length,setLength],['width','Width',width,setWidth],['height','Height',height,setHeight]] as const).map(([axis,label,value,setter]) => <label className="field" key={axis}><span>{label}</span><input aria-label={label} inputMode="decimal" type="number" min="0.1" max="10000" step="any" value={value} onChange={(event) => editDimension(axis,setter,event.target.value)}/></label>)}</div>}<label className="field evidence-field"><span>How do you know the size?</span><select value={dimensionSource} onChange={(event) => setDimensionSource(event.target.value as EvidenceSource)}>{(['measured','known','estimated','user_confirmed'] as EvidenceSource[]).map((source) => <option key={source} value={source}>{evidenceLabels[source]}</option>)}</select></label></div>
            <div className="mass-row"><label className="field"><span>Weight · {unit === 'metric' ? 'grams' : 'ounces'} <em>optional</em></span><input inputMode="decimal" type="number" min="0.1" max="100000" step="any" value={mass} onChange={(event) => setMass(event.target.value)} placeholder="Add a weight"/></label>{mass && <label className="field"><span>Weight source</span><select value={massSource} onChange={(event) => setMassSource(event.target.value as EvidenceSource)}>{(['measured','known','estimated','user_confirmed'] as EvidenceSource[]).map((source) => <option key={source} value={source}>{evidenceLabels[source]}</option>)}</select></label>}</div>
          </div>
        </div>
        <div className="capture-options">
          <p>Review these properties separately. Untouched defaults stay unreviewed; an unchecked flag does not confirm safe handling.</p>
          <label className="field"><span>How does it pack?</span><select aria-label="How does it pack?" value={flexibility} onChange={event => { setFlexibility(event.target.value as Flexibility); setFlexibilityEvidence(changedPropertyEvidence(flexibilityEvidence)); }}>{[['rigid','Rigid'],['slightly_deformable','Slightly flexible'],['foldable','Foldable'],['rollable','Rollable'],['compressible','Compressible'],['freeform','Irregular / unknown']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <PropertyEvidenceFields label="Flexibility" evidence={flexibilityEvidence} onChange={setFlexibilityEvidence}/>
          <label className="check-row"><input type="checkbox" checked={fragile} onChange={event => { setFragile(event.target.checked); setFragileEvidence(changedPropertyEvidence(fragileEvidence)); }}/><span>Fragile — handle with care</span></label>
          <PropertyEvidenceFields label="Fragility" evidence={fragileEvidence} onChange={setFragileEvidence}/>
          <label className="check-row"><input type="checkbox" checked={keepUpright} onChange={event => { setKeepUpright(event.target.checked); setKeepUprightEvidence(changedPropertyEvidence(keepUprightEvidence)); }}/><span>Keep this item upright</span></label>
          <PropertyEvidenceFields label="Upright handling" evidence={keepUprightEvidence} onChange={setKeepUprightEvidence}/>
        </div>
        <div className="item-stacking-fields">
          <h3>Weight allowed above this item</h3><p>Record an additional static load for the orientation you plan to use. Zero means nothing may rest on it. Leave blank if unknown; a scan does not establish load-bearing strength.</p>
          <label className="field"><span>Allowed weight above · {unit === 'metric' ? 'grams' : 'ounces'} <em>optional</em></span><input aria-label="Allowed weight above" inputMode="decimal" type="number" min="0" max={unit === 'metric' ? 100000 : 3527.4} step="any" value={topLoad} onChange={event => setTopLoad(event.target.value)}/></label>
          {topLoad.trim() !== '' && <label className="field"><span>Stacking limit source</span><select aria-label="Stacking limit source" value={topLoadSource} onChange={event => setTopLoadSource(event.target.value as EvidenceSource)}>{(['known', 'estimated', 'user_confirmed'] as const).map(source => <option value={source} key={source}>{source === 'known' ? 'Known load limit' : evidenceLabels[source]}</option>)}{!['known', 'estimated', 'user_confirmed'].includes(topLoadSource) && <option value={topLoadSource}>{evidenceLabels[topLoadSource]}</option>}</select></label>}
          {fragile && <p>Fragile is stricter: no planned item may rest on this item, even when a higher limit is recorded.</p>}
        </div>
        {packingShape&&<PackingShapeCard shape={packingShape} keepUpright={keepUpright} onRemove={()=>setPackingShape(undefined)} onUpright={upright=>{setPackingShape({...packingShape,upright});setError('');}}/>}
        <div className="capture-disclosure"><strong>A scan or photo does not measure weight.</strong> Check every side with a physical measurement. Packing uses adopted occupied cells or rectangular bounds with the saved weight. Neither representation establishes physical fit.</div>
        <>{formsNeedRecovery?<section className="packing-form-fields"><p role="alert">The saved packing forms need correction. Original item dimensions, scan and packed records are retained.</p><button type="button" className="button button-secondary" onClick={()=>{setPackingForms([]);setFormsNeedRecovery(false);}}>Clear invalid packing forms from this draft</button></section>:<PackingFormFields forms={packingForms} flexibility={flexibility} unit={unit} onChange={setPackingForms}/>}</>
        {error && <p ref={errorMessage} className="form-error" role="alert">{error}</p>}
        <footer className="modal-actions"><button className="button button-secondary" type="button" onClick={closeEditor} disabled={saving}>Cancel</button><button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Save item'}</button></footer>
      </form>
    </section>
  </div>;
}
