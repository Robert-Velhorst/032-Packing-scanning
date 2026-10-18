import { packingItemForPlacement } from '../packing-forms';
import { useEffect, useRef, useState } from 'react';
import type * as ThreeApi from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PackingPlan, Placement } from '../types';
import { coveredPlacementLabelIds, type ThreeViewContainer, type ThreeViewItem, type ThreeViewPlan } from '../three-view-data';
import { containerBlockedBoxes, containerSpaceError } from '../container-space';
import { placementBoxes,placementSurfaceLocal,shapeKey } from '../packing-geometry';

interface Props {
  container?: ThreeViewContainer;
  plan: ThreeViewPlan;
  items: ThreeViewItem[];
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

export function ThreePackCanvas({ container, plan, items, selectedInstanceId, view, layer, placementLabels }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const selectedInstanceRef = useRef(selectedInstanceId);
  selectedInstanceRef.current = selectedInstanceId;
  const apiRef = useRef<{ camera: ThreeApi.PerspectiveCamera; controls: OrbitControls; renderer: ThreeApi.WebGLRenderer; setSelection: (instanceId?: string) => void } | undefined>(undefined);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !container || view !== '3d') return;
    setStatus('loading');
    let active = true;
    let cleanup: (() => void) | undefined;
    void import('../three-engine').then((THREE) => {
    if (!active) return;
    const OrbitControls = THREE.OrbitControls;
    let renderer: ThreeApi.WebGLRenderer;
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

    const makeBox = (size: [number, number, number], position: [number, number, number], material: ThreeApi.Material, edgeColor?: string) => {
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
    let itemBoxGeometry: ThreeApi.BoxGeometry | undefined;
    let itemBoxEdges: ThreeApi.EdgesGeometry | undefined;
    const itemMaterials = new Map<string, ThreeApi.MeshStandardMaterial>();
    const itemEdgeMaterials = new Map<string, ThreeApi.LineBasicMaterial>();
    const shapeGeometries = new Map<string, { geometry: ThreeApi.BufferGeometry; edges: ThreeApi.EdgesGeometry }>();
    const shapeInstances = new Map<string, { geometry: ThreeApi.BufferGeometry; material: ThreeApi.MeshStandardMaterial; instances: { instanceId: string; position: [number, number, number]; color: string; edges: ThreeApi.EdgesGeometry }[] }>();
    const boxMaterials = new Map<string, ThreeApi.MeshStandardMaterial>();
    const boxInstances = new Map<ThreeApi.MeshStandardMaterial, { boxes: { instanceId: string; size: [number, number, number]; position: [number, number, number]; color: string }[] }>();
    const boxEdgePositions = new Map<string, number[]>();
    const selectionTargets = new Map<string, { setItemSelection?: (selected: boolean) => void; setLabelSelection?: (selected: boolean) => void }>();
    const selectedBoxEdgeMaterial = new THREE.LineBasicMaterial({ color: '#006b3f', transparent: true, opacity: 0.95 });
    let selectedPlacementEdge: ThreeApi.LineSegments | undefined;
    let activeSelection: string | undefined;
    const itemMaterial = (flexibility: string | undefined) => {
      const key = flexibility ?? '';
      let material = itemMaterials.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          vertexColors: true,
          roughness: flexibility === 'rigid' ? 0.72 : 0.93,
          metalness: 0.01,
        });
        itemMaterials.set(key, material);
      }
      return material;
    };
    const boxMaterial = (flexibility: string | undefined) => {
      const key = `${flexibility ?? ''}`;
      let material = boxMaterials.get(key);
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          vertexColors: true,
          roughness: flexibility === 'rigid' ? 0.72 : 0.93,
          metalness: 0.01,
        });
        boxMaterials.set(key, material);
      }
      return material;
    };
    const makeItemBox = (instanceId: string, size: [number, number, number], position: [number, number, number], material: ThreeApi.MeshStandardMaterial, edgeColor: string, color: string) => {
      if (!itemBoxGeometry) {
        itemBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
        itemBoxGeometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(itemBoxGeometry.getAttribute('position').count * 3).fill(1), 3));
      }
      itemBoxEdges ??= new THREE.EdgesGeometry(itemBoxGeometry);
      const batch = boxInstances.get(material) ?? { boxes: [] };
      batch.boxes.push({ instanceId, size, position, color });
      boxInstances.set(material, batch);
      const edgePositions = boxEdgePositions.get(edgeColor) ?? [];
      const vertices = itemBoxEdges.getAttribute('position');
      for (let index = 0; index < vertices.count; index++) {
        edgePositions.push(
          position[0] + vertices.getX(index) * size[0],
          position[1] + vertices.getY(index) * size[1],
          position[2] + vertices.getZ(index) * size[2],
        );
      }
      boxEdgePositions.set(edgeColor, edgePositions);
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
    const coveredLabelIds = coveredPlacementLabelIds(plan.placements, container.id, placementLabels);
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
      let sharedShapeGeometry: { geometry: ThreeApi.BufferGeometry; edges: ThreeApi.EdgesGeometry } | undefined;
      if(item.packingShape){
        const key=`${shapeKey(item.packingShape)}:${placement.rotation??0}`;
        sharedShapeGeometry=shapeGeometries.get(key);
        if(!sharedShapeGeometry){
          const surface=placementSurfaceLocal(placement,item);
          if(surface){
            const geometry=new THREE.BufferGeometry(),positions=new Float32Array(surface.verticesMm.length),indices=new Uint32Array(surface.triangles.length);
            for(let i=0;i<positions.length;i+=3){positions[i]=surface.verticesMm[i]*scale;positions[i+1]=surface.verticesMm[i+2]*scale;positions[i+2]=surface.verticesMm[i+1]*scale;}
            for(let i=0;i<indices.length;i+=3){indices[i]=surface.triangles[i];indices[i+1]=surface.triangles[i+2];indices[i+2]=surface.triangles[i+1];}
            geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeVertexNormals();
            sharedShapeGeometry={geometry,edges:new THREE.EdgesGeometry(geometry)};shapeGeometries.set(key,sharedShapeGeometry);
          }
        }
      }
      if(sharedShapeGeometry){
        const material=itemMaterial(item.flexibility),key=`${shapeKey(item.packingShape)}:${placement.rotation??0}:${item.flexibility??''}`;
        let batch=shapeInstances.get(key);
        if(!batch){batch={geometry:sharedShapeGeometry.geometry,material,instances:[]};shapeInstances.set(key,batch);}
        const position:[number,number,number]=[placement.x*scale,placement.z*scale,placement.y*scale];
        batch.instances.push({instanceId:placement.instanceId,position,color:colors[item.category]??colors.other,edges:sharedShapeGeometry.edges});
        const edgePositions=boxEdgePositions.get('#64756d')??[],vertices=sharedShapeGeometry.edges.getAttribute('position');
        for(let index=0;index<vertices.count;index++)edgePositions.push(position[0]+vertices.getX(index),position[1]+vertices.getY(index),position[2]+vertices.getZ(index));
        boxEdgePositions.set('#64756d',edgePositions);
      }else makeItemBox(
        placement.instanceId,
        [placement.length * scale, placement.height * scale, placement.width * scale],
        [(placement.x + placement.length / 2) * scale, (placement.z + placement.height / 2) * scale, (placement.y + placement.width / 2) * scale],
        boxMaterial(item.flexibility),
        '#64756d',
        colors[item.category] ?? colors.other,
      );
      const number = placementLabels?.[placement.instanceId];
      if (number) {
        const labelBox=placementBoxes(placement,item).reduce((best,b)=>b.length*b.width>best.length*best.width?b:best);
        const visibleWithoutSelection = !coveredLabelIds.has(placement.instanceId);
        let marker: ThreeApi.Sprite | undefined;
        let drawing: CanvasRenderingContext2D | null | undefined;
        let texture: ThreeApi.CanvasTexture | undefined;
        const updateLabel = (selected: boolean) => {
          if (!visibleWithoutSelection && !selected) {
            if (marker) {
              scene.remove(marker);
              marker.material.map?.dispose();
              marker.material.dispose();
              marker = undefined;
              drawing = undefined;
              texture = undefined;
            }
            return;
          }
          if (!marker) {
            const labelCanvas = document.createElement('canvas'); labelCanvas.width = labelCanvas.height = 96;
            drawing = labelCanvas.getContext('2d');
            if (!drawing) return;
            texture = new THREE.CanvasTexture(labelCanvas);
            marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
            const size = Math.min(length, width) * 0.15;
            marker.position.set((labelBox.x + labelBox.length / 2) * scale, (labelBox.z + labelBox.height) * scale + size / 2, (labelBox.y + labelBox.width / 2) * scale);
            marker.scale.set(size, size, 1); marker.renderOrder = 4; scene.add(marker);
          }
          if (!drawing || !texture) return;
          drawing.clearRect(0, 0, 96, 96);
          drawing.fillStyle = '#fff'; drawing.strokeStyle = '#172a20'; drawing.lineWidth = selected ? 9 : 3.75;
          drawing.beginPath(); drawing.arc(48, 48, 40.5, 0, Math.PI * 2); drawing.fill(); drawing.stroke();
          drawing.fillStyle = '#172a20'; drawing.font = 'bold 48px sans-serif'; drawing.textAlign = 'center'; drawing.textBaseline = 'middle'; drawing.fillText(number, 48, 49.5, 72);
          texture.needsUpdate = true;
        };
        updateLabel(false);
        const target = selectionTargets.get(placement.instanceId) ?? {};
        target.setLabelSelection = updateLabel;
        selectionTargets.set(placement.instanceId, target);
      }
    }

    const matrix = new THREE.Matrix4(), instancePosition = new THREE.Vector3(), instanceScale = new THREE.Vector3(), instanceRotation = new THREE.Quaternion(), instanceColor = new THREE.Color();
    for(const batch of shapeInstances.values()){
      const mesh=new THREE.InstancedMesh(batch.geometry,batch.material,batch.instances.length);
      batch.instances.forEach((instance,index)=>{
        instancePosition.set(...instance.position);instanceScale.set(1,1,1);matrix.compose(instancePosition,instanceRotation,instanceScale);mesh.setMatrixAt(index,matrix);
        mesh.setColorAt(index,instanceColor.set(instance.color));
      });
      mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;scene.add(mesh);
      batch.instances.forEach((instance,index)=>{
        const target=selectionTargets.get(instance.instanceId)??{};
        target.setItemSelection=selected=>{
          mesh.setColorAt(index,instanceColor.set(selected?'#348665':instance.color));if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
          if(selected){
            if(selectedPlacementEdge)scene.remove(selectedPlacementEdge);
            selectedPlacementEdge=new THREE.LineSegments(instance.edges,selectedBoxEdgeMaterial);selectedPlacementEdge.position.set(...instance.position);selectedPlacementEdge.renderOrder=3;scene.add(selectedPlacementEdge);
          }else if(selectedPlacementEdge){scene.remove(selectedPlacementEdge);selectedPlacementEdge=undefined;}
        };
        selectionTargets.set(instance.instanceId,target);
      });
    }
    for (const [material, batch] of boxInstances) {
      const mesh = new THREE.InstancedMesh(itemBoxGeometry!, material, batch.boxes.length);
      batch.boxes.forEach((box,index) => {
        instancePosition.set(...box.position);
        instanceScale.set(...box.size);
        matrix.compose(instancePosition,instanceRotation,instanceScale);
        mesh.setMatrixAt(index,matrix);
        mesh.setColorAt(index,instanceColor.set(box.color));
      });
      mesh.instanceMatrix.needsUpdate=true;
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
      mesh.castShadow=true;
      scene.add(mesh);
      batch.boxes.forEach((box,index)=>{
        const target=selectionTargets.get(box.instanceId)??{};
        target.setItemSelection=selected=>{
          mesh.setColorAt(index,instanceColor.set(selected?'#348665':box.color));
          if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
          if(selected){
            if(selectedPlacementEdge)scene.remove(selectedPlacementEdge);
            if(itemBoxEdges){
              selectedPlacementEdge=new THREE.LineSegments(itemBoxEdges,selectedBoxEdgeMaterial);
              selectedPlacementEdge.position.set(...box.position);selectedPlacementEdge.scale.set(...box.size);selectedPlacementEdge.renderOrder=3;scene.add(selectedPlacementEdge);
            }
          }else if(selectedPlacementEdge){scene.remove(selectedPlacementEdge);selectedPlacementEdge=undefined;}
        };
        selectionTargets.set(box.instanceId,target);
      });
    }
    for (const [edgeColor,positions] of boxEdgePositions) {
      let material=itemEdgeMaterials.get(edgeColor);
      if(!material){material=new THREE.LineBasicMaterial({color:edgeColor,transparent:true,opacity:.75});itemEdgeMaterials.set(edgeColor,material);}
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      const edges=new THREE.LineSegments(geometry,material);edges.renderOrder=2;scene.add(edges);
    }
    // The scene and selection callbacks now own what they need. Drop setup
    // maps, especially the JS edge arrays copied into GPU buffers above.
    itemLookup.clear();itemMaterials.clear();itemEdgeMaterials.clear();boxMaterials.clear();
    shapeGeometries.clear();shapeInstances.clear();boxInstances.clear();boxEdgePositions.clear();
    const setSelection=(instanceId?:string)=>{
      if(activeSelection===instanceId)return;
      if(activeSelection){const previous=selectionTargets.get(activeSelection);previous?.setItemSelection?.(false);previous?.setLabelSelection?.(false);}
      activeSelection=instanceId;
      if(instanceId){const next=selectionTargets.get(instanceId);next?.setItemSelection?.(true);next?.setLabelSelection?.(true);}
      renderer.render(scene,camera);
    };
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

    apiRef.current = { camera, controls, renderer, setSelection };
    setSelection(selectedInstanceRef.current);
    cleanup = () => {
      observer.disconnect();
      controls.dispose();
      const geometries = new Set<ThreeApi.BufferGeometry>(), materials = new Set<ThreeApi.Material>(), textures = new Set<ThreeApi.Texture>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          if (!geometries.has(object.geometry)) { geometries.add(object.geometry); object.geometry.dispose(); }
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          mats.forEach((material) => { if (!materials.has(material)) { materials.add(material); material.dispose(); } });
        }
        if (object instanceof THREE.Sprite) {
          const texture = object.material.map;
          if (texture && !textures.has(texture)) { textures.add(texture); texture.dispose(); }
          if (!materials.has(object.material)) { materials.add(object.material); object.material.dispose(); }
        }
      });
      if(itemBoxEdges&&!geometries.has(itemBoxEdges))itemBoxEdges.dispose();
      if(!materials.has(selectedBoxEdgeMaterial))selectedBoxEdgeMaterial.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', resizeAfterRestore);
      renderer.dispose();
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss();
      renderer.domElement.remove();
      apiRef.current = undefined;
    };
    }).catch(() => {
      if (!active || !host) return;
      host.dataset.webgl = 'unavailable';
      setStatus('unavailable');
    });
    return () => { active = false; cleanup?.(); };
  }, [container, plan, items, view, layer, placementLabels]);

  useEffect(() => { apiRef.current?.setSelection(selectedInstanceId); }, [selectedInstanceId]);

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
    </div>
  );

  function rotate(angle: number) {
    const api = apiRef.current; if (!api) return;
    const dx = api.camera.position.x - api.controls.target.x;
    const dz = api.camera.position.z - api.controls.target.z;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    api.camera.position.set(api.controls.target.x + dx * cos - dz * sin, api.camera.position.y, api.controls.target.z + dx * sin + dz * cos);
    api.controls.update();
  }
  function zoom(factor: number) {
    const api = apiRef.current; if (!api) return;
    const dx = api.camera.position.x - api.controls.target.x;
    const dy = api.camera.position.y - api.controls.target.y;
    const dz = api.camera.position.z - api.controls.target.z;
    const distance = Math.max(api.controls.minDistance, Math.min(api.controls.maxDistance, Math.hypot(dx, dy, dz) * factor));
    const scale = distance / Math.hypot(dx, dy, dz);
    api.camera.position.set(api.controls.target.x + dx * scale, api.controls.target.y + dy * scale, api.controls.target.z + dz * scale);
    api.controls.update();
  }
}

export function selectedPlacement(plan: PackingPlan, instanceId?: string): Placement | undefined {
  return instanceId ? plan.placements.find((placement) => placement.instanceId === instanceId) : undefined;
}
