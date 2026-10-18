import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const value = (name, fallback) => process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const counts = value('counts', '50,100,250,500').split(',').map(Number);
const runs = Number(value('runs', '5'));
const sourceRef = value('sequence-ref', '');
if (!counts.length || counts.some((count) => !Number.isInteger(count) || count < 1 || count > 500)) throw new Error('Use --counts= with item counts from 1 to 500.');
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use --runs= with a count from 1 to 10.');

const plugins = sourceRef ? [{
  name: 'packing-sequence-benchmark-source',
  enforce: 'pre',
  transform(source, id) {
    if (!id.replaceAll('\\', '/').endsWith('/src/packing-sequence.ts')) return null;
    return execFileSync('git', ['show', `${sourceRef}:src/packing-sequence.ts`], { encoding: 'utf8' });
  },
}] : [];
const vite = await createServer({ plugins, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'error' });
try {
  const sequence = await vite.ssrLoadModule('/src/packing-sequence.ts');
  const { createInitialData } = await vite.ssrLoadModule('/src/seed.ts');
  const seed = createInitialData();
  await vite.watcher.close();
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const results = [];
  for (const count of counts) {
    const items = Array.from({ length: count }, (_, index) => ({ ...structuredClone(seed.libraryItems[0]), id: `sequence-item-${index}`, name: `Item ${index}` }));
    const placements = items.map((item, index) => ({
      instanceId: `sequence-instance-${index}`, itemId: item.id, entryId: `sequence-entry-${index}`,
      containerId: 'sequence-bag', compartmentId: undefined, x: 0, y: 0, z: index * 20,
      length: 100, width: 100, height: 20, rotation: 0, layer: index, insertionOrder: index,
    }));
    const index = sequence.createPackingStepRelationIndex(placements, items);
    const measure = () => {
      const started = performance.now();
      const values = placements.map((placement) => sequence.packingStepRelation(placement, placements, items, undefined, index));
      return { ms: performance.now() - started, fingerprint: createHash('sha256').update(JSON.stringify(values)).digest('hex') };
    };
    const expected = measure().fingerprint;
    for (let warmup = 0; warmup < 3; warmup++) if (measure().fingerprint !== expected) throw new Error('Warmup changed the relation results.');
    const samplesMs = [];
    for (let run = 0; run < runs; run++) {
      const result = measure();
      if (result.fingerprint !== expected) throw new Error(`Run ${run + 1} changed the relation results.`);
      samplesMs.push(result.ms);
    }
    const completed=placements.filter((_,placementIndex)=>placementIndex%7===0).map(placement=>placement.instanceId),completedSet=new Set(completed);
    const measurePreviews=(useIndex) => {
      const started=performance.now();
      const values=placements.map((_,placementIndex)=>sequence.packingStepPreview(placements,placementIndex,completed,completedSet,useIndex?index:undefined));
      return {ms:performance.now()-started,fingerprint:createHash('sha256').update(JSON.stringify(values)).digest('hex')};
    };
    const expectedPreview=measurePreviews(false).fingerprint;
    if(measurePreviews(true).fingerprint!==expectedPreview)throw new Error('Indexed previews changed their placement contents.');
    const previewSamples={unindexed:[],indexed:[]};
    for(let warmup=0;warmup<3;warmup++)for(const useIndex of [false,true])if(measurePreviews(useIndex).fingerprint!==expectedPreview)throw new Error('Warmup changed the preview results.');
    for(let run=0;run<runs;run++)for(const useIndex of run%2?[true,false]:[false,true]){
      const result=measurePreviews(useIndex);if(result.fingerprint!==expectedPreview)throw new Error(`Run ${run+1} changed the preview results.`);
      previewSamples[useIndex?'indexed':'unindexed'].push(result.ms);
    }
    results.push({ placements: count, runs, medianMs: median(samplesMs), samplesMs, relationSha256: expected,
      preview: {unindexedMedianMs:median(previewSamples.unindexed),indexedMedianMs:median(previewSamples.indexed),unindexedSamplesMs:previewSamples.unindexed,indexedSamplesMs:previewSamples.indexed,placementSha256:expectedPreview} });
  }
  console.log(JSON.stringify({ operation: 'packing-sequence support guidance', sourceRef: sourceRef || 'working tree', node: process.version, results }));
} finally {
  await vite.close();
}
