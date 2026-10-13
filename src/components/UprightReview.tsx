import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { placementSurface, shapeDimensions, shapeKey } from '../packing-geometry';
import { confirmedUpright, uprightFaces } from '../upright';
import type { PackingShape, UprightDirection } from '../types';

type Face = typeof uprightFaces[number];
const dimensionsAxes=['length','width','height'] as const;
const initialFace=(shape:PackingShape)=>uprightFaces.find(face=>face.axis===shape.upright?.axis&&face.sign===shape.upright.sign)??uprightFaces[4];

export function UprightReview({shape,keepUpright,onChange}:{shape:PackingShape;keepUpright:boolean;onChange:(record:UprightDirection|undefined)=>void}) {
  const [face,setFace]=useState<Face>(()=>initialFace(shape));
  const [open,setOpen]=useState(keepUpright&&!shape.upright);
  const [uprightView,setUprightView]=useState(false);
  const confirmed=shape.upright?.axis===face.axis&&shape.upright.sign===face.sign;
  const stored=initialFace(shape);
  function choose(next:Face){setFace(next);if(shape.upright&&(next.axis!==shape.upright.axis||next.sign!==shape.upright.sign))onChange(undefined);}
  return <div className="upright-review" aria-label="Upright direction review">
    <h4>Which end must face up?</h4>
    <p role="status">{shape.upright?`Face ${stored.letter} (${stored.label}) · traveller confirmed ${new Date(shape.upright.evidence.collectedAt).toLocaleString()}.`:'Top direction has not been reviewed. The scan axes do not identify the real top.'}{!keepUpright&&' Keep upright is off, so the plan may rotate this item.'}</p>
    <button className="button button-secondary" type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Close direction review':'Review top direction'}</button>
    {open&&<>
      <p>Match a letter to the real end that must face upward during travel. Rotate the estimated shape or use the source-face diagrams. This does not verify stability, scan completeness or fit. Recheck the recorded stacking limit when changing the top face.</p>
      <div className="surface-view-switch" aria-label="Direction preview frame"><button type="button" aria-pressed={!uprightView} onClick={()=>setUprightView(false)}>Recorded shape</button><button type="button" aria-pressed={uprightView} onClick={()=>setUprightView(true)}>Selected end facing up</button></div>
      <ShapeDirectionView shape={shape} face={face} upright={uprightView}/>
      <div className="upright-face-options" role="group" aria-label="Choose the end that must face up">{uprightFaces.map(option=><button type="button" key={option.letter} aria-label={`Choose ${option.letter}: ${option.label} to face up`} aria-pressed={face.letter===option.letter} onClick={()=>choose(option)}><strong>{option.letter}</strong><span>{option.label}</span></button>)}</div>
      <p>The selected end is <strong>{face.letter} · {face.label}</strong>. Confirm it matches the real item's top; selecting a letter alone does not save a review.</p>
      <button className="button button-primary" type="button" onClick={()=>onChange(confirmedUpright(shape,face))}>Confirm {face.letter} must face up</button>
      {confirmed&&<p className="reconstruction-summary">Direction confirmed in this draft. Save changes to keep it on this device.</p>}
      {shape.upright&&<button className="button button-secondary" type="button" onClick={()=>onChange(undefined)}>Clear upright review</button>}
    </>}
  </div>;
}

const ShapeDirectionView=memo(function ShapeDirectionView({shape,face,upright}:{shape:PackingShape;face:Face;upright:boolean}) {
  const hostRef=useRef<HTMLDivElement>(null),labelsRef=useRef<HTMLDivElement>(null);
  const api=useRef<{camera:THREE.PerspectiveCamera;controls:OrbitControls;home:THREE.Vector3}|undefined>(undefined);
  const [state,setState]=useState<'loading'|'ready'|'unavailable'>('loading'),[diagrams,setDiagrams]=useState(false);
  const key=shapeKey(shape),direction=upright?face.letter:'recorded';
  useEffect(()=>{
    const host=hostRef.current;if(!host)return;
    setState('loading');let active=true,renderer:THREE.WebGLRenderer;
    try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});}catch{setState('unavailable');return;}
    renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.setClearColor('#f7faf7',1);renderer.domElement.setAttribute('aria-hidden','true');host.appendChild(renderer.domElement);
    const scene=new THREE.Scene(),bounds=shapeDimensions(shape),sides=dimensionsAxes.map(axis=>bounds[axis]),scale=Math.max(...sides);
    const vector=(axis:Face['axis'],sign:number)=>new THREE.Vector3(axis==='length'?sign:0,axis==='height'?sign:0,axis==='width'?sign:0);
    const rotation=upright?new THREE.Quaternion().setFromUnitVectors(vector(face.axis,face.sign),new THREE.Vector3(0,1,0)):new THREE.Quaternion();
    const group=new THREE.Group();group.quaternion.copy(rotation);scene.add(group);
    const surface=placementSurface({instanceId:'review',entryId:'review',itemId:'review',containerId:'review',x:0,y:0,z:0,...bounds,rotation:0,layer:1},{packingShape:shape})!;
    const vertices:number[]=[];
    for(let i=0;i<surface.verticesMm.length;i+=3)vertices.push((surface.verticesMm[i]-bounds.length/2)/scale,(surface.verticesMm[i+2]-bounds.height/2)/scale,(surface.verticesMm[i+1]-bounds.width/2)/scale);
    const indices=[...surface.triangles];for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setIndex(indices);geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({color:'#7eb29a',roughness:.8,metalness:0})));
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry,1),new THREE.LineBasicMaterial({color:'#315b42',transparent:true,opacity:.45})));
    const colors=['#ae4e33','#ae4e33','#24678d','#24678d','#775b99','#775b99'],labelPoints:THREE.Vector3[]=[];
    for(const [index,option] of uprightFaces.entries()){
      const size=sides[dimensionsAxes.indexOf(option.axis)]/scale/2,d=vector(option.axis,option.sign),distance=size+.2;
      group.add(new THREE.ArrowHelper(d,new THREE.Vector3(),distance,colors[index],.08,.045));labelPoints.push(d.clone().multiplyScalar(distance+.08).applyQuaternion(rotation));
    }
    scene.add(new THREE.HemisphereLight('#ffffff','#cad7cb',2));const light=new THREE.DirectionalLight('#ffffff',2);light.position.set(2,3,4);scene.add(light);
    const camera=new THREE.PerspectiveCamera(38,1,.01,30),home=new THREE.Vector3(2.1,1.5,2.5);camera.position.copy(home);
    const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=1.4;controls.maxDistance=5;controls.enablePan=false;controls.update();api.current={camera,controls,home};
    const resize=()=>{if(!active)return;const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();};
    const observer=new ResizeObserver(resize);observer.observe(host);resize();
    let frame=0;
    const draw=()=>{if(!active)return;controls.update();renderer.render(scene,camera);const labels=labelsRef.current?.querySelectorAll<HTMLElement>('[data-face]');labelPoints.forEach((point,index)=>{const p=point.clone().project(camera),label=labels?.[index];if(label){label.style.left=`${(p.x+1)*host.clientWidth/2}px`;label.style.top=`${(1-p.y)*host.clientHeight/2}px`;label.hidden=p.z>1||p.z< -1;}});frame=requestAnimationFrame(draw);};
    const lost=(event:Event)=>{event.preventDefault();if(active){setState('unavailable');cancelAnimationFrame(frame);}};
    renderer.domElement.addEventListener('webglcontextlost',lost);draw();setState('ready');
    return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();api.current=undefined;renderer.domElement.removeEventListener('webglcontextlost',lost);
      const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.Line){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);}});geometries.forEach(value=>value.dispose());materials.forEach(value=>value.dispose());const context=renderer.getContext(),releaseContext=!context.isContextLost()&&!!context.getExtension('WEBGL_lose_context');renderer.dispose();if(releaseContext)renderer.forceContextLoss();renderer.domElement.remove();};
  // The review record and selected label do not rebuild an unchanged source-frame mesh.
  },[key,direction]);
  function rotate(amount:number){const value=api.current;if(!value)return;const spherical=new THREE.Spherical().setFromVector3(value.camera.position);spherical.theta+=amount;value.camera.position.setFromSpherical(spherical);value.controls.update();}
  return <div className="upright-shape-view">
    <div className="upright-canvas" ref={hostRef} data-webgl={state} role="img" aria-label={`Estimated shape with source ends A to F. ${upright?`End ${face.letter} is shown facing upward.`:'Recorded coordinate frame; not a verified upright pose.'}`}>
      {upright&&<span className="upright-world-up" aria-hidden="true">↑ Travel up</span>}
      <div className="upright-face-labels" ref={labelsRef} aria-hidden="true">{uprightFaces.map(option=><span key={option.letter} data-face={option.letter} data-selected={face.letter===option.letter}>{option.letter}</span>)}</div>
      {state==='loading'&&<p>Opening direction preview…</p>}
    </div>
    {state==='unavailable'&&<p role="status">3D graphics are unavailable. Use the three source-face diagrams below; they retain the same end letters.</p>}
    <div className="scan-cloud-controls" aria-label="Upright preview controls"><button type="button" disabled={state!=='ready'} onClick={()=>rotate(-Math.PI/6)}>Turn preview left</button><button type="button" disabled={state!=='ready'} onClick={()=>rotate(Math.PI/6)}>Turn preview right</button><button type="button" disabled={state!=='ready'} onClick={()=>{const value=api.current;if(value){value.camera.position.copy(value.home);value.controls.target.set(0,0,0);value.controls.update();}}}>Reset direction view</button></div>
    <button type="button" className="button button-secondary" aria-expanded={diagrams||state==='unavailable'} onClick={()=>setDiagrams(value=>!value)}>Source-face diagrams</button>
    {(diagrams||state==='unavailable')&&<SourceFaceDiagrams solid={shape.solid}/>}
  </div>;
});

const SourceFaceDiagrams=memo(function SourceFaceDiagrams({solid}:{solid:PackingShape['solid']}) {
  const projections=useMemo(()=>{
    const {x,y,z}=solid.grid,points=solid.occupiedCells.map(cell=>[cell%x,Math.floor(cell/x)%y,Math.floor(cell/(x*y))]);
    return [
      {name:'Length and width',horizontal:0,vertical:1,width:x,height:y,right:'A',left:'B',top:'C',bottom:'D'},
      {name:'Length and height',horizontal:0,vertical:2,width:x,height:z,right:'A',left:'B',top:'E',bottom:'F'},
      {name:'Width and height',horizontal:1,vertical:2,width:y,height:z,right:'C',left:'D',top:'E',bottom:'F'},
    ].map(view=>({...view,cells:[...new Set(points.map(point=>point[view.horizontal]+view.width*point[view.vertical]))]}));
  },[solid]);
  return <div className="upright-source-diagrams">{projections.map(view=><figure key={view.name}><figcaption>{view.name} · recorded shape</figcaption><svg role="img" aria-label={`${view.name} projection: ${view.left} left, ${view.right} right, ${view.top} top, ${view.bottom} bottom. All heights along the viewing direction are merged.`} viewBox={`-8 -8 ${view.width+16} ${view.height+16}`}>
    {view.cells.map(cell=><rect key={cell} x={cell%view.width} y={view.height-1-Math.floor(cell/view.width)} width="1" height="1" fill="#409573"/>)}
    <g fill="#223d30" fontSize="4" textAnchor="middle"><text x="-4" y={view.height/2}>{view.left}</text><text x={view.width+4} y={view.height/2}>{view.right}</text><text x={view.width/2} y="-3">{view.top}</text><text x={view.width/2} y={view.height+5}>{view.bottom}</text></g>
  </svg></figure>)}<p>Projections merge depth. The labelled ends belong to the recorded shape; the diagrams do not verify hidden surfaces or the real top.</p></div>;
});
