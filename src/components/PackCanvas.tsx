import { useEffect, useRef, useState } from 'react';
import type { Container, LibraryItem, PackingPlan } from '../types';
import { ContainerSpaceNotes } from './ContainerSpaceNotes';
import { PackingDiagram } from './PackingDiagram';

interface Props {
  container?: Container;
  plan: PackingPlan;
  items: LibraryItem[];
  selectedInstanceId?: string;
  view: 'top' | '3d' | 'layers';
  layer?: number;
  placementLabels?: Record<string, string>;
}

export function PackCanvas({ container, plan, items, selectedInstanceId, view, layer, placementLabels }: Props) {
  if (view === '3d') {
    return <ThreePackFrame container={container} plan={plan} items={items} selectedInstanceId={selectedInstanceId} placementLabels={placementLabels}/>;
  }

  if (!container) return <div className="pack-canvas"><div className="canvas-empty">Add a bag to see a packing model.</div></div>;

  const placements = plan.placements.filter((placement) =>
    placement.containerId === container.id && (view !== 'layers' || placement.layer === layer));
  const numbers = Object.fromEntries(placements.map((placement, index) => [placement.instanceId, String(index + 1)]));

  return <PackingDiagram
    bag={container}
    placements={placements}
    currentId={selectedInstanceId ?? ''}
    numbers={numbers}
    items={items}
  />;
}

function ThreePackFrame({ container, plan, items, selectedInstanceId, placementLabels }: Omit<Props, 'view' | 'layer'>) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    if (!frameLoaded) return;
    frameRef.current?.contentWindow?.postMessage({
      type: 'packing-scanning:render',
      container,
      plan,
      items,
      selectedInstanceId,
      placementLabels,
    }, location.origin);
  }, [frameLoaded, container, plan, items, selectedInstanceId, placementLabels]);

  return <div className="packing-viewer">
    <div className="pack-canvas">
      <iframe
        ref={frameRef}
        className="three-pack-frame"
        title={`Interactive 3D packing model for ${container?.name ?? 'your bag'}`}
        src="/three/three-view.html"
        onLoad={() => setFrameLoaded(true)}
      />
      {!frameLoaded && <div className="canvas-empty" role="status">Opening the 3D view…</div>}
    </div>
    {container && <ContainerSpaceNotes bag={container}/>}
  </div>;
}
