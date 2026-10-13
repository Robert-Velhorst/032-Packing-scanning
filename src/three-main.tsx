import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThreePackCanvas } from './components/ThreePackCanvas';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

window.addEventListener('message', (event: MessageEvent) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  if (!event.data || event.data.type !== 'packing-scanning:render') return;

  const { container, plan, items, selectedInstanceId, placementLabels } = event.data;
  root.render(<StrictMode><ThreePackCanvas
    container={container}
    plan={plan}
    items={items}
    selectedInstanceId={selectedInstanceId}
    placementLabels={placementLabels}
    view="3d"
  /></StrictMode>);
  window.parent.postMessage({ type: 'packing-scanning:ready' }, location.origin);
});
