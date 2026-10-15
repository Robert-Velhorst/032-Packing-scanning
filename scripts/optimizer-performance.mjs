import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const counts = value('counts', '50,100,250').split(',').map(Number);
const runs = Number(value('runs', '3'));
const shapeCount = Number(value('shapes', '0'));
const bagCount = Number(value('bags', '1'));
const optimizerRef = value('optimizer-ref', '');
const bagWeightsRef = value('bag-weights-ref', '');
const retrievalRef = value('retrieval-ref', '');
const retrievalChecks = value('retrieval-checks', 'false') === 'true';
const mode = value('mode', '');
if (mode && !['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'].includes(mode)) {
  throw new Error('Use --mode=balanced,maximum_capacity,easy_access, or fragile_protection.');
}
const assertRectangularPlacementsDoNotOverlap = (plan) => {
  if (shapeCount > 0) return;
  const placements = plan.placements;
  const epsilon = 0.01;
  for (let index = 0; index < placements.length; index += 1) {
    const left = placements[index];
    for (let otherIndex = index + 1; otherIndex < placements.length; otherIndex += 1) {
      const right = placements[otherIndex];
      if (left.containerId === right.containerId
        && left.x < right.x + right.length - epsilon && left.x + left.length > right.x + epsilon
        && left.y < right.y + right.width - epsilon && left.y + left.width > right.y + epsilon
        && left.z < right.z + right.height - epsilon && left.z + left.height > right.z + epsilon) {
        throw new Error(`Rectangular placements ${left.instanceId} and ${right.instanceId} overlap.`);
      }
    }
  }
};
if (!counts.length || counts.some((count) => !Number.isInteger(count) || count < 1 || count > 500)) {
  throw new Error('Use --counts= with comma-separated item counts from 1 to 500.');
}
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use --runs= with a count from 1 to 10.');
if (!Number.isInteger(shapeCount) || shapeCount < 0 || shapeCount > 500) throw new Error('Use --shapes= with a count from 0 to 500.');
if (!Number.isInteger(bagCount) || bagCount < 1 || bagCount > 10) throw new Error('Use --bags= with a count from 1 to 10.');

function benchmarkShape() {
  const grid = { x: 12, y: 10, z: 6 };
  const dimensions = { length: 120, width: 100, height: 60 };
  const inside = (x, y, z) => x >= 0 && x < grid.x && y >= 0 && y < grid.y && z >= 0 && z < grid.z
    && (x < 4 || x >= 8 || y < 3);
  const occupiedCells = [];
  let observedCellCount = 0;
  let surfaceFaceCount = 0;
  const directions = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let z = 0; z < grid.z; z++) for (let y = 0; y < grid.y; y++) for (let x = 0; x < grid.x; x++) {
    if (!inside(x, y, z)) continue;
    occupiedCells.push(x + grid.x * (y + grid.y * z));
    const exposedFaces = directions.filter(([dx, dy, dz]) => !inside(x + dx, y + dy, z + dz)).length;
    surfaceFaceCount += exposedFaces;
    if (exposedFaces) observedCellCount += 1;
  }
  return {
    adoptedAt: '2026-10-01T00:00:00Z',
    sourceEnvelopeMm: dimensions,
    fittedDimensionsMm: dimensions,
    solid: {
      id: '00000000-0000-4000-8000-000000000001',
      target: 'item',
      format: 'voxel_solid_v1',
      units: 'millimetres',
      sourceHash: 'a'.repeat(64),
      sourcePointCount: 3000,
      method: 'observed_voxel_shell_fill_v1',
      resolutionMm: 10,
      grid,
      dimensionsMm: dimensions,
      occupiedCells,
      observedCellCount,
      enclosedCellCount: occupiedCells.length - observedCellCount,
      surfaceFaceCount,
      warnings: ['Synthetic analytic shape for optimizer performance testing.'],
    },
  };
}

const benchmarkOverrides = [];
if (optimizerRef) benchmarkOverrides.push({
  name: 'optimizer-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/optimizer.ts')) return null;
    return execFileSync('git', ['show', `${optimizerRef}:src/optimizer.ts`], { encoding: 'utf8' });
  },
});
if (bagWeightsRef) benchmarkOverrides.push({
  name: 'bag-weights-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/bag-weights.ts')) return null;
    return execFileSync('git', ['show', `${bagWeightsRef}:src/bag-weights.ts`], { encoding: 'utf8' });
  },
});
if (retrievalRef) benchmarkOverrides.push({
  name: 'retrieval-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/retrieval.ts')) return null;
    return execFileSync('git', ['show', `${retrievalRef}:src/retrieval.ts`], { encoding: 'utf8' });
  },
});
const vite = await createServer({
  plugins: benchmarkOverrides,
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error',
});
try {
  const { createInitialData } = await vite.ssrLoadModule('/src/seed.ts');
  const { buildPlan } = await vite.ssrLoadModule('/src/optimizer.ts');
  const { assessRetrieval } = await vite.ssrLoadModule('/src/retrieval.ts');
  const seed = createInitialData();
  const fixture = (count) => {
    if (shapeCount > count) throw new Error(`Cannot benchmark ${shapeCount} shapes in a ${count}-item plan.`);
    const containerIds = Array.from({ length: bagCount }, (_, index) => index === 0 ? 'benchmark-bag' : `benchmark-bag-${index + 1}`);
    const shapeIndices = new Set(Array.from({ length: shapeCount }, (_, index) => Math.floor(index * count / shapeCount)));
    const shaped = shapeCount ? benchmarkShape() : undefined;
    const items = Array.from({ length: count }, (_, index) => {
      const isShaped = shapeIndices.has(index);
      return {
        ...structuredClone(seed.libraryItems[0]),
        id: `benchmark-item-${index}`,
        name: `Varied item ${index}`,
        category: 'other',
        dimensions: isShaped ? shaped.fittedDimensionsMm : {
          length: 48 + (index * 37 % 153),
          width: 36 + (index * 53 % 127),
          height: 18 + (index * 29 % 103),
        },
        ...(isShaped ? { packingShape: structuredClone(shaped) } : {}),
        massGrams: 100,
        fragile: false,
        keepUpright: false,
      };
    });
    const trip = {
      ...structuredClone(seed.trips[0]),
      sample: false,
      ...(mode ? { mode } : {}),
      containerIds,
      entries: items.map((item, index) => ({
        id: `benchmark-entry-${index}`,
        itemId: item.id,
        travellerId: 'traveller-you',
        quantity: 1,
        priority: 'required',
        accessPriority: 1,
        required: true,
      })),
      completedInstanceIds: [],
      unavailableInstanceIds: [],
      lockedPlacements: [],
    };
    const bags = containerIds.map(id => ({
      ...structuredClone(seed.containers[0]),
      id,
      inside: { length: 1000, width: 800, height: 500 },
      opening: { length: 1000, width: 800 },
      massLimitGrams: 100000,
      travellerIds: ['traveller-you'],
    }));
    return { trip, items, bags };
  };

  const results = [];
  for (const count of counts) {
    const input = fixture(count);
    const fingerprint = (plan) => createHash('sha256').update(JSON.stringify(plan.placements.map(({ instanceId, containerId, compartmentId, x, y, z, length, width, height, rotation, layer, insertionOrder, shapeKey }) =>
      ({ instanceId, containerId, compartmentId, x, y, z, length, width, height, rotation, layer, insertionOrder, shapeKey })))).digest('hex');
    const warmup = buildPlan(input.trip, input.items, input.bags);
    if (warmup.placements.length !== count) throw new Error(`Warm-up placed ${warmup.placements.length} of ${count} items.`);
    assertRectangularPlacementsDoNotOverlap(warmup);
    const expectedFingerprint = fingerprint(warmup);
    const samples = [];
    const cpuSamples = [];
    const retrievalItems = retrievalChecks ? new Map(warmup.placements.map(placement => [placement.instanceId,
      input.items.find(item => item.id === placement.itemId)]).filter((entry) => entry[1])) : undefined;
    const expectedRetrieval = retrievalChecks ? JSON.stringify(assessRetrieval(warmup.placements, input.bags, retrievalItems)) : '';
    const retrievalSamples = [];
    for (let run = 0; run < runs; run += 1) {
      const cpuStart = process.cpuUsage();
      const start = performance.now();
      const plan = buildPlan(input.trip, input.items, input.bags);
      samples.push((performance.now() - start) / 1000);
      const cpu = process.cpuUsage(cpuStart);
      cpuSamples.push((cpu.user + cpu.system) / 1_000_000);
      if (plan.placements.length !== count) throw new Error(`Run ${run + 1} placed ${plan.placements.length} of ${count} items.`);
      if (fingerprint(plan) !== expectedFingerprint) throw new Error(`Run ${run + 1} changed the warm-up placements.`);
      assertRectangularPlacementsDoNotOverlap(plan);
      if (retrievalChecks) {
        const retrievalStart = performance.now();
        const review = assessRetrieval(warmup.placements, input.bags, retrievalItems);
        retrievalSamples.push((performance.now() - retrievalStart) / 1000);
        if (JSON.stringify(review) !== expectedRetrieval) throw new Error(`Run ${run + 1} changed retrieval review results.`);
      }
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const sortedCpu = [...cpuSamples].sort((left, right) => left - right);
    const sortedRetrieval = [...retrievalSamples].sort((left, right) => left - right);
    results.push({ itemCount: count, medianSeconds: sorted[Math.floor(sorted.length / 2)], samplesSeconds: samples,
      medianCpuSeconds: sortedCpu[Math.floor(sortedCpu.length / 2)], samplesCpuSeconds: cpuSamples,
      ...(retrievalChecks ? { retrievalMedianSeconds: sortedRetrieval[Math.floor(sortedRetrieval.length / 2)], retrievalSamplesSeconds: retrievalSamples } : {}),
      placed: count, placementFingerprint: expectedFingerprint });
  }
  console.log(JSON.stringify({
    fixture: shapeCount ? `varied rectangles with ${shapeCount} synthetic voxel U-shapes in ${bagCount} 1000x800x500 mm bags`
      : `varied rectangular items in ${bagCount} 1000x800x500 mm bags`,
    dimensions: shapeCount ? '120x100x60 mm voxel U-shapes mixed with 48-200 x 36-162 x 18-120 mm rectangles'
      : '48-200 x 36-162 x 18-120 mm, deterministic per item index',
    mode: mode || seed.trips[0].mode,
    optimizerRef: optimizerRef || 'working tree',
    bagWeightsRef: bagWeightsRef || 'working tree',
    retrievalRef: retrievalRef || 'working tree',
    node: process.version,
    shapeCount,
    warmupRunsPerSize: 1,
    measuredRuns: runs,
    results,
  }, null, 2));
} finally {
  await vite.close();
}
