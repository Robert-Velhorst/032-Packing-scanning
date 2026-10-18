import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const count = Number(value('instances', '250'));
const runs = Number(value('runs', '7'));
const baselineRef = value('compare-ref', 'HEAD');
if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Use --instances= with a count from 1 to 500.');
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use --runs= with a count from 1 to 10.');

function benchmarkShape() {
  const grid = { x: 12, y: 10, z: 6 };
  const dimensionsMm = { length: 120, width: 100, height: 60 };
  const inside = (x, y, z) => x >= 0 && x < grid.x && y >= 0 && y < grid.y && z >= 0 && z < grid.z
    && (x < 4 || x >= 8 || y < 3);
  const occupiedCells = [];
  let observedCellCount = 0, surfaceFaceCount = 0;
  const directions = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
  for (let z = 0; z < grid.z; z++) for (let y = 0; y < grid.y; y++) for (let x = 0; x < grid.x; x++) {
    if (!inside(x, y, z)) continue;
    occupiedCells.push(x + grid.x * (y + grid.y * z));
    const faces = directions.filter(([dx, dy, dz]) => !inside(x + dx, y + dy, z + dz)).length;
    surfaceFaceCount += faces;
    if (faces) observedCellCount++;
  }
  return {
    adoptedAt: '2026-10-01T00:00:00Z', sourceEnvelopeMm: dimensionsMm, fittedDimensionsMm: dimensionsMm,
    solid: { id: '00000000-0000-4000-8000-000000000001', target: 'item', format: 'voxel_solid_v1', units: 'millimetres',
      sourceHash: 'a'.repeat(64), sourcePointCount: 3000, method: 'observed_voxel_shell_fill_v1', resolutionMm: 10,
      grid, dimensionsMm, occupiedCells, observedCellCount, enclosedCellCount: occupiedCells.length - observedCellCount,
      surfaceFaceCount, warnings: ['Synthetic analytic shape for 3D surface benchmarking.'] },
  };
}

const vite = await createServer({
  plugins: [{
    name: 'three-surface-baseline-source',
    enforce: 'pre',
    transform(_source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/packing-geometry.ts?three-surface-baseline')) return null;
      return execFileSync('git', ['show', `${baselineRef}:src/packing-geometry.ts`], { encoding: 'utf8' });
    },
  }],
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const current = await vite.ssrLoadModule('/src/packing-geometry.ts');
  const baseline = await vite.ssrLoadModule('/src/packing-geometry.ts?three-surface-baseline');
  await vite.watcher.close();
  const shape = benchmarkShape();
  const item = { packingShape: shape };
  const rotations = current.geometryOrientations({ dimensions: shape.fittedDimensionsMm, keepUpright: false, packingShape: shape });
  const placements = Array.from({ length: count }, (_, index) => ({
    instanceId: `surface-${index}`, entryId: `entry-${index}`, itemId: 'shape', containerId: 'bag',
    x: index % 25 * 130, y: Math.floor(index / 25) % 10 * 110, z: Math.floor(index / 250) * 70,
    ...rotations[index % rotations.length], layer: 1,
  }));
  const fingerprint = (geometry) => {
    const hash = createHash('sha256');
    for (const placement of placements) hash.update(JSON.stringify(geometry.placementSurface(placement, item)?.verticesMm));
    return hash.digest('hex');
  };
  const expected = fingerprint(baseline);
  if (fingerprint(current) !== expected) throw new Error('The optimized surface vertices differ from the baseline.');
  const measure = (geometry) => {
    let vertexCount = 0;
    for (const placement of placements) vertexCount += geometry.placementSurface(placement, item)?.verticesMm.length ?? 0;
    return vertexCount;
  };
  for (let warmup = 0; warmup < 4; warmup++) {
    measure(warmup % 2 ? baseline : current);
    measure(warmup % 2 ? current : baseline);
  }
  const samples = new Map([['current', []], ['baseline', []]]);
  for (let run = 0; run < runs; run++) {
    const order = run % 2 ? [['baseline', baseline], ['current', current]] : [['current', current], ['baseline', baseline]];
    for (const [name, geometry] of order) {
      const start = performance.now();
      const vertexCount = measure(geometry);
      samples.get(name).push(performance.now() - start);
      if (vertexCount < 1) throw new Error('The synthetic shape produced no surface vertices.');
    }
  }
  const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({
    operation: 'transformed shaped-item surface vertices for 3D preview',
    fixture: 'Synthetic 12×10×6 voxel U-shape; exact vertex SHA-256 checked before timing.',
    baselineRef, instances: count, runs, node: process.version, peakRssKiB: process.resourceUsage().maxRSS,
    vertexFingerprint: expected,
    baselineMedianMs: median(samples.get('baseline')),
    currentMedianMs: median(samples.get('current')),
    baselineSamplesMs: samples.get('baseline'), currentSamplesMs: samples.get('current'),
  }, null, 2));
} finally {
  await vite.close();
}
