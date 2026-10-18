import { lazy, Suspense } from 'react';
import { DeviceWorkspace } from './components/DeviceWorkspace';
import { loadPackingApp } from './packing-app-loader';

const PackingApp = lazy(() => loadPackingApp().then((module) => ({ default: module.PackingApp })));

export function App() {
  return (
    <DeviceWorkspace>
      <Suspense fallback={<div className="boot-screen" role="status"><div className="brand-mark">P</div><p>Opening your packing space…</p></div>}>
        <PackingApp />
      </Suspense>
    </DeviceWorkspace>
  );
}
