import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { aggregateBenchmarks, aggregateMarkdown } from './benchmark-aggregation';
import { newBenchmarkDataset, parseBenchmarkSource } from './physical-benchmarks';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const at = (seconds: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString();
function fixture(id = 'one', offset = 0) {
  const source = parseBenchmarkSource({ format: 'packing-scanning-benchmark-source', version: 1, backupSha256: sha(id), exportedAt: at(offset), packId: 'pack', sample: false, mode: 'balanced',
    references: [{ id: 'item:box', label: 'Synthetic box', target: 'item', currentDimensionsMm: { length: 100, width: 80, height: 40 }, currentOpeningMm: null, upperMassGrams: 20, massSource: 'estimated' }, { id: 'bag:case', label: 'Synthetic case', target: 'container_interior', currentDimensionsMm: { length: 500, width: 300, height: 200 }, currentOpeningMm: { length: 300, width: 200 }, upperMassGrams: 1000, massSource: 'measured' }],
    captures: [{ id: 'capture-' + id, referenceId: 'item:box', platform: 'android', method: 'arcore_depth', createdAt: at(offset + 5), rawDimensionsMm: { length: 110, width: 80, height: 42 } }],
    instances: [{ id: 'entry#1', referenceId: 'item:box', required: true, unavailable: false, packingFormId: null }], containerIds: ['bag:case'] });
  const dataset = newBenchmarkDataset(source, id, sha(JSON.stringify(source)));
  dataset.evidenceClass = 'synthetic';
  dataset.device = { model: 'Synthetic device A', os: 'Synthetic OS', appBuild: 'Synthetic build', scanPath: 'arcore_depth' };
  dataset.conditions = { lighting: 'Synthetic indoor', background: 'Synthetic plain', network: 'offline', operatorId: 'synthetic-operator' };
  Object.assign(dataset.references[0], { fixture: 'rigid_box', dimensionsMm: { length: 100, width: 80, height: 40 }, dimensionUncertaintyMm: { length: 1, width: 1, height: 1 }, state: 'Synthetic fixture state', measuredAt: at(offset), measurerId: 'synthetic-measurer', instrument: 'Synthetic ruler', method: 'Synthetic test data' });
  dataset.scanAttempts = [{ id: 'scan', referenceId: 'item:box', referenceRevision: 1, status: 'completed', startedAt: at(offset), finishedAt: at(offset + 10), captureId: source.captures[0].id, reason: null }];
  dataset.artifacts.push({ id: 'plan', file: 'plan.txt', sha256: sha('synthetic plan'), role: 'plan_sequence' });
  Object.assign(dataset.packingTrials[0], { status: 'completed', startedAt: at(offset + 20), finishedAt: at(offset + 80), testerId: 'synthetic-tester', independentTester: true, blindedToPlanGeneration: true, planArtifactId: 'plan', packedInstanceIds: ['entry#1'], firstPlanFit: 'pass', finalFit: 'pass', closure: [{ containerId: 'bag:case', outcome: 'pass' }], replanCount: 0, access: 'pass', damage: 'none', excessCompression: 'none', totalPackedMassGrams: 1050 });
  return { source, dataset, datasetSha256: sha(id + ':dataset') };
}
describe('benchmark aggregation', () => {
  it('pools raw observations and keeps local reference revisions and uncertainties without mutating input', () => {
    const a = fixture(), b = fixture('two', 100);
    b.dataset.references[0].revision = 2; b.dataset.scanAttempts[0].referenceRevision = 2;
    b.dataset.references[0].dimensionsMm!.length = 90;
    const before = structuredClone([a, b]);
    const r = aggregateBenchmarks([a, b]), s = r.evidenceSummaries.find(s => s.evidenceClass === 'synthetic')!;
    expect(s.scanAttempts).toMatchObject({ attempted: 2, comparable: 2, comparedEdgeCount: 6, medianAbsoluteDifferenceMm: 2, maximumAbsoluteDifferenceMm: 20 });
    expect(s.referenceRecordCount).toBe(4); expect(r.runs[1].report.references[0].revision).toBe(2);
    expect(r.runs[0].report.scanComparisons[0].referenceUncertaintyMm).toEqual({ length: 1, width: 1, height: 1 });
    expect([a, b]).toEqual(before);
    expect(r.physicalAcceptanceVerified).toBe(false); expect(r.rawSourceFilesVerified).toBe(false);
    expect(r.declaredArtifactsVerified).toBe(false);
  });
  it('never mixes synthetic or unexecuted records into physical performance', () => {
    const a = fixture(), b = fixture('two', 100), c = fixture('pending', 200);
    b.dataset.evidenceClass = 'physical_observation'; // Arithmetic fixture only; no actual physical observation.
    c.dataset = newBenchmarkDataset(c.source, 'pending', sha('source'));
    const r = aggregateBenchmarks([a, b, c]);
    expect(r.evidenceSummaries.map(s => [s.evidenceClass, s.runCount, s.scanAttempts.attempted])).toEqual([['physical_observation', 1, 1], ['synthetic', 1, 1], ['unexecuted', 1, 0]]);
    expect(r.deviceGroups).toHaveLength(3); expect(r.evidenceSummaries[2].packing.finalFit.observedPercent).toBeNull();
    expect(r.physicalAcceptanceVerified).toBe(false);
  });
  it('uses attempt denominators rather than averaging run percentages and includes failures, cancellations and aborts', () => {
    const a = fixture(), b = fixture('two', 100);
    b.dataset.scanAttempts.push({ ...b.dataset.scanAttempts[0], id: 'failure', status: 'failed', captureId: null, startedAt: at(111), finishedAt: at(115), reason: 'Synthetic failure' }, { ...b.dataset.scanAttempts[0], id: 'cancelled', status: 'cancelled', captureId: null, startedAt: at(116), finishedAt: at(120), reason: 'Synthetic cancellation' });
    Object.assign(b.dataset.packingTrials[0], { status: 'aborted', firstPlanFit: 'not_tested', finalFit: 'not_tested', closure: [{ containerId: 'bag:case', outcome: 'not_tested' }], replanCount: null, independentTester: null, blindedToPlanGeneration: null, access: 'not_tested', damage: 'not_checked', excessCompression: 'not_checked', totalPackedMassGrams: null });
    const s = aggregateBenchmarks([a, b]).evidenceSummaries[1];
    expect(s.scanAttempts).toMatchObject({ attempted: 4, completed: 2, failed: 1, cancelled: 1, completionPercent: 50 });
    expect(s.packing.finalFit).toMatchObject({ attempted: 2, passed: 1, unknown: 1, observedPercent: 100, allAttemptLowerBoundPercent: 50 });
    expect(s.packing).toMatchObject({ aborted: 1, unknownIndependence: 1, unknownBlinding: 1, unweighedTrials: 1 });
    expect(s.packing.damage.notChecked).toBe(1); expect(s.coverage[0]).toMatchObject({ attemptedScans: 4, failedScans: 1, cancelledScans: 1 });
  });
  it('computes medians over raw values instead of medians of run medians', () => {
    const a = fixture(), b = fixture('two', 100);
    b.source.captures[0].rawDimensionsMm = { length: 200, width: 180, height: 140 };
    b.dataset.scanAttempts.push({ ...b.dataset.scanAttempts[0], id: 'failed', status: 'failed', captureId: null, startedAt: at(112), finishedAt: at(113), reason: 'Synthetic failure' });
    expect(aggregateBenchmarks([a, b]).evidenceSummaries[1].scanAttempts).toMatchObject({ medianDurationSeconds: 10, medianAbsoluteDifferenceMm: 55 });
  });
  it('stratifies exact device, OS, build, path and conditions while retaining run IDs', () => {
    const a = fixture(), b = fixture('two', 100), c = fixture('three', 200);
    b.dataset.conditions.lighting = 'Synthetic dim'; c.dataset.device.appBuild = 'Synthetic newer build';
    const r = aggregateBenchmarks([a, b, c]); expect(r.deviceGroups).toHaveLength(2); expect(r.conditionGroups).toHaveLength(3);
    expect(r.deviceGroups[0].runIds).toEqual(['one', 'two']); expect(r.deviceGroups[1].runIds).toEqual(['three']);
  });
  it('preserves missing original dimensions and incompatible bag quantities as unscored, not zero differences', () => {
    const a = fixture(); a.source.captures[0].rawDimensionsMm = null;
    const r = aggregateBenchmarks([a]); expect(r.evidenceSummaries[1].scanAttempts).toMatchObject({ unscoredCompleted: 1, comparable: 0, medianAbsoluteDifferenceMm: null });
    const b = fixture('bag', 100); b.source.captures[0].referenceId = 'bag:case'; b.dataset.scanAttempts[0].referenceId = 'bag:case';
    Object.assign(b.dataset.references[1], { dimensionsMm: { length: 500, width: 300, height: 200 }, measuredAt: at(100), measurerId: 'synthetic', instrument: 'synthetic', method: 'synthetic', state: 'synthetic' });
    expect(aggregateBenchmarks([b]).runs[0].report.scanComparisons[0].comparable).toBe(false);
  });
  it('exposes absent fixture classes, unclassified records and sample-source counts', () => {
    const a = fixture(); a.source.sample = true; const s = aggregateBenchmarks([a]).evidenceSummaries[1];
    expect(s.sampleRunCount).toBe(1); expect(s.coverage.find(c => c.fixture === 'cylinder')?.referenceRecords).toBe(0);
    expect(s.coverage.find(c => c.fixture === 'unclassified')?.referenceRecords).toBe(1);
  });
  it('rejects repeated run IDs and dataset bytes instead of silently adding or dropping them', () => {
    const a = fixture(), b = fixture('two', 100); b.dataset.runId = a.dataset.runId;
    expect(() => aggregateBenchmarks([a, b])).toThrow(/run ID/); b.dataset.runId = 'two'; b.datasetSha256 = a.datasetSha256;
    expect(() => aggregateBenchmarks([a, b])).toThrow(/dataset evidence/);
  });
  it('rejects repeated completed captures even after the run is renamed or reclassified', () => {
    const a = fixture(), b = fixture('two', 100); b.source.captures = structuredClone(a.source.captures); b.dataset.scanAttempts = structuredClone(a.dataset.scanAttempts); b.dataset.evidenceClass = 'physical_observation';
    expect(() => aggregateBenchmarks([a, b])).toThrow(/completed capture/);
  });
  it('rejects copied failed observations and packing trials whose local IDs are changed', () => {
    const a = fixture(), b = fixture('two', 100);
    a.dataset.scanAttempts[0] = { ...a.dataset.scanAttempts[0], status: 'failed', captureId: null, reason: 'Synthetic failure' };
    b.dataset.scanAttempts = structuredClone(a.dataset.scanAttempts); b.dataset.scanAttempts[0].id = 'renamed';
    expect(() => aggregateBenchmarks([a, b])).toThrow(/scan attempt/);
    b.dataset.scanAttempts = []; b.dataset.packingTrials = structuredClone(a.dataset.packingTrials); b.dataset.packingTrials[0].id = 'renamed';
    expect(() => aggregateBenchmarks([a, b])).toThrow(/packing trial/);
  });
  it('revalidates raw records and input bounds rather than trusting previously generated reports', () => {
    const a = fixture(); a.dataset.packingTrials[0].packedInstanceIds = [];
    expect(() => aggregateBenchmarks([a])).toThrow(/coverage|required/);
    expect(() => aggregateBenchmarks([])).toThrow(/1–50/); expect(() => aggregateBenchmarks(Array(51).fill(fixture()))).toThrow(/1–50/);
    const b = fixture(); b.datasetSha256 = 'invalid'; expect(() => aggregateBenchmarks([b])).toThrow(/datasetSha256/);
  });
  it('escapes untrusted device labels, conditions and run identities in Markdown', () => {
    const a = fixture(); a.dataset.device.model = '<img src="https://example.test">'; a.dataset.conditions.lighting = '[click](https://example.test)';
    const md = aggregateMarkdown(aggregateBenchmarks([a])); expect(md).not.toContain('<img'); expect(md).not.toContain('[click](https:'); expect(md).toContain('&lt;img'); expect(md).toContain('not unique physical objects');
  });
});

describe('local aggregate command', () => {
  const run = (args: string[]) => spawnSync(process.execPath, [resolve('scripts/physical-benchmark.ts'), ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  async function bundle(root: string, id: string, offset: number) {
    const f = fixture(id, offset), sourceText = JSON.stringify(f.source), plan = 'Synthetic sequence; no physical observation';
    f.dataset.artifacts[0].file = id + '-source.json'; f.dataset.artifacts[0].sha256 = sha(sourceText);
    f.dataset.artifacts[1].file = id + '-plan.txt'; f.dataset.artifacts[1].sha256 = sha(plan);
    await writeFile(join(root, f.dataset.artifacts[0].file), sourceText); await writeFile(join(root, f.dataset.artifacts[1].file), plan);
    const file = join(root, id + '-trial.json'); await writeFile(file, JSON.stringify(f.dataset)); return file;
  }
  it('verifies all artifacts, writes actual aggregate outputs and preserves input bytes and existing output', async () => {
    const root = await mkdtemp(join(tmpdir(), '032-aggregate-')), a = await bundle(root, 'one', 0), b = await bundle(root, 'two', 100), before = await readFile(a), out = join(root, 'result');
    const result = run(['aggregate', out, a, b]); expect(result.status, result.stderr).toBe(0);
    const r = JSON.parse(await readFile(join(out, 'aggregate.json'), 'utf8')); expect(r.runCount).toBe(2); expect(r.artifactsVerified).toHaveLength(2); expect(r.declaredArtifactsVerified).toBe(true);
    expect(r.evidenceSummaries[0].scanAttempts.attempted).toBe(0); expect(r.evidenceSummaries[1].scanAttempts.attempted).toBe(2);
    expect(await readFile(a)).toEqual(before); const old = await readFile(join(out, 'aggregate.json'));
    expect(run(['aggregate', out, a, b]).status).toBe(1); expect(await readFile(join(out, 'aggregate.json'))).toEqual(old);
  }, 30000);
  it('fails before creating output when a later artifact changes or duplicate packet is selected', async () => {
    const root = await mkdtemp(join(tmpdir(), '032-aggregate-invalid-')), a = await bundle(root, 'one', 0), b = await bundle(root, 'two', 100);
    const duplicate = join(root, 'duplicate'); expect(run(['aggregate', duplicate, a, a]).status).toBe(1); await expect(access(duplicate)).rejects.toThrow();
    await writeFile(join(root, 'two-plan.txt'), 'Changed evidence'); const out = join(root, 'tampered');
    const r = run(['aggregate', out, a, b]); expect(r.status).toBe(1); expect(r.stderr).toContain('hash mismatch'); await expect(access(out)).rejects.toThrow();
  }, 30000);
});
