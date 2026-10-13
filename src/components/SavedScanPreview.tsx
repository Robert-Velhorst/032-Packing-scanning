import type { ReconstructedGeometry } from '../scanning/reconstructed-solid';
import { memo, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { canPreviewSavedGeometry } from '../scanning/native';
import { useDeviceWorkspace } from './DeviceWorkspace';
import type { SavedGeometryPreview } from '../scanning/saved-geometry';
import type { ScanRecord } from '../types';
import type { PackingInterior } from '../types';
import type { ReconstructedInterior } from '../scanning/interior-cavity';
import { InteriorScanReview } from './InteriorScanReview';
import {captureGuidanceNotes} from '../scanning/capture-guidance';

export function SavedScanPreview({ record,onAdopt,onAdoptInterior }: { record: ScanRecord;onAdopt?:(geometry:ReconstructedGeometry,source:SavedGeometryPreview)=>void;onAdoptInterior?:(geometry:ReconstructedInterior,travelUp:PackingInterior['travelUp'])=>void }) {
  const {readSavedGeometry,reconstructSavedCapture}=useDeviceWorkspace().capture;
  const [reconstruction,setReconstruction]=useState<ReconstructedGeometry>();
  const [surfaceMode,setSurfaceMode]=useState(false);
  const [preview,setPreview]=useState<SavedGeometryPreview>();
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const active=useRef(true), request=useRef(0);
  useEffect(() => {active.current=true;return()=>{active.current=false;request.current++;};},[]);
  useEffect(() => {request.current++;setPreview(undefined);setReconstruction(undefined);setSurfaceMode(false);setError('');setBusy(false);},[record.id]);
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
    {record.quality?.coverage&&<details className="scan-geometry-caution"><summary>Capture directions and depth diagnostics</summary>{captureGuidanceNotes(record).map(note=><p key={note}>{note}</p>)}</details>}
    {record.sourceRetention?.reason==='raw_scan_retention'&&<p className="scan-geometry-caution">Original source removed by raw scan retention. Saved measurements and explicitly adopted item shapes or bag cavities remain available; a new scan is needed for source review or reconstruction. Removal confirmed {new Date(record.sourceRetention.confirmedAt).toLocaleString()}.</p>}
    {record.sourceRetention?.reason!=='raw_scan_retention'&&<p>Review the original captured surface before relying on its size. Missing surfaces, reflections and surrounding objects can affect the estimate.</p>}
    {canPreviewSavedGeometry(record)?<button className="button button-secondary" type="button" disabled={busy} onClick={()=>void load()}>{busy?'Opening saved geometry…':preview?'Reload saved geometry':'Review saved scan'}</button>:record.sourceRetention?.reason==='raw_scan_retention'?null:<small>Original surface review requires its saved point cloud on a supported Android installation. Backups retain scan details and dimensions but exclude the original points.</small>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {preview&&<>
      <p className="source-envelope-size"><strong>Original source envelope:</strong> {[preview.envelope.dimensionsMm.length,preview.envelope.dimensionsMm.width,preview.envelope.dimensionsMm.height].map((side)=>Number((side/10).toFixed(2))).join(' × ')} cm. This view precedes your scale calibration or dimension edits. Review alone leaves size fields unchanged. {record.target==='item'?'An explicitly adopted shape uses a uniformly scaled, rounded cell envelope.':'Explicitly adopting a reviewed cavity uses its opening-up inside frame and changes the draft inside dimensions.'}</p>
      {record.target==='item'&&<div className="surface-reconstruction">
        <h3>Reconstruct an estimated surface</h3><p>This reads the full saved source, not the displayed sample. Open voxel shells and disconnected shapes are rejected. A mathematically closed surface does not prove the object was completely scanned. Use it in the plan only after reviewing the source and its scale.</p>
        <button className="button button-secondary" type="button" disabled={busy} onClick={()=>void reconstruct()}>{busy?'Reading source…':reconstruction?'Rebuild estimated surface':'Reconstruct saved surface'}</button>
        {reconstruction&&onAdopt&&<button className="button button-secondary" type="button" disabled={busy} onClick={()=>{try{onAdopt(reconstruction,preview);setError('');}catch(reason){setError(reason instanceof Error?reason.message:'The shape could not be adopted.');}}}>Use estimated shape in plan</button>}
        {reconstruction&&<><p className="reconstruction-summary">{reconstruction.solid.occupiedCells.length.toLocaleString()} occupied cells · {reconstruction.solid.resolutionMm} mm cell spacing · {(reconstruction.surface.volumeMm3/1e6).toFixed(3)} litres of reconstructed cells. This is estimated occupied volume, not measured capacity or usable bag space.</p><div className="surface-view-switch"><button type="button" aria-pressed={!surfaceMode} onClick={()=>setSurfaceMode(false)}>Original points</button><button type="button" aria-pressed={surfaceMode} onClick={()=>setSurfaceMode(true)}>Reconstructed surface</button></div>{reconstruction.solid.warnings.map(w=><p className="scan-geometry-caution" key={w}>{w}</p>)}<details><summary>Reconstructed top view and details</summary><SolidTopView geometry={reconstruction}/><p>{reconstruction.surface.faceCount.toLocaleString()} outward boundary faces; closed edge and vertex-fan checks passed. Those checks establish mesh topology, not physical completeness. Top view projects occupied cells at every height; check the 3D view for vertical recesses.</p></details></>}
      </div>}
      <ScanCloudCanvas preview={preview} reconstruction={surfaceMode?reconstruction:undefined}/>
      {record.target==='container_interior'&&onAdoptInterior&&<InteriorScanReview key={preview.sourceHash} record={record} source={preview} onAdopt={onAdoptInterior}/>}
      <details><summary>Top view and source details</summary><ScanCloudTopView preview={preview}/><p>{preview.samplePointCount.toLocaleString()} displayed points from {preview.pointCount.toLocaleString()} saved points. Green points are observed surfaces; the outline is their rectangular envelope.</p><p>{preview.envelope.paddingMm?`${preview.envelope.paddingMm} mm sampling margin on each face; this does not bound sensor error or unseen surfaces.`:'This older capture uses its original camera-aligned envelope, with no added sampling margin.'} Sorted envelope sides do not establish which side must remain upright.</p></details>
      {record.target==='container_interior'&&<p className="scan-geometry-caution">Scanned walls do not establish free usable space. Check wheel/handle intrusions, corners, the floor and the opening with physical measurements.</p>}
      <button className="text-button" type="button" onClick={()=>{request.current++;setPreview(undefined);setReconstruction(undefined);setSurfaceMode(false);setError('');setBusy(false);}}>Close geometry review</button>
    </>}
  </section>;
}

const ScanCloudTopView=memo(function ScanCloudTopView({preview}:{preview:SavedGeometryPreview}) {
  const bounds=preview.envelope.dimensionsMm,scale=Math.min(300/bounds.length,180/bounds.width);
  return <svg className="scan-cloud-top" viewBox="0 0 340 220" role="img" aria-label="Top view of original captured surface points"><rect x={20} y={20} width={bounds.length*scale} height={bounds.width*scale} fill="#f7faf7" stroke="#637267"/>{Array.from({length:preview.samplePointCount},(_,index)=>{const i=index*4;return <circle key={index} cx={20+preview.pointsMm[i]*scale} cy={20+preview.pointsMm[i+1]*scale} r={1} fill="#267052" opacity={0.45}/>;})}</svg>;
});

function ScanCloudCanvas({preview,reconstruction}:{preview:SavedGeometryPreview;reconstruction?:ReconstructedGeometry}) {
  const hostRef=useRef<HTMLDivElement>(null);
  const api=useRef<{camera:THREE.PerspectiveCamera;controls:OrbitControls}|undefined>(undefined);
  const [state,setState]=useState<'loading'|'ready'|'unavailable'>('loading');
  useEffect(()=>{
    const host=hostRef.current;if(!host)return;
    setState('loading');
    let renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{setState('unavailable');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor('#f7faf7',1);
    renderer.domElement.setAttribute('aria-hidden','true');host.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),bounds=reconstruction?.solid.dimensionsMm??preview.envelope.dimensionsMm;
    const l=bounds.length/100,w=bounds.width/100,h=bounds.height/100;
    const target=new THREE.Vector3(l/2,h/2,w/2),distance=Math.max(l,w,h)*3.8;
    const camera=new THREE.PerspectiveCamera(35,1,0.01,Math.max(100,distance*10));
    const controls=new OrbitControls(camera,renderer.domElement);controls.target.copy(target);controls.minDistance=distance*.35;controls.maxDistance=distance*3;controls.enablePan=false;
    camera.position.set(target.x+distance*.5,target.y+distance*.6,target.z+distance*.6);controls.update();controls.saveState();api.current={camera,controls};
    const source=reconstruction?.surface.verticesMm;
    const positions=new Float32Array(source?source.length:preview.samplePointCount*3);
    if(source){for(let i=0;i<source.length;i+=3){positions[i]=source[i]/100;positions[i+1]=source[i+2]/100;positions[i+2]=source[i+1]/100;}}
    else for(let i=0;i<preview.samplePointCount;i++){positions[i*3]=preview.pointsMm[i*4]/100;positions[i*3+1]=preview.pointsMm[i*4+2]/100;positions[i*3+2]=preview.pointsMm[i*4+1]/100;}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    const material=reconstruction?new THREE.MeshStandardMaterial({color:'#409573',roughness:.8,side:THREE.DoubleSide}):new THREE.PointsMaterial({color:'#287452',size:3,sizeAttenuation:false});
    if(reconstruction){
      const triangles=reconstruction.surface.triangles,indices=new Uint32Array(triangles.length);
      // x,z,y display axes reverse handedness; reverse triangle winding accordingly.
      for(let i=0;i<triangles.length;i+=3){indices[i]=triangles[i];indices[i+1]=triangles[i+2];indices[i+2]=triangles[i+1];}
      geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();scene.add(new THREE.Mesh(geometry,material));
      scene.add(new THREE.AmbientLight('#ffffff',1.6));const light=new THREE.DirectionalLight('#ffffff',2);light.position.set(distance,distance,distance);scene.add(light);
    }else scene.add(new THREE.Points(geometry,material));
    const box=new THREE.BoxGeometry(l,h,w),edges=new THREE.EdgesGeometry(box),lineMaterial=new THREE.LineBasicMaterial({color:'#637267',transparent:true,opacity:.5});
    const outline=new THREE.LineSegments(edges,lineMaterial);outline.position.copy(target);scene.add(outline);
    const resize=()=>{const width=host.clientWidth,height=host.clientHeight;if(width&&height){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}};
    const observer=new ResizeObserver(resize);observer.observe(host);resize();
    const lost=(event:Event)=>{event.preventDefault();setState('unavailable');},restored=()=>{resize();setState('ready');};
    renderer.domElement.addEventListener('webglcontextlost',lost);renderer.domElement.addEventListener('webglcontextrestored',restored);
    let frame=0,disposed=false;const render=()=>{if(disposed)return;frame=requestAnimationFrame(render);if(!renderer.getContext().isContextLost()){controls.update();renderer.render(scene,camera);}};render();setState('ready');
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();geometry.dispose();material.dispose();box.dispose();edges.dispose();lineMaterial.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('webglcontextrestored',restored);if(!renderer.getContext().isContextLost())renderer.forceContextLoss();renderer.dispose();renderer.domElement.remove();api.current=undefined;};
  },[preview,reconstruction]);
  const rotate=(direction:number)=>{const current=api.current;if(!current)return;const offset=current.camera.position.clone().sub(current.controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),direction*Math.PI/8);current.camera.position.copy(current.controls.target).add(offset);current.controls.update();};
  const zoom=(factor:number)=>{const current=api.current;if(!current)return;const offset=current.camera.position.clone().sub(current.controls.target);const distance=Math.max(current.controls.minDistance,Math.min(current.controls.maxDistance,offset.length()*factor));offset.setLength(distance);current.camera.position.copy(current.controls.target).add(offset);current.controls.update();};
  return <div className="scan-cloud-view"><div className="scan-cloud-surface" ref={hostRef} data-webgl={state} aria-label={reconstruction?"Rotatable reconstructed estimated surface":"Rotatable original scan geometry"}/>{state==='unavailable'&&<p role="status">The 3D view is unavailable. Open the top view and source details below.</p>}<div className="scan-cloud-controls"><button type="button" disabled={state!=='ready'} onClick={()=>rotate(-1)}>Rotate scan left</button><button type="button" disabled={state!=='ready'} onClick={()=>rotate(1)}>Rotate scan right</button><button type="button" disabled={state!=='ready'} onClick={()=>zoom(.8)}>Zoom scan in</button><button type="button" disabled={state!=='ready'} onClick={()=>zoom(1.25)}>Zoom scan out</button><button type="button" disabled={state!=='ready'} onClick={()=>api.current?.controls.reset()}>Reset scan view</button></div></div>;
}

const SolidTopView=memo(function SolidTopView({geometry}:{geometry:ReconstructedGeometry}) {
  const {grid,resolutionMm,dimensionsMm,occupiedCells}=geometry.solid,projection=[...new Set(occupiedCells.map(cell=>cell%(grid.x*grid.y)))];
  const padding=Math.max(dimensionsMm.length,dimensionsMm.width)*.05;
  return <svg className="solid-surface-top" role="img" aria-label="Top projection of reconstructed occupied cells" viewBox={`${-padding} ${-padding} ${dimensionsMm.length+padding*2} ${dimensionsMm.width+padding*2}`}><rect x="0" y="0" width={dimensionsMm.length} height={dimensionsMm.width} fill="#f7faf7" stroke="#637267"/>{projection.map(cell=><rect key={cell} x={(cell%grid.x)*resolutionMm} y={Math.floor(cell/grid.x)*resolutionMm} width={resolutionMm} height={resolutionMm} fill="#409573"/>)}</svg>;
});
