import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { benchmarkMarkdown, benchmarkReport, newBenchmarkDataset, outcomeRate, parseBenchmarkDataset, parseBenchmarkSource, type BenchmarkSource, type PackingTrial } from './physical-benchmarks';
import { sourceFromBackup } from '../scripts/physical-benchmark';
import { createInitialData } from './seed';
const at = (seconds = 0) => new Date(Date.UTC(2026, 9, 1, 0, 0, seconds)).toISOString(), hash = 'a'.repeat(64);
function source(): BenchmarkSource { return parseBenchmarkSource({ format: 'packing-scanning-benchmark-source', version: 1, backupSha256: hash, exportedAt: at(), packId: 'pack', sample: false, mode: 'balanced', references: [{ id: 'item:box', label: 'Rigid box', target: 'item', currentDimensionsMm: { length: 100, width: 80, height: 40 }, currentOpeningMm: null, upperMassGrams: 20, massSource: 'estimated' }, { id: 'bag:case', label: 'Hard case', target: 'container_interior', currentDimensionsMm: { length: 500, width: 300, height: 200 }, currentOpeningMm: { length: 300, width: 200 }, upperMassGrams: 1000, massSource: 'measured' }], captures: [{ id: 'capture-box', referenceId: 'item:box', platform: 'android', method: 'arcore_depth', createdAt: at(5), rawDimensionsMm: { length: 110, width: 42, height: 80 } }, { id: 'capture-case', referenceId: 'bag:case', platform: 'android', method: 'arcore_depth', createdAt: at(25), rawDimensionsMm: { length: 540, width: 320, height: 210 } }], instances: [{ id: 'entry#1', referenceId: 'item:box', required: true, unavailable: false, packingFormId: null }], containerIds: ['bag:case'] }); }
function fixture() {
    const s = source(), d = newBenchmarkDataset(s, 'Synthetic arithmetic verification', hash);
    d.evidenceClass = 'synthetic';
    for (const ref of d.references)
        Object.assign(ref, { fixture: ref.target === 'item' ? 'rigid_box' : 'intruded_interior', state: 'Synthetic measured object state', measuredAt: at(), measurerId: 'synthetic-measurer', instrument: 'Synthetic fixture ruler/scale', method: 'Synthetic test data', dimensionsMm: ref.target === 'item' ? { length: 100, width: 40, height: 80 } : { length: 480, width: 280, height: 180 }, dimensionUncertaintyMm: { length: 1, width: 1, height: 1 } });
    d.scanAttempts = [{ id: 'scan-1', referenceId: 'item:box', referenceRevision: 1, status: 'completed', startedAt: at(), finishedAt: at(10), captureId: 'capture-box', reason: null }, { id: 'scan-2', referenceId: 'bag:case', referenceRevision: 1, status: 'completed', startedAt: at(20), finishedAt: at(30), captureId: 'capture-case', reason: null }, { id: 'scan-fail', referenceId: 'item:box', referenceRevision: 1, status: 'failed', startedAt: at(31), finishedAt: at(40), captureId: null, reason: 'Synthetic unsupported surface' }, { id: 'scan-cancel', referenceId: 'item:box', referenceRevision: 1, status: 'cancelled', startedAt: at(41), finishedAt: at(50), captureId: null, reason: 'Synthetic cancellation' }];
    d.artifacts.push({ id: 'plan', file: 'plan.txt', role: 'plan_sequence', sha256: hash });
    const t: PackingTrial = { ...structuredClone(d.packingTrials[0]), id: 'trial-good', status: 'completed', startedAt: at(), finishedAt: at(60), testerId: 'synthetic-independent', independentTester: true, blindedToPlanGeneration: true, planArtifactId: 'plan', packedInstanceIds: ['entry#1'], firstPlanFit: 'fail', finalFit: 'pass', closure: [{ containerId: 'bag:case', outcome: 'pass' }], replanCount: 2, totalPackedMassGrams: 1100, access: 'pass', damage: 'none', excessCompression: 'none' };
    d.packingTrials = [t, { ...structuredClone(t), id: 'trial-abort', status: 'aborted', packedInstanceIds: [], firstPlanFit: 'not_tested', finalFit: 'not_tested', closure: [{ containerId: 'bag:case', outcome: 'fail' }], replanCount: null, totalPackedMassGrams: null, independentTester: null, blindedToPlanGeneration: null }, { ...structuredClone(t), id: 'trial-unknown', firstPlanFit: 'fail', finalFit: 'fail', closure: [{ containerId: 'bag:case', outcome: 'not_tested' }], replanCount: 0, independentTester: false, blindedToPlanGeneration: false }];
    return { s, d };
}
describe('physical benchmark accounting and provenance', () => {
    it('preserves original native provenance without inventing legacy estimates or accepting contradictory records',()=>{
        const s=source(),record={id:s.captures[0].id,target:'item' as const,platform:'android' as const,method:'arcore_depth' as const,createdAt:at(5),completedPasses:3,modelStoredLocally:true,dimensionsEstimateMm:s.captures[0].rawDimensionsMm!,quality:{depthFrames:6,viewCount:3,confidenceThreshold:.8,voxelSizeMm:5}};
        s.captures[0].record=record;expect(parseBenchmarkSource(s).captures[0].record).toEqual(record);
        const legacy=structuredClone(s);delete legacy.captures[0].record!.dimensionsEstimateMm;legacy.captures[0].rawDimensionsMm=null;expect(parseBenchmarkSource(legacy).captures[0].record!.dimensionsEstimateMm).toBeUndefined();
        s.captures[0].record!.dimensionsEstimateMm={length:1,width:2,height:3};expect(()=>parseBenchmarkSource(s)).toThrow(/differ/);
    });
    it('binds scan comparisons to the measured reference revision and preserves measured openings', () => { const { s, d } = fixture(); d.references[1].openingMm = { length: 280, width: 175 }; d.references[1].openingUncertaintyMm = { length: 1, width: 2 }; const r = benchmarkReport(parseBenchmarkDataset(d, s), s); expect(r.references[1].openingMm).toEqual({ length: 280, width: 175 }); expect(benchmarkMarkdown(r)).toContain('280, 175'); d.references[0].revision = 2; expect(() => parseBenchmarkDataset(d, s)).toThrow(/revision/); });
    it('starts with missing measurements and unexecuted trials, never a physical success', () => { const s = source(), d = parseBenchmarkDataset(newBenchmarkDataset(s, 'unexecuted', hash), s), r = benchmarkReport(d, s); expect(r.evidenceClass).toBe('unexecuted'); expect(r.physicalAcceptanceVerified).toBe(false); expect(r.scanAttempts.attempted).toBe(0); expect(r.packing.firstPlanFit.observedPercent).toBeNull(); expect(d.references.every(r => r.dimensionsMm === null && r.massGrams === null)).toBe(true); expect(benchmarkMarkdown(r)).toContain('Not observed'); });
    it('compares the ORIGINAL sorted envelope and preserves reference uncertainty without using calibration', () => { const { s, d } = fixture(), r = benchmarkReport(parseBenchmarkDataset(d, s), s), c = r.scanComparisons[0]; expect(c.differenceMm).toEqual([10, 0, 2]); expect(c.relativeDifferencePercent).toEqual([10, 0, 5]); expect(c.currentRecordedDimensionsMm).toEqual({ length: 100, width: 80, height: 40 }); expect(c.referenceUncertaintyMm).toEqual({ length: 1, width: 1, height: 1 }); expect(r.scanAttempts.medianAbsoluteDifferenceMm).toBe(2); expect(r.scanAttempts.maximumAbsoluteDifferenceMm).toBe(10); });
    it('does not score a raw bag wall envelope as measured usable interior', () => { const { s, d } = fixture(), r = benchmarkReport(parseBenchmarkDataset(d, s), s); expect(r.scanComparisons[1]).toMatchObject({ comparable: false, differenceMm: null, referenceQuantity: 'usable_inside' }); expect(r.scanAttempts.comparable).toBe(1); expect(r.scanAttempts.unscoredCompleted).toBe(1); expect(r.coverage.find(c => c.fixture === 'intruded_interior')?.comparableCompletedScans).toBe(0); });
    it('includes failure, cancellation, abort and untested results in denominators', () => { const { s, d } = fixture(), r = benchmarkReport(parseBenchmarkDataset(d, s), s); expect(r.scanAttempts).toMatchObject({ attempted: 4, completed: 2, failed: 1, cancelled: 1, completionPercent: 50 }); expect(r.packing.closureAllBags).toMatchObject({ attempted: 3, passed: 1, failed: 1, unknown: 1, observedPercent: 50 }); expect(r.packing.closureAllBags.allAttemptLowerBoundPercent).toBeCloseTo(100 / 3); expect(r.packing.replanning).toMatchObject({ passed: 1, failed: 1, unknown: 1 }); expect(r.packing.aborted).toBe(1); });
    it('counts every selected bag for closure, with unknown distinct from failure', () => { expect(outcomeRate(['pass', 'fail', 'not_tested'])).toMatchObject({ passed: 1, failed: 1, unknown: 1, observedPercent: 50 }); expect(outcomeRate([]).observedPercent).toBeNull(); expect(outcomeRate(['not_tested']).allAttemptLowerBoundPercent).toBe(0); const { s, d } = fixture(); s.references.push({ ...s.references[1], id: 'bag:other' }); s.containerIds.push('bag:other'); d.references.push({ ...d.references[1], id: 'bag:other' }); for (const t of d.packingTrials)
        t.closure.push({ containerId: 'bag:other', outcome: 'not_tested' }); expect(benchmarkReport(parseBenchmarkDataset(d, s), s).packing.closureAllBags).toMatchObject({ passed: 0, failed: 1, unknown: 2 }); });
    it('uses recorded upper weights and tare, preserving unknown totals and measured mass separately', () => { const { s, d } = fixture(); let r = benchmarkReport(parseBenchmarkDataset(d, s), s); expect(r.trialResults[0]).toMatchObject({ recordedUpperMassGrams: 1020, totalPackedMassGrams: 1100, recordedMinusObservedMassGrams: -80 }); s.references[0].upperMassGrams = null; r = benchmarkReport(d, s); expect(r.trialResults[0].recordedUpperMassGrams).toBeNull(); expect(r.trialResults[0].recordedMinusObservedMassGrams).toBeNull(); });
    it('retains fixture gaps and avoids certification even when the operator declares physical observations', () => { const { s, d } = fixture(); d.evidenceClass = 'physical_observation'; d.device = { model: 'Synthetic model', os: 'Synthetic OS', appBuild: 'synthetic', scanPath: 'arcore_depth' }; d.conditions = { lighting: 'Synthetic', background: 'Synthetic', network: 'offline', operatorId: 'synthetic' }; const r = benchmarkReport(parseBenchmarkDataset(d, s), s); expect(r.physicalAcceptanceVerified).toBe(false); expect(r.rawSourceFilesVerified).toBe(false); expect(r.coverage.find(c => c.fixture === 'transparent_reflective')?.references).toBe(0); });
    it('requires physical device/condition provenance and a matching capture path', () => { const { s, d } = fixture(); d.evidenceClass = 'physical_observation'; expect(() => parseBenchmarkDataset(d, s)).toThrow(/provenance/); d.device = { model: 'M', os: 'O', appBuild: 'B', scanPath: 'guided_object_capture' }; d.conditions = { lighting: 'L', background: 'B', network: 'N', operatorId: 'U' }; expect(() => parseBenchmarkDataset(d, s)).toThrow(/device path/); });
    it('requires measurement provenance and refuses a fabricated uncertainty without a measurement', () => { const { s, d } = fixture(); d.references[0].instrument = null; expect(() => parseBenchmarkDataset(d, s)).toThrow(/measurement provenance/); d.references[0].dimensionsMm = null; expect(() => parseBenchmarkDataset(d, s)).toThrow(/uncertainty/); });
    it('refuses successful trials that omit required instances or silently lose pack coverage', () => { const { s, d } = fixture(); d.packingTrials[0].packedInstanceIds = []; d.packingTrials[0].excluded = [{ instanceId: 'entry#1', reason: 'Synthetic failure' }]; expect(() => parseBenchmarkDataset(d, s)).toThrow(/required/); d.packingTrials[0].finalFit = 'fail'; d.packingTrials[0].excluded = []; expect(() => parseBenchmarkDataset(d, s)).toThrow(/coverage/); });
    it('refuses duplicate captures, mismatched reference identities and impossible dates', () => { const { s, d } = fixture(); d.scanAttempts.push({ ...d.scanAttempts[0], id: 'duplicate' }); expect(() => parseBenchmarkDataset(d, s)).toThrow(/duplicated/); d.scanAttempts.pop(); d.scanAttempts[0].referenceId = 'bag:case'; expect(() => parseBenchmarkDataset(d, s)).toThrow(/missing/); d.scanAttempts[0].referenceId = 'item:box'; d.scanAttempts[0].startedAt = '2026-02-31T00:00:00Z'; expect(() => parseBenchmarkDataset(d, s)).toThrow(/startedAt/); });
    it('requires completed capture timestamps inside the attempt and ordered trial dates', () => { const { s, d } = fixture(); d.scanAttempts[0].finishedAt = at(4); expect(() => parseBenchmarkDataset(d, s)).toThrow(/outside/); d.scanAttempts[0].finishedAt = at(10); d.packingTrials[0].finishedAt = '2026-09-30T00:00:00Z'; expect(() => parseBenchmarkDataset(d, s)).toThrow(/timing/); });
    it('does not accept physical or success fields on an unexecuted template', () => { const s = source(), d = newBenchmarkDataset(s, 'pending', hash); d.packingTrials[0].firstPlanFit = 'pass'; expect(() => parseBenchmarkDataset(d, s)).toThrow(/unattempted/); const f = fixture(); f.d.evidenceClass = 'unexecuted'; expect(() => parseBenchmarkDataset(f.d, f.s)).toThrow(/unexecuted/); });
    it('rejects traversal, URLs, duplicate artifact IDs and unsafe Windows filenames', () => { const { s, d } = fixture(); for (const file of ['../secret', 'C:\\secret', 'https://example.com/secret', 'CON.json', 'folder/source.json']) {
        d.artifacts[0].file = file;
        expect(() => parseBenchmarkDataset(d, s)).toThrow(/filename/);
    } d.artifacts[0].file = 'source-records.json'; d.artifacts.push({ ...d.artifacts[0], file: 'other.json' }); expect(() => parseBenchmarkDataset(d, s)).toThrow(/duplicate/); });
    it('escapes untrusted report labels and never embeds URLs or HTML', () => { const { s, d } = fixture(); d.runId = '<img src="https://example.com/x"> [click](https://example.com)'; const md = benchmarkMarkdown(benchmarkReport(parseBenchmarkDataset(d, s), s)); expect(md).not.toContain('<img'); expect(md).toContain('&lt;img'); expect(md).not.toContain('[click](https'); });
});
describe('real local benchmark CLI', () => {
    const run = (args: string[]) => spawnSync(process.execPath, [resolve('scripts/physical-benchmark.ts'), ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true });
    it('attaches a plan to a new verified bundle without changing the original dataset or fabricating a trial', async () => { const s = source(), root = await mkdtemp(join(tmpdir(), '032-benchmark-attach-')), text = JSON.stringify(s), d = newBenchmarkDataset(s, 'unexecuted attachment', createHash('sha256').update(text).digest('hex')); await writeFile(join(root, 'source-records.json'), text); await writeFile(join(root, 'trial.json'), JSON.stringify(d)); const original = await readFile(join(root, 'trial.json')), plan = join(root, 'sequence.txt'), out = join(root, 'attached'); await writeFile(plan, 'Synthetic plan fixture, not physical packing evidence.'); let r = run(['attach', join(root, 'trial.json'), plan, out]); expect(r.status, r.stderr).toBe(0); expect(await readFile(join(root, 'trial.json'))).toEqual(original); const attached = JSON.parse(await readFile(join(out, 'trial.json'), 'utf8')); expect(attached.evidenceClass).toBe('unexecuted'); expect(attached.artifacts).toHaveLength(2); expect(attached.packingTrials[0].planArtifactId).toBeNull(); expect(run(['report', join(out, 'trial.json'), join(root, 'report')]).status).toBe(0); const sourceArtifact = attached.artifacts.find((a: {
        role: string;
    }) => a.role === 'source_records'); expect(sourceArtifact.sha256).toBe(d.artifacts[0].sha256); r = run(['attach', join(out, 'trial.json'), plan, join(root, 'duplicate')]); expect(r.status).toBe(1); await expect(access(join(root, 'duplicate'))).rejects.toThrow(); }, 30000);
    it('refuses malformed original dimensions, reversed mass ranges and invalid UTF-8 plan attachments', async () => { const data = createInitialData(), backup = { format: 'packing-scanning-backup', app: data }, item = data.libraryItems[0]; item.massRangeGrams = { min: 100, max: 50 }; expect(() => sourceFromBackup(backup, hash)).toThrow(/mass range/); delete item.massRangeGrams; item.dimensions.length = NaN; expect(() => sourceFromBackup(backup, hash)).toThrow(/dimensions/); const root = await mkdtemp(join(tmpdir(), '032-benchmark-binary-')), s = source(), text = JSON.stringify(s), d = newBenchmarkDataset(s, 'unexecuted', createHash('sha256').update(text).digest('hex')); await writeFile(join(root, 'source-records.json'), text); await writeFile(join(root, 'trial.json'), JSON.stringify(d)); await writeFile(join(root, 'binary.bin'), Uint8Array.from([255, 0, 255])); expect(run(['attach', join(root, 'trial.json'), join(root, 'binary.bin'), join(root, 'bad')]).status).toBe(1); await expect(access(join(root, 'bad'))).rejects.toThrow(); });
    it('prepares only selected records without photos, context, false measurements or calibration substitution', async () => {
        const data = createInitialData(), trip = data.trips[0], item = data.libraryItems.find(i => i.id === trip.entries[0].itemId)!;
        item.scan = { id: 'synthetic-capture', target: 'item', platform: 'android', method: 'arcore_depth', createdAt: at(5), completedPasses: 3, modelStoredLocally: true, dimensionsEstimateMm: { length: 110, width: 80, height: 42 } };
        item.dimensions = { length: 100, width: 80, height: 40 };
        const backup = { format: 'packing-scanning-backup', app: data, photos: [{ dataUrl: 'synthetic-private-photo' }], exportedAt: at(60) }, s = sourceFromBackup(backup, hash);
        expect(JSON.stringify(s)).not.toContain('synthetic-private-photo');
        expect(JSON.stringify(s)).not.toContain(trip.destination);
        expect(s.captures[0].rawDimensionsMm).toEqual(item.scan.dimensionsEstimateMm);
        expect(s.references[0].currentDimensionsMm).toEqual(item.dimensions);
        const root = await mkdtemp(join(tmpdir(), '032-benchmark-cli-')), input = join(root, 'backup.json'), bundle = join(root, 'bundle'), report = join(root, 'report');
        await writeFile(input, JSON.stringify(backup));
        expect(run(['prepare', input, bundle]).status).toBe(0);
        const trial = JSON.parse(await readFile(join(bundle, 'trial.json'), 'utf8'));
        expect(trial.evidenceClass).toBe('unexecuted');
        expect(trial.references.every((r: {
            dimensionsMm: unknown;
        }) => r.dimensionsMm === null)).toBe(true);
        expect(run(['report', join(bundle, 'trial.json'), report]).status).toBe(0);
        const r = JSON.parse(await readFile(join(report, 'report.json'), 'utf8'));
        expect(r.artifactsVerified).toHaveLength(1);
        expect(r.physicalAcceptanceVerified).toBe(false);
        expect(r.packing.attempted).toBe(0);
        const old = await readFile(join(bundle, 'trial.json'));
        expect(run(['prepare', input, bundle]).status).toBe(1);
        expect(await readFile(join(bundle, 'trial.json'))).toEqual(old);
        expect(run(['report', join(bundle, 'trial.json'), report]).status).toBe(1);
    }, 30000);
    it('writes an actual synthetic report, verifies hashes, and refuses changed or external artifacts without outputs', async () => {
        const { s, d } = fixture(), root = await mkdtemp(join(tmpdir(), '032-benchmark-integrity-')), snapshot = JSON.stringify(s), plan = 'Synthetic sequence ONLY. No physical packing trial.';
        await writeFile(join(root, 'source-records.json'), snapshot);
        await writeFile(join(root, 'plan.txt'), plan);
        d.artifacts[0].sha256 = createHash('sha256').update(snapshot).digest('hex');
        d.artifacts[1].sha256 = createHash('sha256').update(plan).digest('hex');
        const input = join(root, 'trial.json');
        await writeFile(input, JSON.stringify(d));
        let result = run(['report', input, join(root, 'report')]);
        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(await readFile(join(root, 'report/report.json'), 'utf8'));
        expect(report.scanComparisons[0].differenceMm).toEqual([10, 0, 2]);
        expect(report.evidenceClass).toBe('synthetic');
        expect(report.physicalAcceptanceVerified).toBe(false);
        await writeFile(join(root, 'plan.txt'), 'Changed');
        result = run(['report', input, join(root, 'bad-hash')]);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('hash mismatch');
        await expect(access(join(root, 'bad-hash'))).rejects.toThrow();
        d.artifacts[1].file = '../outside';
        await writeFile(input, JSON.stringify(d));
        expect(run(['report', input, join(root, 'bad-path')]).status).toBe(1);
        await expect(access(join(root, 'bad-path'))).rejects.toThrow();
    }, 30000);
    it('refuses missing/duplicate selected records and unbounded quantities instead of silently truncating', () => { const data = createInitialData(), backup = { format: 'packing-scanning-backup', app: data }; data.trips[0].entries[0].quantity = Infinity; expect(() => sourceFromBackup(backup, hash)).toThrow(/500/); data.trips[0].entries[0].quantity = 1; data.libraryItems.push(structuredClone(data.libraryItems[0])); expect(() => sourceFromBackup(backup, hash)).toThrow(/duplicated/); expect(() => sourceFromBackup(backup, hash, 'unknown')).toThrow(/absent/); });
});
