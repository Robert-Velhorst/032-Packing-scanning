import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThreePackCanvas } from './components/ThreePackCanvas';
import './three-view.css';

const root = createRoot(document.getElementById('root')!);
type RenderData = Omit<Parameters<typeof ThreePackCanvas>[0], 'view'>;
let currentRender: RenderData | undefined;

window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (!event.data) return;

  if (event.data.type === 'packing-scanning:selection') {
    if (!currentRender) return;
    currentRender = { ...currentRender, selectedInstanceId: event.data.selectedInstanceId };
    root.render(<StrictMode><ThreePackCanvas {...currentRender} view="3d"/></StrictMode>);
    return;
  }
  if (event.data.type !== 'packing-scanning:render') return;

  const { container, plan, items, selectedInstanceId, placementLabels } = event.data;
  currentRender = { container, plan, items, selectedInstanceId, placementLabels };
  root.render(<StrictMode><ThreePackCanvas {...currentRender} view="3d"/></StrictMode>);
  window.parent.postMessage({ type: 'packing-scanning:ready' }, location.origin);
});
