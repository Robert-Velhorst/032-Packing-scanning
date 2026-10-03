import { packingItemForPlacement } from '../packing-forms';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Container, LibraryItem, PackingPlan, Placement } from '../types';
import { containerBlockedBoxes, containerSpaceError } from '../container-space';
import { ContainerSpaceNotes } from './ContainerSpaceNotes';
import { placementBoxes,placementSurface } from '../packing-geometry';

interface Props {
  container?: Container;
  plan: PackingPlan;
  items: LibraryItem[];
  selectedInstanceId?: string;
  view: 'top' | '3d' | 'layers';
  layer?: number;
  placementLabels?: Record<string, string>;
}

const colors: Record<string, string> = {
  clothing: '#a8c7dc',
  footwear: '#d3c3aa',
  electronics: '#9aabb7',
  toiletries: '#b8cdbf',
  medicine: '#e5d7bb',
  documents: '#d4d7d8',
  accessories: '#c4bbd2',
  other: '#c7d2c9',
};

export function PackCanvas({ container, plan, items, selectedInstanceId, view, layer, placementLabels }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const apiRef = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls; renderer: THREE.WebGLRenderer } | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !container) return;
    setStatus('loading');
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      host.dataset.webgl = 'unavailable';
      setStatus('unavailable');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor('#ffffff', 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);
    host.dataset.webgl = 'ready';
    const contextLost = () => { host.dataset.webgl = 'unavailable'; setStatus('unavailable'); };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', resizeAfterRestore);
    function resizeAfterRestore() { host!.dataset.webgl = 'ready'; setStatus('ready'); resize(); }

    const scene = new THREE.Scene();
    const length = container.inside.length / 100;
    const width = container.inside.width / 100;
    const height = container.inside.height / 100;
    const scale = 0.01;
    const target = new THREE.Vector3(length / 2, height * 0.45, width * 0.82);
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
    camera.up.set(0, 1, 0);
    const cameraDistance = Math.max(length, width, height + width * 0.55) * 3.2;
    camera.position.set(target.x + cameraDistance * 0.48, target.y + cameraDistance * 0.66, target.z + cameraDistance * 0.58);

    const ambient = new THREE.HemisphereLight('#ffffff', '#dce5df', 2.0);
    scene.add(ambient);
    const key = new THREE.DirectionalLight('#ffffff', 2.5);
    key.position.set(-length, height * 4, width * 1.4);
    scene.add(key);

    const makeBox = (size: [number, number, number], position: [number, number, number], material: THREE.Material, edgeColor?: string) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
      mesh.position.set(...position);
      mesh.castShadow = true;
      scene.add(mesh);
      if (edgeColor) {
        const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: edgeColor, transparent: true, opacity: 0.75 }));
        edge.position.copy(mesh.position);
        edge.renderOrder = 2;
        scene.add(edge);
      }
      return mesh;
    };

    const caseMaterial = new THREE.MeshStandardMaterial({ color: '#27332d', roughness: 0.78, metalness: 0.04, transparent: true, opacity: 0.3, side: THREE.DoubleSide,depthWrite:false });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: '#35433c', roughness: 0.9, metalness: 0.03 });
    const floorMaterial = new THREE.MeshStandardMaterial({ color: '#ebefec', roughness: 0.92 });
    const wall = Math.max(0.055, Math.min(length, width) * 0.025);
    makeBox([length, wall, width], [length / 2, -wall / 2, width / 2], darkMaterial, '#63746a');
    makeBox([wall, height * 0.78, width], [-wall / 2, height * 0.39, width / 2], caseMaterial, '#68786f');
    makeBox([wall, height * 0.78, width], [length + wall / 2, height * 0.39, width / 2], caseMaterial, '#68786f');
    makeBox([length, height * 0.78, wall], [length / 2, height * 0.39, -wall / 2], caseMaterial, '#68786f');
    makeBox([length, height * 0.78, wall], [length / 2, height * 0.39, width + wall / 2], caseMaterial, '#68786f');
    makeBox([length - wall * 2, 0.008, width - wall * 2], [length / 2, 0.008, width / 2], floorMaterial, '#c8d0cb');

    const hinge = new THREE.MeshStandardMaterial({ color: '#d5dfd9', roughness: 0.88 });
    makeBox([length, wall, width], [length / 2, -wall / 2, width + 0.18], darkMaterial, '#63746a');
    makeBox([length, 0.045, width], [length / 2, 0.04, width + width * 0.55], hinge, '#87958d');
    for (let x = 0.12; x < length - 0.08; x += Math.max(0.26, length / 6)) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.006, width * 0.46), new THREE.MeshStandardMaterial({ color: '#a4b0a9', roughness: 1 }));
      line.position.set(x, 0.068, width + width * 0.55);
      scene.add(line);
    }

    const itemLookup = new Map(items.map((item) => [item.id, item]));
    if(!containerSpaceError(container)){
      const reserved=new THREE.MeshStandardMaterial({color:'#d7a24d',roughness:.9,transparent:true,opacity:.25,depthWrite:false});
      const blockedBoxes=containerBlockedBoxes(container);
      for(const blocked of blockedBoxes)makeBox([blocked.length*scale,blocked.height*scale,blocked.width*scale],[(blocked.x+blocked.length/2)*scale,(blocked.z+blocked.height/2)*scale,(blocked.y+blocked.width/2)*scale],reserved,'#9b641d');
      for(const c of container.compartments??[]){
        const geometry=new THREE.BoxGeometry(c.length*scale,c.height*scale,c.width*scale);
        const outline=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineDashedMaterial({color:'#185c8b',dashSize:.08,gapSize:.04}));
        geometry.dispose();outline.position.set((c.x+c.length/2)*scale,(c.z+c.height/2)*scale,(c.y+c.width/2)*scale);outline.computeLineDistances();outline.renderOrder=3;scene.add(outline);
      }
      const lid=container.lidClearanceMm??0;
      if(lid>0)makeBox([length,lid*scale,width],[length/2,height-lid*scale/2,width/2],reserved,'#9b641d');
      if(!blockedBoxes.length&&!lid)reserved.dispose();
    }
    {
      const corner = new THREE.Mesh(new THREE.SphereGeometry(Math.min(length, width) * 0.018, 12, 8), new THREE.MeshBasicMaterial({ color: '#172a20', depthTest: false }));
      corner.position.set(0, 0, 0); corner.renderOrder = 5; scene.add(corner);
    }
    for (const placement of plan.placements) {
      if (placement.containerId !== container.id) continue;
      const item = packingItemForPlacement(itemLookup.get(placement.itemId),placement);
      if (!item) continue;
      const isSelected = selectedInstanceId === placement.instanceId;
      const isInFutureLayer = view === 'layers' && layer !== undefined && placement.layer > layer;
      const material = new THREE.MeshStandardMaterial({
        color: isSelected ? '#348665' : colors[item.category] ?? colors.other,
        roughness: item.flexibility === 'rigid' ? 0.72 : 0.93,
        metalness: 0.01,
        transparent: isInFutureLayer,
        opacity: isInFutureLayer ? 0.16 : 1,
        emissive: isSelected ? '#12452f' : '#000000',
        emissiveIntensity: isSelected ? 0.2 : 0,
      });
      const surface=placementSurface(placement,item);
      if(surface){
        const geometry=new THREE.BufferGeometry(),positions=new Float32Array(surface.verticesMm.length),indices=new Uint32Array(surface.triangles.length);
        for(let i=0;i<positions.length;i+=3){positions[i]=surface.verticesMm[i]*scale;positions[i+1]=surface.verticesMm[i+2]*scale;positions[i+2]=surface.verticesMm[i+1]*scale;}
        for(let i=0;i<indices.length;i+=3){indices[i]=surface.triangles[i];indices[i+1]=surface.triangles[i+2];indices[i+2]=surface.triangles[i+1];}
        geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();
        const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
        const edges=new THREE.LineSegments(new THREE.EdgesGeometry(geometry),new THREE.LineBasicMaterial({color:isSelected?'#006b3f':'#64756d',transparent:true,opacity:.75}));edges.renderOrder=2;scene.add(edges);
      }else makeBox(
        [placement.length * scale, placement.height * scale, placement.width * scale],
        [(placement.x + placement.length / 2) * scale, (placement.z + placement.height / 2) * scale, (placement.y + placement.width / 2) * scale],
        material,
        isSelected ? '#006b3f' : '#64756d',
      );
      const number = placementLabels?.[placement.instanceId];
      const labelBox=placementBoxes(placement,item).reduce((best,b)=>b.length*b.width>best.length*best.width?b:best);
      const covered = plan.placements.some((other) => other.instanceId !== placement.instanceId && other.containerId === placement.containerId
        && other.z >= placement.z + placement.height - 0.01 && other.x <= placement.x + placement.length / 2
        && other.x + other.length >= placement.x + placement.length / 2 && other.y <= placement.y + placement.width / 2
        && other.y + other.width >= placement.y + placement.width / 2);
      if (number && (isSelected || !covered)) {
        const labelCanvas = document.createElement('canvas'); labelCanvas.width = labelCanvas.height = 128;
        const drawing = labelCanvas.getContext('2d');
        if (drawing) {
          drawing.fillStyle = '#fff'; drawing.strokeStyle = '#172a20'; drawing.lineWidth = isSelected ? 12 : 5;
          drawing.beginPath(); drawing.arc(64, 64, 54, 0, Math.PI * 2); drawing.fill(); drawing.stroke();
          drawing.fillStyle = '#172a20'; drawing.font = 'bold 64px sans-serif'; drawing.textAlign = 'center'; drawing.textBaseline = 'middle'; drawing.fillText(number, 64, 66, 96);
          const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(labelCanvas), depthTest: false }));
          const size = Math.min(length, width) * 0.15;
          marker.position.set((labelBox.x + labelBox.length / 2) * scale, (labelBox.z + labelBox.height) * scale + size / 2, (labelBox.y + labelBox.width / 2) * scale);
          marker.scale.set(size, size, 1); marker.renderOrder = 4; scene.add(marker);
        }
      }
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    controls.update();
    controls.saveState();
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = Math.min(length, width) * 0.8;
    controls.maxDistance = Math.max(length, width) * 5;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.addEventListener('change', () => renderer.render(scene, camera));

    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      const aspect = host.clientWidth / host.clientHeight;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    setStatus('ready');

    apiRef.current = { camera, controls, renderer };
    return () => {
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          mats.forEach((material) => material.dispose());
        }
        if (object instanceof THREE.Sprite) { object.material.map?.dispose(); object.material.dispose(); }
      });
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', resizeAfterRestore);
      renderer.dispose();
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      renderer.domElement.remove();
      apiRef.current = undefined;
    };
  }, [container, plan, items, selectedInstanceId, view, layer, placementLabels]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api || !container || view !== 'top') return;
    const length = container.inside.length / 100;
    const width = container.inside.width / 100;
    const height = container.inside.height / 100;
    api.camera.position.set(length / 2, height * 4.7 + width * 1.6, width / 2);
    api.camera.lookAt(length / 2, 0, width / 2);
    api.controls.target.set(length / 2, height * 0.2, width / 2);
    api.controls.update();
    api.controls.saveState();
  }, [container, view]);

  return (
    <div className="packing-viewer">
    <div className="pack-canvas" role="img" aria-label={container ? `Interactive geometric packing model for ${container.name}. Numbered shapes are planned positions. Drag to rotate or use the view buttons below.` : 'Add a bag to see a packing model.'}>
      <div className="pack-canvas-surface" ref={hostRef}/>
      {!container && <div className="canvas-empty">Add a bag to see a packing model.</div>}
      {container && status === 'unavailable' && <div className="canvas-empty" role="status">The 3D view is unavailable. Follow the written positions and top-view diagram instead.</div>}
      {container && status === 'loading' && <div className="canvas-empty" role="status">Opening the 3D view…</div>}
      {status === 'ready' && <div className="canvas-hint" aria-hidden="true">Drag to rotate · Scroll to zoom</div>}
    </div>
    {container && status === 'ready' && <div className="model-controls" aria-label="3D view controls"><button type="button" onClick={() => rotate(-Math.PI / 6)}>Rotate left</button><button type="button" onClick={() => rotate(Math.PI / 6)}>Rotate right</button><button type="button" onClick={() => zoom(0.85)}>Zoom in</button><button type="button" onClick={() => zoom(1.15)}>Zoom out</button><button type="button" onClick={() => apiRef.current?.controls.reset()}>Reset view</button></div>}
    {container&&<ContainerSpaceNotes bag={container}/>}
    </div>
  );

  function rotate(angle: number) {
    const api = apiRef.current; if (!api) return;
    const offset = api.camera.position.clone().sub(api.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    api.camera.position.copy(api.controls.target).add(offset); api.controls.update();
  }
  function zoom(factor: number) {
    const api = apiRef.current; if (!api) return;
    const offset = api.camera.position.clone().sub(api.controls.target);
    offset.setLength(Math.max(api.controls.minDistance, Math.min(api.controls.maxDistance, offset.length() * factor)));
    api.camera.position.copy(api.controls.target).add(offset); api.controls.update();
  }
}

export function selectedPlacement(plan: PackingPlan, instanceId?: string): Placement | undefined {
  return instanceId ? plan.placements.find((placement) => placement.instanceId === instanceId) : undefined;
}
