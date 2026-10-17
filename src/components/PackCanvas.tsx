import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Container, LibraryItem, PackingPlan } from '../types';
import { threeViewData } from '../three-view-data';
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

export const PackCanvas = memo(function PackCanvas({ container, plan, items, selectedInstanceId, view, layer, placementLabels }: Props) {
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
});

function ThreePackFrame({ container, plan, items, selectedInstanceId, placementLabels }: Omit<Props, 'view' | 'layer'>) {
  const viewData = useMemo(() => threeViewData(container?.id, plan, items), [container?.id, plan.placements, items]);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    const target = viewportRef.current;
    if (!target) return;
    if (!('IntersectionObserver' in window)) { setShouldLoad(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '160px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!frameLoaded) return;
    frameRef.current?.contentWindow?.postMessage({
      type: 'packing-scanning:render',
      container,
      plan: viewData.plan,
      items: viewData.items,
      selectedInstanceId,
      placementLabels,
    }, location.origin);
  }, [frameLoaded, container, viewData, selectedInstanceId, placementLabels]);

  return <div className="packing-viewer">
    <div className="pack-canvas" ref={viewportRef}>
      {shouldLoad && <iframe
        ref={frameRef}
        className="three-pack-frame"
        title={`Interactive 3D packing model for ${container?.name ?? 'your bag'}`}
        src="/three/three-view.html"
        onLoad={() => setFrameLoaded(true)}
      />}
      {!frameLoaded && <div className="canvas-empty" role="status">{shouldLoad ? 'Opening the 3D view…' : 'The 3D view will load when you reach it.'}</div>}
    </div>
    {container && <ContainerSpaceNotes bag={container}/>}
  </div>;
}
