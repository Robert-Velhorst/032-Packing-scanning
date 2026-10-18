import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useEffect, useRef, useState } from 'react';
import type { ReconstructedGeometry } from '../scanning/reconstructed-solid';
import type { SavedGeometryPreview } from '../scanning/saved-geometry';

export function ScanCloudCanvas({preview,reconstruction}:{preview:SavedGeometryPreview;reconstruction?:ReconstructedGeometry}) {
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
    let frame=0,disposed=false;
    const draw=()=>{frame=0;if(disposed||renderer.getContext().isContextLost())return;const moving=controls.update();renderer.render(scene,camera);if(controls.enableDamping&&moving)scheduleDraw();};
    const scheduleDraw=()=>{if(!disposed&&!frame)frame=requestAnimationFrame(draw);};
    const resize=()=>{const width=host.clientWidth,height=host.clientHeight;if(width&&height){renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();scheduleDraw();}};
    const observer=new ResizeObserver(resize);observer.observe(host);resize();
    const changed=()=>scheduleDraw(),lost=(event:Event)=>{event.preventDefault();setState('unavailable');},restored=()=>{resize();setState('ready');scheduleDraw();};
    renderer.domElement.addEventListener('webglcontextlost',lost);renderer.domElement.addEventListener('webglcontextrestored',restored);
    controls.addEventListener('change',changed);scheduleDraw();setState('ready');
    return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();controls.removeEventListener('change',changed);controls.dispose();geometry.dispose();material.dispose();box.dispose();edges.dispose();lineMaterial.dispose();renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.domElement.removeEventListener('webglcontextrestored',restored);if(!renderer.getContext().isContextLost())renderer.forceContextLoss();renderer.dispose();renderer.domElement.remove();api.current=undefined;};
  },[preview,reconstruction]);
  const rotate=(direction:number)=>{const current=api.current;if(!current)return;const offset=current.camera.position.clone().sub(current.controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),direction*Math.PI/8);current.camera.position.copy(current.controls.target).add(offset);current.controls.update();};
  const zoom=(factor:number)=>{const current=api.current;if(!current)return;const offset=current.camera.position.clone().sub(current.controls.target);const distance=Math.max(current.controls.minDistance,Math.min(current.controls.maxDistance,offset.length()*factor));offset.setLength(distance);current.camera.position.copy(current.controls.target).add(offset);current.controls.update();};
  return <div className="scan-cloud-view"><div className="scan-cloud-surface" ref={hostRef} data-webgl={state} aria-label={reconstruction?"Rotatable reconstructed estimated surface":"Rotatable original scan geometry"}/>{state==='unavailable'&&<p role="status">The 3D view is unavailable. Open the top view and source details below.</p>}<div className="scan-cloud-controls"><button type="button" disabled={state!=='ready'} onClick={()=>rotate(-1)}>Rotate scan left</button><button type="button" disabled={state!=='ready'} onClick={()=>rotate(1)}>Rotate scan right</button><button type="button" disabled={state!=='ready'} onClick={()=>zoom(.8)}>Zoom scan in</button><button type="button" disabled={state!=='ready'} onClick={()=>zoom(1.25)}>Zoom scan out</button><button type="button" disabled={state!=='ready'} onClick={()=>api.current?.controls.reset()}>Reset scan view</button></div></div>;
}
