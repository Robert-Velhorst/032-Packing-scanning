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
if (!Number.isInteger(gridSize) || gridSize < 1 || gridSize > 46) throw new Error('Use --grid= with a size from 1 to 46.');
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('Use --runs= with a count from 1 to 20.');

const plugins = sourceRef ? [{
  name: 'reconstruction-benchmark-source',
  enforce: 'pre',
  transform(_source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/scanning/reconstructed-solid.ts')) return null;
    return execFileSync('git', ['show', `${sourceRef}:src/scanning/reconstructed-solid.ts`], { encoding: 'utf8' });
  },
}] : [];
const vite = await createServer({
  plugins,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
try {
  const { voxelSurface } = await vite.ssrLoadModule('/src/scanning/reconstructed-solid.ts');
  const total = gridSize ** 3;
  const solid = { grid: { x: gridSize, y: gridSize, z: gridSize }, resolutionMm: 10,
    occupiedCells: Array.from({ length: total }, (_, cell) => cell) };
  const fingerprint = (surface) => createHash('sha256').update(JSON.stringify(surface)).digest('hex');
  const warmup = voxelSurface(solid);
  const expectedFingerprint = fingerprint(warmup);
  const expectedFaces = 6 * gridSize ** 2;
  if (warmup.faceCount !== expectedFaces) throw new Error(`Expected ${expectedFaces} boundary faces, got ${warmup.faceCount}.`);

  const samplesSeconds = [], samplesCpuSeconds = [];
  for (let run = 0; run < runs; run += 1) {
    global.gc?.();
    const cpuStart = process.cpuUsage();
    const start = performance.now();
    const surface = voxelSurface(solid);
    samplesSeconds.push((performance.now() - start) / 1000);
    const cpu = process.cpuUsage(cpuStart);
    samplesCpuSeconds.push((cpu.user + cpu.system) / 1_000_000);
    if (fingerprint(surface) !== expectedFingerprint) throw new Error(`Run ${run + 1} changed the reconstructed surface.`);
  }
  const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];
  console.log(JSON.stringify({
    operation: 'maximum-density voxel surface reconstruction',
    grid: `${gridSize}x${gridSize}x${gridSize}`,
    occupiedCells: total,
    faceCount: expectedFaces,
    runs,
    sourceRef: sourceRef || 'working tree',
    node: process.version,
    medianSeconds: median(samplesSeconds),
    samplesSeconds,
    medianCpuSeconds: median(samplesCpuSeconds),
    samplesCpuSeconds,
    maxRssKiB: process.resourceUsage().maxRSS,
    surfaceSha256: expectedFingerprint,
  }));
} finally {
  await vite.close();
}
