import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const itemCount = Number(value('items', '500'));
const runs = Number(value('runs', '7'));
const iterations = Number(value('iterations', '250'));
if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 500) throw new Error('Use --items= with a count from 1 to 500.');
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use --runs= with a count from 1 to 10.');
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw new Error('Use --iterations= with a count from 1 to 1000.');

const vite = await createServer({
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { createInitialData } = await vite.ssrLoadModule('/src/seed.ts');
  const { sameThreeViewData, threeViewData } = await vite.ssrLoadModule('/src/three-view-data.ts');
  const seed = createInitialData();
  await vite.watcher.close();
  const container = seed.containers[0];
  const items = Array.from({ length: itemCount }, (_, index) => ({
    ...seed.libraryItems[0], id: `three-view-item-${index}`, name: `Three view item ${index}`, category: 'other',
  }));
  const placements = items.map((item, index) => ({
    instanceId: `three-view-instance-${index}`, entryId: `three-view-entry-${index}`,
    itemId: item.id, containerId: container.id,
    x: index % 100, y: Math.floor(index / 100), z: 0,
    length: 20, width: 20, height: 10, layer: 1, rotation: 0,
  }));
  const initial = threeViewData(container, { placements }, items);
  const updatedContainer = { ...container, massLimitGrams: (container.massLimitGrams ?? 0) + 1 };
  const updatedPlan = { placements: placements.map((placement) => ({ ...placement })) };
  const updatedItems = items.map((item) => ({ ...item, photoId: 'updated-photo' }));
  const fingerprint = (view) => createHash('sha256').update(JSON.stringify({
    placements: view.plan.placements.map(({ instanceId, itemId, containerId, x, y, z, length, width, height, rotation, packingFormId, packingFormKey }) =>
      [instanceId, itemId, containerId, x, y, z, length, width, height, rotation, packingFormId, packingFormKey]),
    items: view.items.map(({ id, category, flexibility, packingShape, packingForms }) => [id, category, flexibility, packingShape, packingForms]),
  })).digest('hex');
  const expectedFingerprint = fingerprint(initial);
  const projectUpdated = () => threeViewData(updatedContainer, updatedPlan, updatedItems);
  const checkUpdated = () => {
    const next = projectUpdated();
    if (!sameThreeViewData(initial, next)) throw new Error('A metadata-only update changed the selected 3D render inputs.');
    return next;
  };
  const verifiedUpdate = checkUpdated();
  if (fingerprint(verifiedUpdate) !== expectedFingerprint) throw new Error('A metadata-only update changed the render fingerprint.');

  for (let warmup = 0; warmup < 3; warmup++) {
    for (let index = 0; index < 10; index++) checkUpdated();
    for (let index = 0; index < 10; index++) structuredClone(projectUpdated());
  }
  const guardedSamplesMs = [], cloneSamplesMs = [];
  for (let run = 0; run < runs; run++) {
    let start = performance.now();
    for (let index = 0; index < iterations; index++) checkUpdated();
    guardedSamplesMs.push((performance.now() - start) / iterations);
    start = performance.now();
    for (let index = 0; index < iterations; index++) structuredClone(projectUpdated());
    cloneSamplesMs.push((performance.now() - start) / iterations);
  }
  const median = (samples) => [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)];
  const messageBytes = Buffer.byteLength(JSON.stringify(projectUpdated()));
  const guardedMedianMs = median(guardedSamplesMs), cloneMedianMs = median(cloneSamplesMs);
  console.log(JSON.stringify({
    operation: 'metadata-only 3D iframe update projection and clone avoidance',
    fixture: 'Synthetic item and placement records; not a physical packing or browser/WebGL benchmark.',
    itemCount,
    placementCount: initial.plan.placements.length,
    serializedMessageBytes: messageBytes,
    runs,
    iterationsPerRun: iterations,
    guardedProjectionMedianMs: guardedMedianMs,
    projectionAndStructuredCloneMedianMs: cloneMedianMs,
    estimatedStructuredCloneTimeAvoidedPercent: cloneMedianMs > 0 ? (1 - guardedMedianMs / cloneMedianMs) * 100 : 0,
    placementAndRenderFingerprint: expectedFingerprint,
    guardedSamplesMs,
    cloneSamplesMs,
  }, null, 2));
} finally {
  await vite.close();
}
