import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import inspector from 'node:inspector';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const counts = value('counts', '50,100,250').split(',').map(Number);
const runs = Number(value('runs', '3'));
const warmupRunsPerSize = 3;
const shapeCount = Number(value('shapes', '0'));
const bagCount = Number(value('bags', '1'));
const compartmentCount = Number(value('compartments', '0'));
const optimizerRef = value('optimizer-ref', '');
const compareOptimizerRef = value('compare-optimizer-ref', '');
const stackLoadRef = value('stack-load-ref', '');
const packingGeometryRef = value('packing-geometry-ref', '');
const bagWeightsRef = value('bag-weights-ref', '');
const retrievalRef = value('retrieval-ref', '');
const retrievalChecks = value('retrieval-checks', 'false') === 'true';
const profile = value('profile', 'false') === 'true';
const cloneWorkerInput = value('clone-worker-input', 'false') === 'true';
const workerShapeCache = value('worker-shape-cache', 'false') === 'true';
const compareWorkerShapeCache = value('compare-worker-shape-cache', 'false') === 'true';
if (compareWorkerShapeCache && !cloneWorkerInput) throw new Error('Use --compare-worker-shape-cache=true with --clone-worker-input=true.');
if (compareOptimizerRef && !cloneWorkerInput) throw new Error('Use --compare-optimizer-ref= with --clone-worker-input=true.');
if (compareOptimizerRef && (optimizerRef || compareWorkerShapeCache)) throw new Error('Use --compare-optimizer-ref= by itself for source comparison.');
const mode = value('mode', '');
if (mode && !['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'].includes(mode)) {
  throw new Error('Use --mode=balanced,maximum_capacity,easy_access, or fragile_protection.');
}
const inspectorPost = (session, method, params = {}) => new Promise((resolve, reject) => {
  session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
});
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
if (!Number.isInteger(compartmentCount) || compartmentCount < 0 || compartmentCount > 10) throw new Error('Use --compartments= with a count from 0 to 10.');

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
if (compareOptimizerRef) benchmarkOverrides.push({
  name: 'optimizer-comparison-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/optimizer.ts?benchmark-baseline')) return null;
    return execFileSync('git', ['show', `${compareOptimizerRef}:src/optimizer.ts`], { encoding: 'utf8' });
  },
});
if (stackLoadRef) benchmarkOverrides.push({
  name: 'stack-load-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/stack-load.ts')) return null;
    return execFileSync('git', ['show', `${stackLoadRef}:src/stack-load.ts`], { encoding: 'utf8' });
  },
});
if (packingGeometryRef) benchmarkOverrides.push({
  name: 'packing-geometry-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/packing-geometry.ts')) return null;
    return execFileSync('git', ['show', `${packingGeometryRef}:src/packing-geometry.ts`], { encoding: 'utf8' });
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
  optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error',
});
try {
  const { createInitialData } = await vite.ssrLoadModule('/src/seed.ts');
  const { buildPlan } = await vite.ssrLoadModule('/src/optimizer.ts');
  const buildPlanReference = compareOptimizerRef
    ? (await vite.ssrLoadModule('/src/optimizer.ts?benchmark-baseline')).buildPlan
    : undefined;
  const { reconcilePackingShapes } = await vite.ssrLoadModule('/src/planner-shape-cache.ts');
  const { assessRetrieval } = await vite.ssrLoadModule('/src/retrieval.ts');
  const seed = createInitialData();
  await vite.watcher.close();
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
    const bags = containerIds.map(id => {
      const bag = {
        ...structuredClone(seed.containers[0]),
        id,
        inside: { length: 1000, width: 800, height: 500 },
        opening: { length: 1000, width: 800 },
        massLimitGrams: 100000,
        travellerIds: ['traveller-you'],
      };
      if (compartmentCount > 0) {
        const evidence = { source: 'user_confirmed', confidence: 1, collectedAt: '2026-10-01T00:00:00Z' };
        bag.compartments = Array.from({ length: compartmentCount }, (_, index) => {
          const length = 1000 / compartmentCount;
          return {
            id: `benchmark-compartment-${index + 1}`,
            name: `Benchmark compartment ${index + 1}`,
            x: index * length, y: 0, z: 0, length, width: 800, height: 500,
            opening: { length, width: 800 }, evidence, supportEvidence: evidence,
          };
        });
      }
      return bag;
    });
    return { trip, items, bags };
  };

  const results = [];
  for (const count of counts) {
    const input = fixture(count);
    let reusableShapes = new Map();
    const planRequest = (useWorkerShapeCache = workerShapeCache, useReferenceOptimizer = false) => {
      const request = cloneWorkerInput ? structuredClone(input) : input;
      if (useWorkerShapeCache) reusableShapes = reconcilePackingShapes(request.items, reusableShapes);
      return (useReferenceOptimizer ? buildPlanReference : buildPlan)(request.trip, request.items, request.bags);
    };
    const planVariant = (variant) => compareOptimizerRef
      ? planRequest(workerShapeCache, variant)
      : planRequest(variant);
    const fingerprint = (plan) => createHash('sha256').update(JSON.stringify(plan.placements.map(({ instanceId, containerId, compartmentId, x, y, z, length, width, height, rotation, layer, insertionOrder, shapeKey }) =>
      ({ instanceId, containerId, compartmentId, x, y, z, length, width, height, rotation, layer, insertionOrder, shapeKey })))).digest('hex');
    const warmup = compareWorkerShapeCache ? planRequest(false)
      : compareOptimizerRef ? planRequest(workerShapeCache, true)
        : planRequest(workerShapeCache);
    if (warmup.placements.length !== count) throw new Error(`Warm-up placed ${warmup.placements.length} of ${count} items.`);
    assertRectangularPlacementsDoNotOverlap(warmup);
    const expectedFingerprint = fingerprint(warmup);
    if (compareWorkerShapeCache) {
      const plan = planRequest(true);
      if (plan.placements.length !== count || fingerprint(plan) !== expectedFingerprint) {
        throw new Error('Shape-cache warm-up changed the placement result.');
      }
    }
    if (compareOptimizerRef) {
      const plan = planRequest(workerShapeCache, false);
      if (plan.placements.length !== count || fingerprint(plan) !== expectedFingerprint) {
        throw new Error('Working-tree optimizer warm-up changed the reference placements.');
      }
    }
    for (let warmupRun = 1; warmupRun < warmupRunsPerSize; warmupRun += 1) {
      const variants = compareWorkerShapeCache
        ? warmupRun % 2 ? [true, false] : [false, true]
        : compareOptimizerRef ? warmupRun % 2 ? [false, true] : [true, false]
          : [workerShapeCache];
      for (const variant of variants) {
        const plan = planVariant(variant);
        if (plan.placements.length !== count || fingerprint(plan) !== expectedFingerprint) {
          throw new Error(`Warm-up ${warmupRun + 1} changed the comparison placement result for variant ${variant}.`);
        }
      }
    }
    const comparisonVariants = compareWorkerShapeCache || compareOptimizerRef ? [false, true] : [workerShapeCache];
    const samplesByCache = new Map(comparisonVariants.map(variant => [variant, { samples: [], cpuSamples: [] }]));
    const retrievalSamplesByCache = new Map(comparisonVariants.map(variant => [variant, []]));
    const retrievalItems = retrievalChecks ? new Map(warmup.placements.map(placement => [placement.instanceId,
      input.items.find(item => item.id === placement.itemId)]).filter((entry) => entry[1])) : undefined;
    const expectedRetrieval = retrievalChecks ? JSON.stringify(assessRetrieval(warmup.placements, input.bags, retrievalItems)) : '';
    for (let run = 0; run < runs; run += 1) {
      const variants = compareWorkerShapeCache
        ? run % 2 ? [true, false] : [false, true]
        : compareOptimizerRef ? run % 2 ? [false, true] : [true, false]
          : [workerShapeCache];
      for (const variant of variants) {
        const cpuStart = process.cpuUsage();
        const start = performance.now();
        const plan = planVariant(variant);
        const measurement = samplesByCache.get(variant);
        measurement.samples.push((performance.now() - start) / 1000);
        const cpu = process.cpuUsage(cpuStart);
        measurement.cpuSamples.push((cpu.user + cpu.system) / 1_000_000);
        if (plan.placements.length !== count) throw new Error(`Run ${run + 1} placed ${plan.placements.length} of ${count} items.`);
        if (fingerprint(plan) !== expectedFingerprint) throw new Error(`Run ${run + 1} changed the warm-up placements for comparison variant ${variant}.`);
        assertRectangularPlacementsDoNotOverlap(plan);
        if (retrievalChecks) {
          const retrievalStart = performance.now();
          const review = assessRetrieval(warmup.placements, input.bags, retrievalItems);
          retrievalSamplesByCache.get(variant).push((performance.now() - retrievalStart) / 1000);
          if (JSON.stringify(review) !== expectedRetrieval) throw new Error(`Run ${run + 1} changed retrieval review results.`);
        }
      }
    }
    let profileFunctions;
    if (profile) {
      const session = new inspector.Session();
      session.connect();
      try {
        await inspectorPost(session, 'Profiler.enable');
        await inspectorPost(session, 'Profiler.start');
        const plan = planRequest();
        const { profile: cpuProfile } = await inspectorPost(session, 'Profiler.stop');
        if (plan.placements.length !== count || fingerprint(plan) !== expectedFingerprint) {
          throw new Error('Profiled run changed the measured placement result.');
        }
        profileFunctions = cpuProfile.nodes
          .filter(node => node.hitCount > 0)
          .sort((left, right) => right.hitCount - left.hitCount)
          .slice(0, 25)
          .map(node => ({
            function: node.callFrame.functionName || '(anonymous)',
            file: node.callFrame.url,
            line: node.callFrame.lineNumber + 1,
            samples: node.hitCount,
          }));
      } finally {
        await inspectorPost(session, 'Profiler.disable');
        session.disconnect();
      }
    }
    for (const [variant, { samples, cpuSamples }] of samplesByCache) {
      const sorted = [...samples].sort((left, right) => left - right), sortedCpu = [...cpuSamples].sort((left, right) => left - right);
      const retrievalSamples = retrievalSamplesByCache.get(variant), sortedRetrieval = [...retrievalSamples].sort((left, right) => left - right);
      results.push({ itemCount: count,
        ...(compareWorkerShapeCache ? { workerShapeCache: variant } : compareOptimizerRef ? { optimizerRef: variant ? compareOptimizerRef : 'working tree' } : {}),
        medianSeconds: sorted[Math.floor(sorted.length / 2)], samplesSeconds: samples,
        medianCpuSeconds: sortedCpu[Math.floor(sortedCpu.length / 2)], samplesCpuSeconds: cpuSamples,
        ...(retrievalChecks ? { retrievalMedianSeconds: sortedRetrieval[Math.floor(sortedRetrieval.length / 2)], retrievalSamplesSeconds: retrievalSamples } : {}),
        placed: count, placementFingerprint: expectedFingerprint });
    }
    if (profileFunctions) results.at(-1).profileFunctions = profileFunctions;
  }
  console.log(JSON.stringify({
    fixture: `${shapeCount ? `varied rectangles with ${shapeCount} synthetic voxel U-shapes` : 'varied rectangular items'} in ${bagCount} 1000x800x500 mm bags${compartmentCount ? ` with ${compartmentCount} synthetic compartments per bag` : ''}`,
    dimensions: shapeCount ? '120x100x60 mm voxel U-shapes mixed with 48-200 x 36-162 x 18-120 mm rectangles'
      : '48-200 x 36-162 x 18-120 mm, deterministic per item index',
    mode: mode || seed.trips[0].mode,
    optimizerRef: compareOptimizerRef ? `alternating against ${compareOptimizerRef}` : optimizerRef || 'working tree',
    stackLoadRef: stackLoadRef || 'working tree',
    packingGeometryRef: packingGeometryRef || 'working tree',
    bagWeightsRef: bagWeightsRef || 'working tree',
    retrievalRef: retrievalRef || 'working tree',
    node: process.version,
    peakRssKiB: process.resourceUsage().maxRSS,
    shapeCount,
    cloneWorkerInput,
    workerShapeCache: compareWorkerShapeCache ? 'alternating comparison' : workerShapeCache,
    warmupRunsPerSize,
    measuredRuns: runs,
    results,
  }, null, 2));
} finally {
  await vite.close();
}
