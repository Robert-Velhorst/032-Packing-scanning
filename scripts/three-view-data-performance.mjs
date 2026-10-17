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
  const { coveredPlacementLabelIds, sameThreeViewData, threeViewData } = await vite.ssrLoadModule('/src/three-view-data.ts');
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
  const coverPlacements = Array.from({ length: itemCount }, (_, index) => ({
    instanceId: `cover-instance-${index}`, itemId: `cover-item-${index}`, containerId: container.id,
    x: index % 10 * 22, y: Math.floor(index / 10) % 10 * 22, z: Math.floor(index / 100) * 10,
    length: 20, width: 20, height: 10, layer: 1, rotation: 0,
  }));
  const initial = threeViewData(container, { placements }, items);
  const updatedContainer = {
    ...container,
    massLimitGrams: (container.massLimitGrams ?? 0) + 1,
    scan: {
      id: 'three-view-bag-scan', target: 'container_interior', createdAt: '2026-01-01T00:00:00.000Z',
      platform: 'android', method: 'arcore_depth', completedPasses: 4, modelStoredLocally: true,
      geometry: { format: 'ply_point_cloud', units: 'metres', coordinateFrame: 'capture_local_right_handed', pointCount: 20000 },
    },
  };
  const updatedPlan = { placements: placements.map((placement) => ({ ...placement })) };
  const updatedItems = items.map((item, index) => ({
    ...item,
    photoId: `updated-photo-${index}`,
    massGrams: 250 + index,
    scan: {
      id: `three-view-item-scan-${index}`, target: 'item', createdAt: '2026-01-01T00:00:00.000Z',
      platform: 'android', method: 'guided_object_capture', completedPasses: 4, modelStoredLocally: true,
      geometry: { format: 'ply_point_cloud', units: 'metres', coordinateFrame: 'capture_local_right_handed', pointCount: 12000 },
    },
  }));
  const fingerprint = (view) => createHash('sha256').update(JSON.stringify({
    placements: view.plan.placements.map(({ instanceId, itemId, containerId, x, y, z, length, width, height, rotation, packingFormId, packingFormKey }) =>
      [instanceId, itemId, containerId, x, y, z, length, width, height, rotation, packingFormId, packingFormKey]),
    items: view.items.map(({ id, category, flexibility, packingShape, packingForms }) => [id, category, flexibility, packingShape, packingForms]),
  })).digest('hex');
  const expectedFingerprint = fingerprint(initial);
  const projectUpdated = () => threeViewData(updatedContainer, updatedPlan, updatedItems);
  const projectLegacyUpdated = () => {
    const selectedPlacements = updatedPlan.placements.filter((placement) => placement.containerId === updatedContainer.id);
    const itemIds = new Set(selectedPlacements.map((placement) => placement.itemId));
    return {
      container: updatedContainer,
      plan: { placements: selectedPlacements },
      items: updatedItems.filter((item) => itemIds.has(item.id)),
    };
  };
  const checkUpdated = () => {
    const next = projectUpdated();
    if (!sameThreeViewData(initial, next)) throw new Error('A metadata-only update changed the selected 3D render inputs.');
    return next;
  };
  const verifiedUpdate = checkUpdated();
  if (fingerprint(verifiedUpdate) !== expectedFingerprint) throw new Error('A metadata-only update changed the render fingerprint.');

  for (let warmup = 0; warmup < 3; warmup++) {
    for (let index = 0; index < 10; index++) checkUpdated();
    for (let index = 0; index < 10; index++) structuredClone(projectLegacyUpdated());
  }
  const guardedSamplesMs = [], cloneSamplesMs = [];
  for (let run = 0; run < runs; run++) {
    let start = performance.now();
    for (let index = 0; index < iterations; index++) checkUpdated();
    guardedSamplesMs.push((performance.now() - start) / iterations);
    start = performance.now();
    for (let index = 0; index < iterations; index++) structuredClone(projectLegacyUpdated());
    cloneSamplesMs.push((performance.now() - start) / iterations);
  }
  const median = (samples) => [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)];
  const guardedMedianMs = median(guardedSamplesMs), cloneMedianMs = median(cloneSamplesMs);
  const legacyCoveredPlacementLabels = (placementValues, labels) => {
    const coverCandidates = [...placementValues].filter(placement => placement.containerId === container.id)
      .sort((left, right) => right.z - left.z);
    const covered = new Set();
    for (const placement of placementValues) {
      if (placement.containerId !== container.id) continue;
      let isCovered = false;
      const coverHeight = placement.z + placement.height - 0.01;
      for (const other of coverCandidates) {
        if (other.z < coverHeight) break;
        if (other.instanceId !== placement.instanceId && other.x <= placement.x + placement.length / 2
          && other.x + other.length >= placement.x + placement.length / 2
          && other.y <= placement.y + placement.width / 2
          && other.y + other.width >= placement.y + placement.width / 2) { isCovered = true; break; }
      }
      if (labels?.[placement.instanceId] && isCovered) covered.add(placement.instanceId);
    }
    return covered;
  };
  const coverLabels = Object.fromEntries(coverPlacements.map((placement, index) => [placement.instanceId, String(index + 1)]));
  const legacyLabeled = legacyCoveredPlacementLabels(coverPlacements, coverLabels);
  const currentLabeled = coveredPlacementLabelIds(coverPlacements, container.id, coverLabels);
  if (JSON.stringify([...legacyLabeled].sort()) !== JSON.stringify([...currentLabeled].sort()) || currentLabeled.size === 0) {
    throw new Error('Optimized 3D label coverage changed the occlusion results.');
  }
  const legacyUnlabeledSamplesMs = [], currentUnlabeledSamplesMs = [];
  for (let run = 0; run < runs; run++) {
    let start = performance.now();
    for (let index = 0; index < 10; index++) legacyCoveredPlacementLabels(coverPlacements, undefined);
    legacyUnlabeledSamplesMs.push((performance.now() - start) / 10);
    start = performance.now();
    for (let index = 0; index < 10; index++) coveredPlacementLabelIds(coverPlacements, container.id, undefined);
    currentUnlabeledSamplesMs.push((performance.now() - start) / 10);
  }
  const legacyUnlabeledMedianMs = median(legacyUnlabeledSamplesMs), currentUnlabeledMedianMs = median(currentUnlabeledSamplesMs);
  const messageBytes = Buffer.byteLength(JSON.stringify(projectUpdated()));
  const legacyMessageBytes = Buffer.byteLength(JSON.stringify(projectLegacyUpdated()));
  console.log(JSON.stringify({
    operation: 'metadata-only 3D iframe update projection and clone avoidance',
    fixture: 'Synthetic item and placement records; not a physical packing or browser/WebGL benchmark.',
    itemCount,
    placementCount: initial.plan.placements.length,
    serializedMessageBytes: messageBytes,
    legacySerializedMessageBytes: legacyMessageBytes,
    estimatedPayloadReductionPercent: legacyMessageBytes > 0 ? (1 - messageBytes / legacyMessageBytes) * 100 : 0,
    runs,
    iterationsPerRun: iterations,
    guardedProjectionMedianMs: guardedMedianMs,
    legacyProjectionAndStructuredCloneMedianMs: cloneMedianMs,
    estimatedMetadataUpdateWorkReductionPercent: cloneMedianMs > 0 ? (1 - guardedMedianMs / cloneMedianMs) * 100 : 0,
    unlabeledSceneCoverageLegacyMedianMs: legacyUnlabeledMedianMs,
    unlabeledSceneCoverageOptimizedMedianMs: currentUnlabeledMedianMs,
    unlabeledSceneCoverageWorkReductionPercent: legacyUnlabeledMedianMs > 0 ? (1 - currentUnlabeledMedianMs / legacyUnlabeledMedianMs) * 100 : 0,
    labelCoverageFingerprint: createHash('sha256').update(JSON.stringify([...currentLabeled].sort())).digest('hex'),
    legacyUnlabeledSceneCoverageSamplesMs: legacyUnlabeledSamplesMs,
    optimizedUnlabeledSceneCoverageSamplesMs: currentUnlabeledSamplesMs,
    placementAndRenderFingerprint: expectedFingerprint,
    guardedSamplesMs,
    cloneSamplesMs,
  }, null, 2));
} finally {
  await vite.close();
}
