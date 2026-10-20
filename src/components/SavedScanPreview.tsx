import './SavedScanPreview.css';
import './ScanCloudControls.css';
import type { ReconstructedGeometry } from '../scanning/reconstructed-solid';
import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react';
import { canPreviewSavedGeometry, canReconstructSavedGeometry } from '../scanning/native';
import { useDeviceWorkspace } from './DeviceWorkspace';
import type { SavedGeometryPreview } from '../scanning/saved-geometry';
import type { ScanRecord } from '../types';
import type { PackingInterior } from '../types';
import type { ReconstructedInterior } from '../scanning/interior-cavity';
import { InteriorScanReview } from './InteriorScanReview';
import {captureGuidanceNotes} from '../scanning/capture-guidance';
import { observeNearViewport } from '../viewport-observer';

const ScanCloudCanvas=lazy(()=>import('./ScanCloudCanvas').then(module=>({default:module.ScanCloudCanvas})));

export function SavedScanPreview({ record,onAdopt,onAdoptInterior }: { record: ScanRecord;onAdopt?:(geometry:ReconstructedGeometry,source:SavedGeometryPreview)=>void;onAdoptInterior?:(geometry:ReconstructedInterior,travelUp:PackingInterior['travelUp'])=>void }) {
  const {readSavedGeometry,reconstructSavedCapture}=useDeviceWorkspace().capture;
  const reconstructSupported=canReconstructSavedGeometry(record);
  const [reconstruction,setReconstruction]=useState<ReconstructedGeometry>();
  const [surfaceMode,setSurfaceMode]=useState(false);
  const [sourceTopViewOpened,setSourceTopViewOpened]=useState(false);
  const [reconstructedTopViewOpened,setReconstructedTopViewOpened]=useState(false);
  const [preview,setPreview]=useState<SavedGeometryPreview>();
  const [viewerNearViewport,setViewerNearViewport]=useState(false);
  const [show3d,setShow3d]=useState(false);
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const active=useRef(true), request=useRef(0);
  const viewerRef=useRef<HTMLDivElement>(null);
  useEffect(() => {active.current=true;return()=>{active.current=false;request.current++;};},[]);
  useEffect(() => {request.current++;setPreview(undefined);setShow3d(false);setViewerNearViewport(false);setReconstruction(undefined);setSurfaceMode(false);setError('');setBusy(false);},[record.id]);
  useEffect(() => {
    const element=viewerRef.current;
    if(!preview||!show3d||!element)return;
    return observeNearViewport(element,isNearViewport=>{if(isNearViewport)setViewerNearViewport(true);},'160px 0px');
  },[preview,show3d]);
  const load=async()=>{
    if(busy)return;
    const token=++request.current;setBusy(true);setError('');
    try {
      const value=await readSavedGeometry(record);
      if(active.current&&token===request.current){setPreview(value);setReconstruction(undefined);setSurfaceMode(false);}
    } catch(reason) {if(active.current&&token===request.current)setError(reason instanceof Error?reason.message:'The saved geometry could not be opened.');}
    finally {if(active.current&&token===request.current)setBusy(false);}
  };
  const reconstruct=async()=>{
    if(busy||!preview)return;
    const token=++request.current;setBusy(true);setError('');
    try {const value=await reconstructSavedCapture(record,preview);if(active.current&&token===request.current){setReconstruction(value);setSurfaceMode(true);}}
    catch(reason){if(active.current&&token===request.current)setError(reason instanceof Error?reason.message:'The reconstructed surface could not be opened.');}
    finally{if(active.current&&token===request.current)setBusy(false);}
  };
  return <section className="saved-scan-preview" aria-label="Saved scan review">
    {(record.quality?.coverage||record.quality?.confidenceKind)&&<details className="scan-geometry-caution"><summary>Capture directions and depth diagnostics</summary>{captureGuidanceNotes(record).map(note=><p key={note}>{note}</p>)}</details>}
    {record.sourceRetention?.reason==='raw_scan_retention'&&<p className="scan-geometry-caution">Original source removed by raw scan retention. Saved measurements and explicitly adopted item shapes or bag cavities remain available; a new scan is needed for source review or reconstruction. Removal confirmed {new Date(record.sourceRetention.confirmedAt).toLocaleString()}.</p>}
    {record.sourceRetention?.reason!=='raw_scan_retention'&&<p>Review the original captured surface before relying on its size. Missing surfaces, reflections and surrounding objects can affect the estimate.</p>}
    {canPreviewSavedGeometry(record)?<button className="button button-secondary" type="button" disabled={busy} onClick={()=>void load()}>{busy?'Opening saved geometry…':preview?'Reload saved geometry':'Review saved scan'}</button>:record.sourceRetention?.reason==='raw_scan_retention'?null:<small>Original surface review requires its saved point-cloud scan on the original supported device. Backups retain scan details and dimensions but exclude the original points.</small>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {preview&&<>
      <p className="source-envelope-size"><strong>Original source envelope:</strong> {[preview.envelope.dimensionsMm.length,preview.envelope.dimensionsMm.width,preview.envelope.dimensionsMm.height].map((side)=>Number((side/10).toFixed(2))).join(' × ')} cm. This view precedes your scale calibration or dimension edits. Review alone leaves size fields unchanged. {reconstructSupported&&(record.target==='item'?'An explicitly adopted shape uses a uniformly scaled, rounded cell envelope.':'Explicitly adopting a reviewed cavity uses its opening-up inside frame and changes the draft inside dimensions.')}</p>
      {reconstructSupported&&record.target==='item'&&<div className="surface-reconstruction">
        <h3>Reconstruct an estimated surface</h3><p>This reads the full saved source, not the displayed sample. Open voxel shells and disconnected shapes are rejected. A mathematically closed surface does not prove the object was completely scanned. Use it in the plan only after reviewing the source and its scale.</p>
        <button className="button button-secondary" type="button" disabled={busy} onClick={()=>void reconstruct()}>{busy?'Reading source…':reconstruction?'Rebuild estimated surface':'Reconstruct saved surface'}</button>
        {reconstruction&&onAdopt&&<button className="button button-secondary" type="button" disabled={busy} onClick={()=>{try{onAdopt(reconstruction,preview);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'The shape could not be adopted.');}}}>Use estimated shape in plan</button>}
        {reconstruction&&<><p className="reconstruction-summary">{reconstruction.solid.occupiedCells.length.toLocaleString()} occupied cells · {reconstruction.solid.resolutionMm} mm cell spacing · {(reconstruction.surface.volumeMm3/1e6).toFixed(3)} litres of reconstructed cells. This is estimated occupied volume, not measured capacity or usable bag space.</p><div className="surface-view-switch"><button type="button" aria-pressed={!surfaceMode} onClick={()=>setSurfaceMode(false)}>Original points</button><button type="button" aria-pressed={surfaceMode} onClick={()=>setSurfaceMode(true)}>Reconstructed surface</button></div>{reconstruction.solid.warnings.map(w=><p className="scan-geometry-caution" key={w}>{w}</p>)}<details onToggle={event=>{if(event.currentTarget.open)setReconstructedTopViewOpened(true);}}><summary>Reconstructed top view and details</summary>{reconstructedTopViewOpened&&<SolidTopView geometry={reconstruction}/>}<p>{reconstruction.surface.faceCount.toLocaleString()} outward boundary faces; closed edge and vertex-fan checks passed. Those checks establish mesh topology, not physical completeness. Top view projects occupied cells at every height; check the 3D view for vertical recesses.</p></details></>}
      </div>}
      {show3d ? <><button className="text-button" type="button" onClick={()=>setShow3d(false)}>Close interactive 3D view</button>
      <div className="saved-scan-viewer-slot" ref={viewerRef}>
        {viewerNearViewport
          ? <Suspense fallback={<p role="status">Opening 3D scan view…</p>}><ScanCloudCanvas preview={preview} reconstruction={surfaceMode?reconstruction:undefined}/></Suspense>
          : <p className="saved-scan-viewer-placeholder" role="status">3D scan view will open as you reach it.</p>}
      </div></> : <button className="button button-secondary" type="button" onClick={()=>setShow3d(true)}>Open interactive 3D view</button>}
      {reconstructSupported&&record.target==='container_interior'&&onAdoptInterior&&<InteriorScanReview key={preview.sourceHash} record={record} source={preview} onAdopt={onAdoptInterior}/>}
      <details onToggle={event=>{if(event.currentTarget.open)setSourceTopViewOpened(true);}}><summary>Top view and source details</summary>{sourceTopViewOpened&&<ScanCloudTopView preview={preview}/>}<p>{preview.samplePointCount.toLocaleString()} displayed points from {preview.pointCount.toLocaleString()} saved points. Green points are observed surfaces; the outline is their rectangular envelope.</p><p>{preview.envelope.paddingMm?`${preview.envelope.paddingMm} mm sampling margin on each face; this does not bound sensor error or unseen surfaces.`:'This older capture uses its original camera-aligned envelope, with no added sampling margin.'} Sorted envelope sides do not establish which side must remain upright.</p></details>
      {record.target==='container_interior'&&<p className="scan-geometry-caution">Scanned walls do not establish free usable space. Check wheel/handle intrusions, corners, the floor and the opening with physical measurements.</p>}
      <button className="text-button" type="button" onClick={()=>{request.current++;setPreview(undefined);setShow3d(false);setViewerNearViewport(false);setReconstruction(undefined);setSurfaceMode(false);setError('');setBusy(false);}}>Close geometry review</button>
    </>}
  </section>;
}

const ScanCloudTopView=memo(function ScanCloudTopView({preview}:{preview:SavedGeometryPreview}) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const bounds=preview.envelope.dimensionsMm,scale=Math.min(300/bounds.length,180/bounds.width);
  useEffect(()=>{
    const canvas=canvasRef.current,context=canvas?.getContext('2d');if(!canvas||!context)return;
    context.fillStyle='#f7faf7';context.fillRect(20,20,bounds.length*scale,bounds.width*scale);
    context.strokeStyle='#637267';context.strokeRect(20,20,bounds.length*scale,bounds.width*scale);
    context.fillStyle='#267052';context.globalAlpha=.45;context.beginPath();
    for(let index=0;index<preview.samplePointCount;index++){
      const i=index*4,x=20+preview.pointsMm[i]*scale,y=20+preview.pointsMm[i+1]*scale;
      context.moveTo(x+1,y);context.arc(x,y,1,0,Math.PI*2);
    }
    context.fill();context.globalAlpha=1;
  },[preview,bounds.length,bounds.width,scale]);
  return <canvas ref={canvasRef} className="scan-cloud-top" width={340} height={220} role="img" aria-label="Top view of original captured surface points"/>;
});

const SolidTopView=memo(function SolidTopView({geometry}:{geometry:ReconstructedGeometry}) {
  const {grid,resolutionMm,dimensionsMm,occupiedCells}=geometry.solid,projection=[...new Set(occupiedCells.map(cell=>cell%(grid.x*grid.y)))];
  const padding=Math.max(dimensionsMm.length,dimensionsMm.width)*.05;
  return <svg className="solid-surface-top" role="img" aria-label="Top projection of reconstructed occupied cells" viewBox={`${-padding} ${-padding} ${dimensionsMm.length+padding*2} ${dimensionsMm.width+padding*2}`}><rect x="0" y="0" width={dimensionsMm.length} height={dimensionsMm.width} fill="#f7faf7" stroke="#637267"/>{projection.map(cell=><rect key={cell} x={(cell%grid.x)*resolutionMm} y={Math.floor(cell/grid.x)*resolutionMm} width={resolutionMm} height={resolutionMm} fill="#409573"/>)}</svg>;
});
