import { performance } from 'node:perf_hooks';
import { createServer } from 'vite';

const value = (name, fallback) => {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) ?? fallback;
};
const counts = value('counts', '50,100,250').split(',').map(Number);
const runs = Number(value('runs', '3'));
if (!counts.length || counts.some((count) => !Number.isInteger(count) || count < 1 || count > 500)) {
  throw new Error('Use --counts= with comma-separated item counts from 1 to 500.');
}
if (!Number.isInteger(runs) || runs < 1 || runs > 10) throw new Error('Use --runs= with a count from 1 to 10.');

const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { createInitialData } = await vite.ssrLoadModule('/src/seed.ts');
  const { buildPlan } = await vite.ssrLoadModule('/src/optimizer.ts');
  const seed = createInitialData();
  const fixture = (count) => {
    const items = Array.from({ length: count }, (_, index) => ({
      ...structuredClone(seed.libraryItems[0]),
      id: `benchmark-item-${index}`,
      name: `Varied item ${index}`,
      category: 'other',
      dimensions: {
        length: 48 + (index * 37 % 153),
        width: 36 + (index * 53 % 127),
        height: 18 + (index * 29 % 103),
      },
      massGrams: 100,
      fragile: false,
      keepUpright: false,
    }));
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
    fixture: 'varied rectangular items in a 1000x800x500 mm bag',
    dimensions: '48-200 x 36-162 x 18-120 mm, deterministic per item index',
    node: process.version,
    warmupRunsPerSize: 1,
    measuredRuns: runs,
    results,
  }, null, 2));
} finally {
  await vite.close();
}
