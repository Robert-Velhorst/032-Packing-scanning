import type { DimensionsMm, ScanRecord } from './types.ts';
import { parseScanResult } from './scanning/contract.ts';
export const fixtureClasses = ['rigid_box', 'cylinder', 'concave', 'handled', 'transparent_reflective', 'clothing_form', 'intruded_interior', 'opening_geometry', 'unclassified'] as const;
type FixtureClass = typeof fixtureClasses[number];
type Outcome = 'pass' | 'fail' | 'not_tested';
type EvidenceClass = 'unexecuted' | 'synthetic' | 'physical_observation';
export interface BenchmarkReference {
    id: string;
    label: string;
    target: 'item' | 'container_interior';
    fixture: FixtureClass;
    revision: number;
    quantity: 'outer_envelope' | 'usable_inside';
    state: string | null;
    measuredAt: string | null;
    measurerId: string | null;
    instrument: string | null;
    method: string | null;
    dimensionsMm: DimensionsMm | null;
    dimensionUncertaintyMm: DimensionsMm | null;
    openingMm: {
        length: number;
        width: number;
    } | null;
    openingUncertaintyMm: {
        length: number;
        width: number;
    } | null;
    massGrams: number | null;
    massUncertaintyGrams: number | null;
}
export interface BenchmarkCapture {
    id: string;
    referenceId: string;
    platform: 'android' | 'ios';
    method: 'arcore_depth' | 'guided_object_capture';
    createdAt: string;
    rawDimensionsMm: DimensionsMm | null;
    record?: ScanRecord;
}
export interface BenchmarkSource {
    format: 'packing-scanning-benchmark-source';
    version: 1;
    backupSha256: string;
    exportedAt: string | null;
    packId: string;
    sample: boolean;
    mode: string;
    references: Array<{
        id: string;
        label: string;
        target: 'item' | 'container_interior';
        currentDimensionsMm: DimensionsMm;
        currentOpeningMm: {
            length: number;
            width: number;
        } | null;
        upperMassGrams: number | null;
        massSource: string | null;
    }>;
    captures: BenchmarkCapture[];
    instances: Array<{
        id: string;
        referenceId: string;
        required: boolean;
        unavailable: boolean;
        packingFormId: string | null;
    }>;
    containerIds: string[];
}
export interface ScanAttempt {
    id: string;
    referenceId: string;
    referenceRevision: number;
    status: 'not_attempted' | 'completed' | 'failed' | 'cancelled';
    startedAt: string | null;
    finishedAt: string | null;
    captureId: string | null;
    reason: string | null;
}
export interface PackingTrial {
    id: string;
    status: 'not_attempted' | 'completed' | 'aborted';
    startedAt: string | null;
    finishedAt: string | null;
    testerId: string | null;
    independentTester: boolean | null;
    blindedToPlanGeneration: boolean | null;
    planArtifactId: string | null;
    packedInstanceIds: string[];
    excluded: Array<{
        instanceId: string;
        reason: string;
    }>;
    firstPlanFit: Outcome;
    finalFit: Outcome;
    closure: Array<{
        containerId: string;
        outcome: Outcome;
    }>;
    replanCount: number | null;
    failedSteps: Array<{
        instanceId: string;
        reason: string;
    }>;
    deviations: string[];
    access: Outcome;
    damage: 'none' | 'observed' | 'not_checked';
    excessCompression: 'none' | 'observed' | 'not_checked';
    totalPackedMassGrams: number | null;
}
export interface BenchmarkDataset {
    format: 'packing-scanning-physical-benchmark';
    version: 1;
    protocolVersion: '032-physical-v1';
    runId: string;
    evidenceClass: EvidenceClass;
    device: {
        model: string | null;
        os: string | null;
        appBuild: string | null;
        scanPath: string | null;
    };
    conditions: {
        lighting: string | null;
        background: string | null;
        network: string | null;
        operatorId: string | null;
    };
    artifacts: Array<{
        id: string;
        file: string;
        sha256: string;
        role: 'source_records' | 'plan_sequence' | 'measurement_note';
    }>;
    references: BenchmarkReference[];
    scanAttempts: ScanAttempt[];
    packingTrials: PackingTrial[];
}
type Obj = Record<string, unknown>;
const axes = ['length', 'width', 'height'] as const;
function fail(path: string): never { throw Error('Invalid benchmark field: ' + path); }
function object(v: unknown, p: string): Obj { if (!v || typeof v !== 'object' || Array.isArray(v))
    fail(p); return v as Obj; }
function text(v: unknown, p: string, max = 500): string { if (typeof v !== 'string' || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v))
    fail(p); return v; }
function nullableText(v: unknown, p: string): string | null { return v === null ? null : text(v, p); }
function number(v: unknown, p: string, min = 0, max = 1e7): number { if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    fail(p); return v; }
function integer(v: unknown, p: string, min = 0, max = 10000): number { const n = number(v, p, min, max); if (!Number.isInteger(n))
    fail(p); return n; }
function flag(v: unknown, p: string): boolean { if (typeof v !== 'boolean')
    fail(p); return v; }
function choice<T extends string>(v: unknown, options: readonly T[], p: string): T { if (typeof v !== 'string' || !options.includes(v as T))
    fail(p); return v as T; }
function array(v: unknown, p: string, max = 10000): unknown[] { if (!Array.isArray(v) || v.length > max)
    fail(p); return v; }
function date(v: unknown, p: string): string { const s = text(v, p, 40); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 19) !== s.slice(0, 19))
    fail(p); return s; }
function nullableDate(v: unknown, p: string): string | null { return v === null ? null : date(v, p); }
function dimensions(v: unknown, p: string, zero = false): DimensionsMm { const o = object(v, p); return Object.fromEntries(axes.map(a => [a, number(o[a], p + '.' + a, zero ? 0 : .001, 10000)])) as unknown as DimensionsMm; }
function nullableNumber(v: unknown, p: string): number | null { return v === null ? null : number(v, p); }
function opening(v: unknown, p: string, zero = false): {
    length: number;
    width: number;
} | null { if (v === null)
    return null; const o = object(v, p); return { length: number(o.length, p + '.length', zero ? 0 : .001, 10000), width: number(o.width, p + '.width', zero ? 0 : .001, 10000) }; }
function strings(v: unknown, p: string): string[] { return array(v, p, 500).map((s, i) => text(s, p + '.' + i)); }
function unique<T>(rows: T[], key: (row: T) => string, p: string): void { const seen = new Set<string>(); for (const r of rows) {
    const id = key(r);
    if (seen.has(id))
        fail(p + ' duplicate ' + id);
    seen.add(id);
} }
function outcomes(v: unknown, p: string): Outcome { return choice(v, ['pass', 'fail', 'not_tested'], p); }
function timing(start: string | null, end: string | null, p: string): void { if (start === null || end === null || Date.parse(end) < Date.parse(start))
    fail(p); }
function reasons(v: unknown, p: string): Array<{
    instanceId: string;
    reason: string;
}> { return array(v, p, 500).map((v, i) => { const o = object(v, p + '.' + i); return { instanceId: text(o.instanceId, p + '.instanceId'), reason: text(o.reason, p + '.reason', 1000) }; }); }
export function parseBenchmarkSource(value: unknown): BenchmarkSource {
    const o = object(value, 'source');
    choice(o.format, ['packing-scanning-benchmark-source'], 'source.format');
    if (o.version !== 1)
        fail('source.version');
    const refs = array(o.references, 'source.references', 200).map((v, i) => { const r = object(v, 'source.reference.' + i); return { id: text(r.id, 'reference.id'), label: text(r.label, 'reference.label'), target: choice(r.target, ['item', 'container_interior'], 'reference.target'), currentDimensionsMm: dimensions(r.currentDimensionsMm, 'reference.currentDimensionsMm'), currentOpeningMm: opening(r.currentOpeningMm, 'reference.currentOpeningMm'), upperMassGrams: nullableNumber(r.upperMassGrams, 'reference.upperMassGrams'), massSource: nullableText(r.massSource, 'reference.massSource') }; });
    const captures = array(o.captures, 'source.captures', 2000).map((v, i) => { const r = object(v, 'capture.' + i); const platform = choice(r.platform, ['android', 'ios'], 'capture.platform'), method = choice(r.method, ['arcore_depth', 'guided_object_capture'], 'capture.method'); if (platform === 'android' && method !== 'arcore_depth' || platform === 'ios' && method !== 'guided_object_capture')
        fail('capture.platform/method'); return { id: text(r.id, 'capture.id'), referenceId: text(r.referenceId, 'capture.referenceId'), platform, method, createdAt: date(r.createdAt, 'capture.createdAt'), rawDimensionsMm: r.rawDimensionsMm === null ? null : dimensions(r.rawDimensionsMm, 'capture.rawDimensionsMm') }; });
    const instances = array(o.instances, 'source.instances', 500).map(v => { const r = object(v, 'instance'); return { id: text(r.id, 'instance.id'), referenceId: text(r.referenceId, 'instance.referenceId'), required: flag(r.required, 'instance.required'), unavailable: flag(r.unavailable, 'instance.unavailable'), packingFormId: nullableText(r.packingFormId, 'instance.packingFormId') }; });
    const source: BenchmarkSource = { format: 'packing-scanning-benchmark-source', version: 1, backupSha256: hash(o.backupSha256, 'source.backupSha256'), exportedAt: nullableDate(o.exportedAt, 'source.exportedAt'), packId: text(o.packId, 'source.packId'), sample: flag(o.sample, 'source.sample'), mode: choice(o.mode, ['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'], 'source.mode'), references: refs, captures, instances, containerIds: strings(o.containerIds, 'source.containerIds') };
    unique(refs, r => r.id, 'source.references');
    unique(captures, r => r.id, 'source.captures');
    unique(instances, r => r.id, 'source.instances');
    unique(source.containerIds, r => r, 'source.containerIds');
    for (let index=0;index<captures.length;index++) {
        const r=captures[index],input=(o.captures as Obj[])[index];
        if(input.record!==undefined){
            const ref=refs.find(ref=>ref.id===r.referenceId);if(!ref)fail('capture reference missing');
            const record=object(input.record,'capture.record');
            parseScanResult({record,dimensionsMm:r.rawDimensionsMm??ref.currentDimensionsMm},ref.target);
            if(record.id!==r.id||record.createdAt!==r.createdAt||record.platform!==r.platform||record.method!==r.method)fail('capture metadata identity');
            const original=record.dimensionsEstimateMm===undefined?null:dimensions(record.dimensionsEstimateMm,'capture.record.dimensionsEstimateMm');
            if(JSON.stringify(original)!==JSON.stringify(r.rawDimensionsMm))fail('original capture dimensions differ');
            (r as BenchmarkCapture).record=structuredClone(record) as unknown as ScanRecord;
        }
    }
    for (const r of captures)
        if (!refs.some(ref => ref.id === r.referenceId))
            fail('capture reference missing');
    for (const r of instances)
        if (!refs.some(ref => ref.id === r.referenceId && ref.target === 'item'))
            fail('item reference missing');
    for (const id of source.containerIds)
        if (!refs.some(ref => ref.id === id && ref.target === 'container_interior'))
            fail('container reference missing');
    return source;
}
export function hash(v: unknown, p: string): string { const s = text(v, p, 64); if (!/^[0-9a-f]{64}$/.test(s))
    fail(p); return s; }
export function parseBenchmarkDataset(value: unknown, source: BenchmarkSource): BenchmarkDataset {
    const o = object(value, 'dataset');
    choice(o.format, ['packing-scanning-physical-benchmark'], 'format');
    if (o.version !== 1 || o.protocolVersion !== '032-physical-v1')
        fail('version/protocolVersion');
    const device = object(o.device, 'device'), conditions = object(o.conditions, 'conditions');
    const refs = array(o.references, 'references', 200).map((v, i) => {
        const r = object(v, 'reference.' + i);
        const ref: BenchmarkReference = { id: text(r.id, 'reference.id'), label: text(r.label, 'reference.label'), target: choice(r.target, ['item', 'container_interior'], 'reference.target'), fixture: choice(r.fixture, fixtureClasses, 'reference.fixture'), revision: integer(r.revision, 'reference.revision', 1), quantity: choice(r.quantity, ['outer_envelope', 'usable_inside'], 'reference.quantity'), state: nullableText(r.state, 'reference.state'), measuredAt: nullableDate(r.measuredAt, 'reference.measuredAt'), measurerId: nullableText(r.measurerId, 'reference.measurerId'), instrument: nullableText(r.instrument, 'reference.instrument'), method: nullableText(r.method, 'reference.method'), dimensionsMm: r.dimensionsMm === null ? null : dimensions(r.dimensionsMm, 'reference.dimensionsMm'), dimensionUncertaintyMm: r.dimensionUncertaintyMm === null ? null : dimensions(r.dimensionUncertaintyMm, 'reference.dimensionUncertaintyMm', true), openingMm: opening(r.openingMm, 'reference.openingMm'), openingUncertaintyMm: opening(r.openingUncertaintyMm, 'reference.openingUncertaintyMm', true), massGrams: nullableNumber(r.massGrams, 'reference.massGrams'), massUncertaintyGrams: nullableNumber(r.massUncertaintyGrams, 'reference.massUncertaintyGrams') };
        if (!source.references.some(s => s.id === ref.id && s.target === ref.target))
            fail('reference not in source');
        if (ref.target === 'item' && (ref.quantity === 'usable_inside' || ref.openingMm || ref.openingUncertaintyMm))
            fail('item usable_inside');
        if (ref.dimensionsMm || ref.massGrams !== null || ref.openingMm) {
            if (!ref.measuredAt || !ref.measurerId || !ref.instrument || !ref.method || !ref.state)
                fail('measurement provenance');
        }
        if (!ref.openingMm && ref.openingUncertaintyMm || !ref.dimensionsMm && ref.dimensionUncertaintyMm || ref.massGrams === null && ref.massUncertaintyGrams !== null)
            fail('uncertainty without measurement');
        return ref;
    });
    const scans = array(o.scanAttempts, 'scanAttempts', 5000).map(v => { const r = object(v, 'scan'); return { id: text(r.id, 'scan.id'), referenceId: text(r.referenceId, 'scan.referenceId'), referenceRevision: integer(r.referenceRevision, 'scan.referenceRevision', 1), status: choice(r.status, ['not_attempted', 'completed', 'failed', 'cancelled'], 'scan.status'), startedAt: nullableDate(r.startedAt, 'scan.startedAt'), finishedAt: nullableDate(r.finishedAt, 'scan.finishedAt'), captureId: nullableText(r.captureId, 'scan.captureId'), reason: nullableText(r.reason, 'scan.reason') } as ScanAttempt; });
    const trials = array(o.packingTrials, 'packingTrials', 1000).map(v => { const r = object(v, 'packingTrial'); return { id: text(r.id, 'trial.id'), status: choice(r.status, ['not_attempted', 'completed', 'aborted'], 'trial.status'), startedAt: nullableDate(r.startedAt, 'trial.startedAt'), finishedAt: nullableDate(r.finishedAt, 'trial.finishedAt'), testerId: nullableText(r.testerId, 'trial.testerId'), independentTester: r.independentTester === null ? null : flag(r.independentTester, 'trial.independentTester'), blindedToPlanGeneration: r.blindedToPlanGeneration === null ? null : flag(r.blindedToPlanGeneration, 'trial.blindedToPlanGeneration'), planArtifactId: nullableText(r.planArtifactId, 'trial.planArtifactId'), packedInstanceIds: strings(r.packedInstanceIds, 'trial.packedInstanceIds'), excluded: reasons(r.excluded, 'trial.excluded'), firstPlanFit: outcomes(r.firstPlanFit, 'trial.firstPlanFit'), finalFit: outcomes(r.finalFit, 'trial.finalFit'), closure: array(r.closure, 'trial.closure', 30).map(v => { const c = object(v, 'closure'); return { containerId: text(c.containerId, 'closure.containerId'), outcome: outcomes(c.outcome, 'closure.outcome') }; }), replanCount: r.replanCount === null ? null : integer(r.replanCount, 'trial.replanCount'), failedSteps: reasons(r.failedSteps, 'trial.failedSteps'), deviations: strings(r.deviations, 'trial.deviations'), access: outcomes(r.access, 'trial.access'), damage: choice(r.damage, ['none', 'observed', 'not_checked'], 'trial.damage'), excessCompression: choice(r.excessCompression, ['none', 'observed', 'not_checked'], 'trial.excessCompression'), totalPackedMassGrams: nullableNumber(r.totalPackedMassGrams, 'trial.totalPackedMassGrams') } as PackingTrial; });
    const artifacts = array(o.artifacts, 'artifacts', 100).map(v => { const a = object(v, 'artifact'), file = text(a.file, 'artifact.file', 120); if (!/^[A-Za-z0-9][A-Za-z0-9_. -]*$/.test(file) || file.includes('..') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file))
        fail('artifact filename'); return { id: text(a.id, 'artifact.id'), file, sha256: hash(a.sha256, 'artifact.sha256'), role: choice(a.role, ['source_records', 'plan_sequence', 'measurement_note'], 'artifact.role') }; });
    const data: BenchmarkDataset = { format: 'packing-scanning-physical-benchmark', version: 1, protocolVersion: '032-physical-v1', runId: text(o.runId, 'runId'), evidenceClass: choice(o.evidenceClass, ['unexecuted', 'synthetic', 'physical_observation'], 'evidenceClass'), device: { model: nullableText(device.model, 'device.model'), os: nullableText(device.os, 'device.os'), appBuild: nullableText(device.appBuild, 'device.appBuild'), scanPath: nullableText(device.scanPath, 'device.scanPath') }, conditions: { lighting: nullableText(conditions.lighting, 'conditions.lighting'), background: nullableText(conditions.background, 'conditions.background'), network: nullableText(conditions.network, 'conditions.network'), operatorId: nullableText(conditions.operatorId, 'conditions.operatorId') }, artifacts, references: refs, scanAttempts: scans, packingTrials: trials };
    unique(refs, r => r.id, 'references');
    unique(scans, r => r.id, 'scanAttempts');
    unique(trials, r => r.id, 'packingTrials');
    unique(artifacts, r => r.id, 'artifacts');
    unique(artifacts, r => r.file, 'artifact files');
    if (refs.length !== source.references.length || artifacts.filter(a => a.role === 'source_records').length !== 1)
        fail('reference/source coverage');
    const completedCaptures = new Set<string>();
    for (const s of scans) {
        if (!refs.some(r => r.id === s.referenceId && r.revision === s.referenceRevision))
            fail('scan reference/revision missing');
        if (s.status === 'not_attempted') {
            if (s.startedAt || s.finishedAt || s.captureId || s.reason)
                fail('unattempted scan has observations');
            continue;
        }
        timing(s.startedAt, s.finishedAt, 'scan timing');
        if (s.status === 'completed') {
            const c = source.captures.find(c => c.id === s.captureId && c.referenceId === s.referenceId);
            if (!c || completedCaptures.has(c.id))
                fail('scan capture missing or duplicated');
            completedCaptures.add(c.id);
            if (Date.parse(c.createdAt) < Date.parse(s.startedAt!) || Date.parse(c.createdAt) > Date.parse(s.finishedAt!))
                fail('capture outside scan timing');
        }
        else if (s.captureId || !s.reason)
            fail('failed/cancelled scan provenance');
    }
    for (const t of trials) {
        unique(t.packedInstanceIds, r => r, 'trial packed instances');
        unique(t.excluded, r => r.instanceId, 'trial exclusions');
        unique(t.closure, r => r.containerId, 'trial closure');
        for (const id of [...t.packedInstanceIds, ...t.excluded.map(r => r.instanceId), ...t.failedSteps.map(r => r.instanceId)])
            if (!source.instances.some(r => r.id === id))
                fail('trial instance missing');
        if (t.excluded.some(r => t.packedInstanceIds.includes(r.instanceId)))
            fail('packed and excluded instance');
        if (t.closure.length !== source.containerIds.length || t.closure.some(c => !source.containerIds.includes(c.containerId)))
            fail('closure container coverage');
        if (t.status === 'not_attempted') {
            if (t.startedAt || t.finishedAt || t.testerId || t.planArtifactId || t.replanCount !== null || t.totalPackedMassGrams !== null || t.packedInstanceIds.length || t.excluded.length || t.failedSteps.length || t.deviations.length || [t.firstPlanFit, t.finalFit, t.access, ...t.closure.map(c => c.outcome)].some(v => v !== 'not_tested') || t.damage !== 'not_checked' || t.excessCompression !== 'not_checked' || t.independentTester !== null || t.blindedToPlanGeneration !== null)
                fail('unattempted trial has observations');
            continue;
        }
        timing(t.startedAt, t.finishedAt, 'trial timing');
        if (!source.instances.length || !source.containerIds.length)
            fail('empty physical packing set');
        if (!t.testerId || !artifacts.some(a => a.id === t.planArtifactId && a.role === 'plan_sequence'))
            fail('trial tester/plan artifact');
        if (t.status === 'completed' && t.packedInstanceIds.length + t.excluded.length !== source.instances.length)
            fail('completed trial instance coverage');
        if ((t.firstPlanFit === 'pass' || t.finalFit === 'pass') && source.instances.some(i => i.required && !t.packedInstanceIds.includes(i.id)))
            fail('fit success omits required item');
    }
    const attempted = scans.some(s => s.status !== 'not_attempted') || trials.some(t => t.status !== 'not_attempted');
    if (data.evidenceClass === 'unexecuted' && attempted)
        fail('unexecuted dataset has trials');
    if (data.evidenceClass === 'physical_observation' && attempted && [...Object.values(data.device), ...Object.values(data.conditions)].some(v => v === null))
        fail('physical device/conditions provenance');
    if (data.evidenceClass === 'physical_observation' && scans.some(s => s.status === 'completed' && source.captures.find(c => c.id === s.captureId)!.method !== data.device.scanPath))
        fail('scan method differs from tested device path');
    return data;
}
export function newBenchmarkDataset(source: BenchmarkSource, runId: string, sourceSha256: string): BenchmarkDataset {
    return { format: 'packing-scanning-physical-benchmark', version: 1, protocolVersion: '032-physical-v1', runId, evidenceClass: 'unexecuted', device: { model: null, os: null, appBuild: null, scanPath: null }, conditions: { lighting: null, background: null, network: null, operatorId: null }, artifacts: [{ id: 'source', file: 'source-records.json', sha256: sourceSha256, role: 'source_records' }], references: source.references.map(r => ({ id: r.id, label: r.label, target: r.target, fixture: 'unclassified', revision: 1, quantity: r.target === 'item' ? 'outer_envelope' : 'usable_inside', state: null, measuredAt: null, measurerId: null, instrument: null, method: null, dimensionsMm: null, dimensionUncertaintyMm: null, openingMm: null, openingUncertaintyMm: null, massGrams: null, massUncertaintyGrams: null })), scanAttempts: [], packingTrials: [{ id: 'trial-1', status: 'not_attempted', startedAt: null, finishedAt: null, testerId: null, independentTester: null, blindedToPlanGeneration: null, planArtifactId: null, packedInstanceIds: [], excluded: [], firstPlanFit: 'not_tested', finalFit: 'not_tested', closure: source.containerIds.map(containerId => ({ containerId, outcome: 'not_tested' })), replanCount: null, failedSteps: [], deviations: [], access: 'not_tested', damage: 'not_checked', excessCompression: 'not_checked', totalPackedMassGrams: null }] };
}
export function outcomeRate(values: Outcome[]) { const passed = values.filter(v => v === 'pass').length, failed = values.filter(v => v === 'fail').length, unknown = values.length - passed - failed; return { attempted: values.length, passed, failed, unknown, observedPercent: passed + failed ? 100 * passed / (passed + failed) : null, allAttemptLowerBoundPercent: values.length ? 100 * passed / values.length : null }; }
function median(values: number[]): number | null { const s = [...values].sort((a, b) => a - b); return s.length ? s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2 : null; }
function sorted(d: DimensionsMm) { return axes.map(a => d[a]).sort((a, b) => b - a); }
export function benchmarkReport(data: BenchmarkDataset, source: BenchmarkSource) {
    const scans = data.scanAttempts.filter(s => s.status !== 'not_attempted'), trials = data.packingTrials.filter(t => t.status !== 'not_attempted');
    const scanComparisons = scans.filter(s => s.status === 'completed').map(s => {
        const capture = source.captures.find(c => c.id === s.captureId)!, ref = data.references.find(r => r.id === s.referenceId)!;
        const comparable = !!capture.rawDimensionsMm && !!ref.dimensionsMm && ref.quantity === 'outer_envelope';
        const differenceMm = comparable ? sorted(capture.rawDimensionsMm!).map((v, i) => v - sorted(ref.dimensionsMm!)[i]) : null;
        return { attemptId: s.id, referenceId: ref.id, referenceRevision: ref.revision, captureId: capture.id, comparable, reason: comparable ? null : !capture.rawDimensionsMm ? 'Original scan estimate unavailable' : !ref.dimensionsMm ? 'Measured reference unavailable' : 'Raw wall envelope and usable interior are different quantities', rawDimensionsMm: capture.rawDimensionsMm, measuredDimensionsMm: ref.dimensionsMm, referenceQuantity: ref.quantity, referenceUncertaintyMm: ref.dimensionUncertaintyMm, differenceMm, relativeDifferencePercent: differenceMm?.map((v, i) => 100 * v / sorted(ref.dimensionsMm!)[i]) ?? null, currentRecordedDimensionsMm: source.references.find(r => r.id === ref.id)!.currentDimensionsMm };
    });
    const abs = scanComparisons.flatMap(s => s.differenceMm?.map(Math.abs) ?? []);
    const trialResults = trials.map(t => {
        const requiredExcluded = source.instances.filter(i => i.required && !t.packedInstanceIds.includes(i.id)).map(i => i.id), ids = t.packedInstanceIds.map(id => source.instances.find(i => i.id === id)!.referenceId);
        const weights = [...ids, ...source.containerIds].map(id => source.references.find(r => r.id === id)!.upperMassGrams), completeMass = weights.every(w => w !== null);
        const recordedUpperMassGrams = completeMass ? weights.reduce<number>((n, w) => n + w!, 0) : null;
        return { id: t.id, status: t.status, durationSeconds: (Date.parse(t.finishedAt!) - Date.parse(t.startedAt!)) / 1000, independentTester: t.independentTester, blindedToPlanGeneration: t.blindedToPlanGeneration, firstPlanFit: t.firstPlanFit, finalFit: t.finalFit, closure: t.closure, requiredExcluded, excluded: t.excluded, replanCount: t.replanCount, failedSteps: t.failedSteps, deviations: t.deviations, access: t.access, damage: t.damage, excessCompression: t.excessCompression, totalPackedMassGrams: t.totalPackedMassGrams, recordedUpperMassGrams, recordedMinusObservedMassGrams: recordedUpperMassGrams !== null && t.totalPackedMassGrams !== null ? recordedUpperMassGrams - t.totalPackedMassGrams : null };
    });
    const coverage = fixtureClasses.filter(f => f !== 'unclassified').map(fixture => ({ fixture, references: data.references.filter(r => r.fixture === fixture).length, measuredReferences: data.references.filter(r => r.fixture === fixture && r.dimensionsMm).length, comparableCompletedScans: scanComparisons.filter(c => c.comparable && data.references.find(r => r.id === c.referenceId)!.fixture === fixture).length }));
    return { format: 'packing-scanning-benchmark-report', version: 1, runId: data.runId, evidenceClass: data.evidenceClass, physicalAcceptanceVerified: false, rawSourceFilesVerified: false, backupWasSample: source.sample, device: data.device, conditions: data.conditions, referenceCount: data.references.length, references: data.references, coverage, scanAttempts: { planned: data.scanAttempts.length, attempted: scans.length, completed: scans.filter(s => s.status === 'completed').length, failed: scans.filter(s => s.status === 'failed').length, cancelled: scans.filter(s => s.status === 'cancelled').length, completionPercent: scans.length ? 100 * scans.filter(s => s.status === 'completed').length / scans.length : null, medianDurationSeconds: median(scans.map(s => (Date.parse(s.finishedAt!) - Date.parse(s.startedAt!)) / 1000)), medianCompletedDurationSeconds: median(scans.filter(s => s.status === 'completed').map(s => (Date.parse(s.finishedAt!) - Date.parse(s.startedAt!)) / 1000)), comparable: scanComparisons.filter(s => s.comparable).length, unscoredCompleted: scanComparisons.filter(s => !s.comparable).length, medianAbsoluteDifferenceMm: median(abs), maximumAbsoluteDifferenceMm: abs.length ? Math.max(...abs) : null }, scanComparisons, packing: { planned: data.packingTrials.length, attempted: trials.length, completed: trials.filter(t => t.status === 'completed').length, aborted: trials.filter(t => t.status === 'aborted').length, firstPlanFit: outcomeRate(trials.map(t => t.firstPlanFit)), finalFit: outcomeRate(trials.map(t => t.finalFit)), closureAllBags: outcomeRate(trials.map(t => t.closure.some(c => c.outcome === 'fail') ? 'fail' : t.closure.some(c => c.outcome === 'not_tested') || !t.closure.length ? 'not_tested' : 'pass')), replanning: outcomeRate(trials.map(t => t.replanCount === null ? 'not_tested' : t.replanCount > 0 ? 'pass' : 'fail')), independentTrials: trials.filter(t => t.independentTester === true).length, blindedTrials: trials.filter(t => t.blindedToPlanGeneration === true).length, medianDurationSeconds: median(trialResults.map(t => t.durationSeconds)) }, trialResults };
}
export function benchmarkMarkdown(report: ReturnType<typeof benchmarkReport>): string {
    const md = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&');
    const n = (v: number | null) => v === null ? 'Not observed' : String(Math.round(v * 1000) / 1000);
    const unit=(v:number|null,suffix:string)=>v===null?'Not observed':n(v)+suffix;
    const rate = (r: ReturnType<typeof outcomeRate>) => `${r.passed} / ${r.attempted} attempted; ${r.failed} negative; ${r.unknown} untested. Observed rate: ${unit(r.observedPercent,'%')}; all-attempt lower bound: ${unit(r.allAttemptLowerBoundPercent,'%')}`;
    const lines = ['# Packing Scanning physical benchmark report', '', `Evidence class: **${report.evidenceClass}**. ${report.evidenceClass === 'physical_observation' ? 'Physical observations are operator-reported, not independently certified.' : 'No physical validation is established by this dataset.'}`, '', '**Physical acceptance is not established by this report. Original scan files are not verified.**', `Run: ${md(report.runId)}. Source pack was an example: ${report.backupWasSample ? 'yes' : 'no'}.`, '', '## Device and conditions', '', ...Object.entries({ ...report.device, ...report.conditions }).map(([k, v]) => `- ${k}: ${v === null ? 'Not recorded' : md(v)}`), '', '## Scan results', '', `Attempts: ${report.scanAttempts.attempted}; completed: ${report.scanAttempts.completed}; failed: ${report.scanAttempts.failed}; cancelled: ${report.scanAttempts.cancelled}. Completion: ${unit(report.scanAttempts.completionPercent,'%')}.`, `Median duration across all attempts: ${unit(report.scanAttempts.medianDurationSeconds,' seconds')}; completed scans: ${unit(report.scanAttempts.medianCompletedDurationSeconds,' seconds')}. Comparable completed scans: ${report.scanAttempts.comparable}; unscored completed scans: ${report.scanAttempts.unscoredCompleted}.`, `Median absolute difference from the measured reference: ${unit(report.scanAttempts.medianAbsoluteDifferenceMm,' mm')}; maximum: ${unit(report.scanAttempts.maximumAbsoluteDifferenceMm,' mm')}.`, '', 'Signed differences use longest, middle and shortest edges, each sorted independently. This removes axis naming differences but does not validate shape, openings, completeness or fit. Reference uncertainty is retained, not treated as zero or converted to a confidence interval. Current edited/calibrated dimensions are separate and never replace the original scan estimate.', '', '| Attempt | Reference | Signed edge differences (mm) | Status |', '| --- | --- | --- | --- |', ...report.scanComparisons.map(c => `| ${md(c.attemptId)} | ${md(c.referenceId)} revision ${c.referenceRevision} | ${c.differenceMm?.map(n).join(', ') ?? 'Not scored'} | ${md(c.reason ?? 'Compared with recorded measured reference')} |`), '', '## Physical packing outcomes', '', `Attempted: ${report.packing.attempted}; completed: ${report.packing.completed}; aborted: ${report.packing.aborted}.`, '', `- First-plan fit: ${rate(report.packing.firstPlanFit)}`, `- Final fit: ${rate(report.packing.finalFit)}`, `- Closure of every bag: ${rate(report.packing.closureAllBags)}`, `- Needed at least one replan: ${rate(report.packing.replanning)}`, `- Independent testers: ${report.packing.independentTrials}; blinded trials: ${report.packing.blindedTrials}.`, `- Median packing time: ${unit(report.packing.medianDurationSeconds,' seconds')}.`, '', '## Fixture coverage', '', '| Fixture | References | Measured references | Comparable scans |', '| --- | --- | --- | --- |', ...report.coverage.map(c => `| ${c.fixture} | ${c.references} | ${c.measuredReferences} | ${c.comparableCompletedScans} |`), '', '## Trial observations', ''];
    for (const t of report.trialResults)
        lines.push(`### ${md(t.id)}`, '', `Status: ${t.status}; initial fit: ${t.firstPlanFit}; final fit: ${t.finalFit}; replans: ${n(t.replanCount)}.`, `Required instances outside the packed set: ${t.requiredExcluded.map(md).join(', ') || 'none'}.`, `Bag closure: ${t.closure.map(c => md(c.containerId) + ': ' + c.outcome).join('; ')}.`, `Recorded upper combined mass: ${unit(t.recordedUpperMassGrams,' g')}; observed packed mass: ${unit(t.totalPackedMassGrams,' g')}; recorded minus observed: ${unit(t.recordedMinusObservedMassGrams,' g')}. Recorded mass is not scanner-measured mass.`, `Access: ${t.access}; damage: ${t.damage}; excessive compression: ${t.excessCompression}.`, ...t.excluded.map(e => `- Excluded ${md(e.instanceId)}: ${md(e.reason)}`), ...t.failedSteps.map(e => `- Failed step ${md(e.instanceId)}: ${md(e.reason)}`), ...t.deviations.map(d => `- Deviation: ${md(d)}`), '');
    lines.push('## Measured reference records', '');
    for (const r of report.references)
        lines.push(`### ${md(r.label)} (${md(r.id)}) revision ${r.revision}`, '', `Fixture: ${r.fixture}; quantity: ${r.quantity}; physical state: ${r.state === null ? 'Not recorded' : md(r.state)}.`, `Dimensions (length, width, height): ${r.dimensionsMm ? axes.map(a => n(r.dimensionsMm![a])).join(', ') : 'Not measured'} mm. Recorded uncertainty: ${r.dimensionUncertaintyMm ? axes.map(a => n(r.dimensionUncertaintyMm![a])).join(', ') : 'Not recorded'} mm.`, `Measured opening (length, width): ${r.openingMm ? n(r.openingMm.length) + ', ' + n(r.openingMm.width) : 'Not measured'} mm; uncertainty: ${r.openingUncertaintyMm ? n(r.openingUncertaintyMm.length) + ', ' + n(r.openingUncertaintyMm.width) : 'Not recorded'} mm.`, `Mass: ${unit(r.massGrams,' g')}; recorded uncertainty: ${unit(r.massUncertaintyGrams,' g')}.`, `Measured at: ${r.measuredAt ?? 'Not recorded'}; measurer: ${r.measurerId === null ? 'Not recorded' : md(r.measurerId)}; instrument: ${r.instrument === null ? 'Not recorded' : md(r.instrument)}; method: ${r.method === null ? 'Not recorded' : md(r.method)}.`, '');
    lines.push('No pass/fail accuracy threshold or acceptance certification is inferred. Missing outcomes remain visible. This is a local report; nothing is uploaded.');
    return lines.join('\n') + '\n';
}
