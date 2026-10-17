import { lazy, Suspense } from 'react';
import { DeviceWorkspace } from './components/DeviceWorkspace';

const PackingApp = lazy(() => import('./PackingApp').then((module) => ({ default: module.PackingApp })));

export function App() {
  return (
    <DeviceWorkspace>
      <Suspense fallback={<div className="boot-screen" role="status"><div className="brand-mark">P</div><p>Opening your packing space…</p></div>}>
        <PackingApp />
      </Suspense>
    </DeviceWorkspace>
  );
}