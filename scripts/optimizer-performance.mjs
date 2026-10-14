import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const counts = value('counts', '50,100,250').split(',').map(Number);
const runs = Number(value('runs', '3'));
const shapeCount = Number(value('shapes', '0'));
if (!counts.length || counts.some((count) => !Number.isInteger(count) || count < 1 || count > 500)) {
  throw new Error('Use --counts= with comma-separated item counts from 1 to 500.');
}
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use --runs= with a count from 1 to 10.');
if (!Number.isInteger(shapeCount) || shapeCount < 0 || shapeCount > 500) throw new Error('Use --shapes= with a count from 0 to 500.');

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

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { createInitialData } = await vite.ssrLoadModule('/src/seed.ts');
  const { buildPlan } = await vite.ssrLoadModule('/src/optimizer.ts');
  const seed = createInitialData();
  const fixture = (count) => {
    if (shapeCount > count) throw new Error(`Cannot benchmark ${shapeCount} shapes in a ${count}-item plan.`);
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
      containerIds: ['benchmark-bag'],
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
    const bag = {
      ...structuredClone(seed.containers[0]),
      id: 'benchmark-bag',
      inside: { length: 1000, width: 800, height: 500 },
      opening: { length: 1000, width: 800 },
      massLimitGrams: 100000,
      travellerIds: ['traveller-you'],
    };
    return { trip, items, bags: [bag] };
  };

  const results = [];
  for (const count of counts) {
    const input = fixture(count);
    const warmup = buildPlan(input.trip, input.items, input.bags);
    if (warmup.placements.length !== count) throw new Error(`Warm-up placed ${warmup.placements.length} of ${count} items.`);
    const samples = [];
    for (let run = 0; run < runs; run += 1) {
      const start = performance.now();
      const plan = buildPlan(input.trip, input.items, input.bags);
      samples.push((performance.now() - start) / 1000);
      if (plan.placements.length !== count) throw new Error(`Run ${run + 1} placed ${plan.placements.length} of ${count} items.`);
    }
    const sorted = [...samples].sort((left, right) => left - right);
    results.push({ itemCount: count, medianSeconds: sorted[Math.floor(sorted.length / 2)], samplesSeconds: samples, placed: count });
  }
  console.log(JSON.stringify({
    fixture: shapeCount ? `varied rectangles with ${shapeCount} synthetic voxel U-shapes in a 1000x800x500 mm bag`
      : 'varied rectangular items in a 1000x800x500 mm bag',
    dimensions: shapeCount ? '120x100x60 mm voxel U-shapes mixed with 48-200 x 36-162 x 18-120 mm rectangles'
      : '48-200 x 36-162 x 18-120 mm, deterministic per item index',
    node: process.version,
    shapeCount,
    warmupRunsPerSize: 1,
    measuredRuns: runs,
    results,
  }, null, 2));
} finally {
  await vite.close();
}
