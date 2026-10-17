import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const gridSize = Number(value('grid', '46'));
const runs = Number(value('runs', '7'));
const sourceRef = value('source-ref', '');
if (!Number.isInteger(gridSize) || gridSize < 3 || gridSize > 46) throw new Error('Use --grid= with a size from 3 to 46.');
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Use --runs= with a count from 1 to 20.');

const plugins = sourceRef ? [{
  name: 'interior-cavity-benchmark-source',
  enforce: 'pre',
  transform(source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/scanning/interior-cavity.ts')) return null;
    if (sourceRef === 'working-tree') return source;
    return execFileSync('git', ['show', `${sourceRef}:src/scanning/interior-cavity.ts`], { encoding: 'utf8' });
  },
}] : [];
const vite = await createServer({
  plugins,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, watch: null },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { parseInteriorCavity } = await vite.ssrLoadModule('/src/scanning/interior-cavity.ts');
  const size = gridSize * 10, total = gridSize ** 3;
  const freeCells = [], observedCells = [], openingCells = [], pointsMm = [];
  for (let z = 0; z < gridSize; z++) for (let y = 0; y < gridSize; y++) for (let x = 0; x < gridSize; x++) {
    const cell = x + gridSize * (y + gridSize * z);
    if (x > 0 && x < gridSize - 1 && y > 0 && y < gridSize - 1 && z > 0) {
      freeCells.push(cell);
      if (z === gridSize - 1) openingCells.push(cell);
    } else {
      observedCells.push(cell);
      pointsMm.push((x + 0.5) * 10, (y + 0.5) * 10, (z + 0.5) * 10, 1);
    }
  }
  if (observedCells.length < 300 || observedCells.length >= 60000) throw new Error('The fixture does not fit the saved scan point-count contract.');
  const dimensionsMm = { length: size, width: size, height: size };
  const source = {
    id: '00000000-0000-4000-8000-000000000001', target: 'container_interior', format: 'point_cloud_preview', units: 'millimetres',
    sourceHash: 'a'.repeat(64), pointCount: observedCells.length, samplePointCount: observedCells.length, pointsMm,
    envelope: { method: 'oriented_surface_envelope_v1', basis: 'capture_aligned', paddingMm: 2.5, dimensionsMm },
  };
  const review = { openingAxis: 2, openingSign: 1, seedMm: { x: size / 2, y: size / 2, z: size / 2 } };
  const cavity = {
    id: source.id, target: 'container_interior', format: 'voxel_cavity_v1', units: 'millimetres', sourceHash: source.sourceHash,
    sourcePointCount: source.pointCount, method: 'seeded_observed_interior_v1', grid: { x: gridSize, y: gridSize, z: gridSize },
    boundsMm: dimensionsMm, cellSizeMm: { length: 10, width: 10, height: 10 }, seedMm: review.seedMm,
    opening: { axis: 2, sign: 1, planeMm: size, cells: openingCells }, freeCells, observedCells,
    wallCellCount: observedCells.length, surfaceFaceCount: 0, estimatedVolumeMm3: freeCells.length * 1000,
    warnings: ['Synthetic maximum-grid interior benchmark.'],
  };
  const { voxelSurface } = await vite.ssrLoadModule('/src/scanning/reconstructed-solid.ts');
  cavity.surfaceFaceCount = voxelSurface({ grid: cavity.grid, resolutionMm: 10, occupiedCells: freeCells }).faceCount;
  const fingerprint = (surface) => createHash('sha256').update(JSON.stringify(surface)).digest('hex');
  const expected = parseInteriorCavity(cavity, source, review);
  const expectedHash = fingerprint(expected.surface);
  const samplesSeconds = [], samplesCpuSeconds = [];
  for (let run = 0; run < runs; run += 1) {
    global.gc?.();
    const cpuStart = process.cpuUsage(), start = performance.now();
    const result = parseInteriorCavity(cavity, source, review);
    samplesSeconds.push((performance.now() - start) / 1000);
    const cpu = process.cpuUsage(cpuStart);
    samplesCpuSeconds.push((cpu.user + cpu.system) / 1_000_000);
    if (fingerprint(result.surface) !== expectedHash) throw new Error(`Run ${run + 1} changed the reconstructed interior.`);
  }
  const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({
    operation: 'maximum-grid seeded container-interior validation', grid: `${gridSize}x${gridSize}x${gridSize}`,
    freeCells: freeCells.length, observedWallCells: observedCells.length, sourcePoints: source.pointCount, runs,
    sourceRef: sourceRef || 'working tree', node: process.version, medianSeconds: median(samplesSeconds), samplesSeconds,
    medianCpuSeconds: median(samplesCpuSeconds), samplesCpuSeconds, maxRssKiB: process.resourceUsage().maxRSS,
    surfaceSha256: expectedHash,
  }, null, 2));
} finally {
  await vite.close();
}
