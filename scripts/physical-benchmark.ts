import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateBenchmarks, aggregateMarkdown, type BenchmarkRunInput } from '../src/benchmark-aggregation.ts';
import { benchmarkMarkdown, benchmarkReport, newBenchmarkDataset, parseBenchmarkDataset, parseBenchmarkSource, type BenchmarkSource } from '../src/physical-benchmarks.ts';
const MAX_BYTES = 64 * 1024 * 1024;
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
async function input(file: string) { const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
    throw Error('Input must be a regular file no larger than 64 MiB.'); const bytes = await readFile(file); if (bytes.length > MAX_BYTES)
    throw Error('Input is too large.'); return bytes; }
function object(v: unknown, name: string): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('Invalid backup ' + name + '.'); return v as Record<string, unknown>; }
function rows(v: unknown, name: string, max = 2000) { if (!Array.isArray(v) || v.length > max)
    throw Error('Invalid or oversized backup ' + name + '.'); return v.map(r => object(r, name)); }
function word(v: unknown, name: string): string { if (typeof v !== 'string' || !v.trim() || v.length > 400 || /[\x00-\x1f\x7f]/.test(v))
    throw Error('Invalid backup ' + name + '.'); return v; }
function positive(v: unknown): number { if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 10000)
    throw Error('Invalid metric dimensions in the selected pack.'); return v; }
function dimensions(v: unknown) { const d = object(v, 'dimensions'); return { length: positive(d.length), width: positive(d.width), height: positive(d.height) }; }
function weight(v: unknown): number | null { if (v === undefined)
    return null; if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e7)
    throw Error('Invalid recorded mass in the selected pack.'); return v; }
function massSource(v: unknown): string | null { if (v === undefined)
    return null; const e = object(v, 'mass evidence'); return typeof e.source === 'string' ? e.source : null; }
export function sourceFromBackup(value: unknown, backupSha256: string, packId?: string): BenchmarkSource {
    const backup = object(value, 'document');
    if (backup.format !== 'packing-scanning-backup')
        throw Error('Use an ordinary Packing Scanning backup, not a private metadata-only account backup without capture provenance.');
    const app = object(backup.app, 'app');
    if (app.schemaVersion !== 1)
        throw Error('Unsupported app schema.');
    const trips = rows(app.trips, 'packs', 500), library = rows(app.libraryItems, 'items'), bags = rows(app.containers, 'bags', 200);
    const id = packId ?? word(app.activeTripId, 'active pack ID'), trip = trips.find(t => t.id === id);
    if (!trip)
        throw Error('The selected pack is absent from this backup.');
    const references: BenchmarkSource['references'] = [], captures: BenchmarkSource['captures'] = [], instances: BenchmarkSource['instances'] = [];
    const usedItems = new Set<string>(), containerIds: string[] = [];
    const unavailable = Array.isArray(trip.unavailableInstanceIds) ? trip.unavailableInstanceIds : [];
    function reference(record: Record<string, unknown>, target: 'item' | 'container_interior') {
        const recordId = word(record.id, 'record ID'), id = (target === 'item' ? 'item:' : 'bag:') + recordId;
        const range = target === 'item' && record.massRangeGrams !== undefined ? object(record.massRangeGrams, 'mass range') : undefined;
        if (range && (weight(range.min) === null || weight(range.max) === null || Number(range.min) > Number(range.max)))
            throw Error('Invalid recorded mass range.');
        const upper = target === 'item' ? (range ? weight(range.max) : weight(record.massGrams)) : weight(record.tareGrams);
        references.push({ id, label: word(record.name, 'record label'), target, currentDimensionsMm: dimensions(target === 'item' ? record.dimensions : record.inside), currentOpeningMm: target === 'item' ? null : { length: positive(object(record.opening, 'bag opening').length), width: positive(object(record.opening, 'bag opening').width) }, upperMassGrams: upper, massSource: massSource(target === 'item' ? record.massEvidence : record.tareEvidence) });
        if (record.scan !== undefined) {
            const scan = object(record.scan, 'capture');
            if (scan.target !== target)
                throw Error('Capture target differs from its selected record.');
            const captureRecord=Object.fromEntries(['id','target','createdAt','platform','method','completedPasses','modelStoredLocally','sourceRetention','dimensionsEstimateMm','geometry','quality'].filter(key=>scan[key]!==undefined).map(key=>[key,scan[key]]));
            captures.push({ id: word(scan.id, 'capture ID'), referenceId: id, platform: scan.platform as 'android' | 'ios', method: scan.method as 'arcore_depth' | 'guided_object_capture', createdAt: word(scan.createdAt, 'capture time'), rawDimensionsMm: scan.dimensionsEstimateMm === undefined ? null : dimensions(scan.dimensionsEstimateMm),record:captureRecord as unknown as NonNullable<BenchmarkSource['captures'][number]['record']> });
        }
        return id;
    }
    for (const entry of rows(trip.entries, 'pack entries', 500)) {
        const itemId = word(entry.itemId, 'entry item ID'), entryId = word(entry.id, 'entry ID');
        const matches = library.filter(r => r.id === itemId);
        if (matches.length !== 1)
            throw Error('A selected item is missing or duplicated.');
        if (!usedItems.has(itemId)) {
            reference(matches[0], 'item');
            usedItems.add(itemId);
        }
        const quantity = entry.quantity;
        if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100 || instances.length + quantity > 500)
            throw Error('The benchmark supports at most 500 explicitly recorded item instances, with 1–100 per entry.');
        if (typeof entry.required !== 'boolean')
            throw Error('A required-item flag is missing.');
        for (let i = 1; i <= quantity; i++) {
            const instanceId = entryId + '#' + i;
            instances.push({ id: instanceId, referenceId: 'item:' + itemId, required: entry.required, unavailable: unavailable.includes(instanceId), packingFormId: entry.packingFormId === undefined ? null : word(entry.packingFormId, 'packing form ID') });
        }
    }
    if (!Array.isArray(trip.containerIds) || trip.containerIds.length > 30)
        throw Error('Record at most 30 selected bags.');
    for (const bagId of trip.containerIds) {
        const matches = bags.filter(r => r.id === bagId);
        if (matches.length !== 1)
            throw Error('A selected bag is missing or duplicated.');
        containerIds.push(reference(matches[0], 'container_interior'));
    }
    return parseBenchmarkSource({ format: 'packing-scanning-benchmark-source', version: 1, backupSha256, exportedAt: backup.exportedAt ?? null, packId: id, sample: trip.sample, mode: trip.mode, references, captures, instances, containerIds });
}
async function prepare(backupFile: string, out: string, packId?: string) {
    const bytes = await input(resolve(backupFile)), source = sourceFromBackup(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), digest(bytes), packId), sourceText = json(source);
    const data = newBenchmarkDataset(source, randomUUID(), digest(sourceText));
    parseBenchmarkDataset(data, source);
    await mkdir(resolve(out));
    await writeFile(join(out, 'source-records.json'), sourceText, { flag: 'wx' });
    await writeFile(join(out, 'trial.json'), json(data), { flag: 'wx' });
    await writeFile(join(out, 'READ-ME.txt'), [
        'Packing Scanning physical benchmark bundle — NOT EXECUTED',
        'No measured references, physical scans or successful packing trials have been invented.',
        'The source snapshot excludes photos, account credentials and trip context. Labels/IDs and dimensions can still be private.',
        'Keep source-records.json unchanged. Its hash is in trial.json. Original native point clouds/models are not included.',
        'Edit trial.json only after measuring references or executing observations. Use millimetres, grams and UTC timestamps.',
        'Keep failed/cancelled attempts. Leave untested outcomes as not_tested, never pass.',
        'Use the recorded original capture ID for a completed scan; do not substitute manually edited/calibrated dimensions.',
        'Add a local plan PDF/text artifact and its SHA-256 before recording an attempted packing trial. Files must be inside this folder with plain filenames.',
        'Read docs/PHYSICAL-BENCHMARKS.md for commands, row examples, definitions and acceptance limits.',
    ].join('\n') + '\n', { flag: 'wx' });
    console.log('Prepared an unexecuted local benchmark bundle: ' + resolve(out));
}
async function readBundle(datasetFile: string) {
    const datasetPath = resolve(datasetFile), root = await realpath(dirname(datasetPath)), bytes = await input(datasetPath), value = object(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')), 'benchmark');
    // Validate every path before reading it. Never accept directory traversal, symlinks or URLs from a document.
    const declared = rows(value.artifacts, 'artifacts', 100), verified: Array<{
        id: string;
        file: string;
        sha256: string;
        role: string;
    }> = [], files: Array<{
        file: string;
        content: Uint8Array;
    }> = [];
    let source: BenchmarkSource | undefined, totalBytes = 0;
    for (const a of declared) {
        const file = word(a.file, 'artifact filename');
        if (!/^[A-Za-z0-9][A-Za-z0-9_. -]{0,119}$/.test(file) || file.includes('..') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(file))
            throw Error('Artifact filenames must name regular files directly inside the bundle.');
        const artifactPath = join(root, file);
        if (dirname(await realpath(artifactPath)) !== root)
            throw Error('Artifact escapes its benchmark bundle.');
        const content = await input(artifactPath), sha256 = digest(content);
        totalBytes += content.length;
        if (totalBytes > 128 * 1024 * 1024)
            throw Error('Combined benchmark artifacts exceed 128 MiB.');
        if (sha256 !== a.sha256)
            throw Error('Artifact hash mismatch: ' + file + '.');
        if (a.role === 'source_records') {
            if (source)
                throw Error('Only one source snapshot is allowed.');
            source = parseBenchmarkSource(JSON.parse(content.toString('utf8')));
        }
        verified.push({ id: word(a.id, 'artifact ID'), file, sha256, role: word(a.role, 'artifact role') });
        files.push({ file, content });
    }
    if (!source)
        throw Error('The source snapshot is missing.');
    return { data: parseBenchmarkDataset(value, source), source, bytes, verified, files };
}
async function attach(datasetFile: string, planFile: string, out: string, artifactId = 'plan-1') {
    const bundle = await readBundle(datasetFile), content = await input(resolve(planFile));
    const pdf = content.subarray(0, 5).toString() === '%PDF-';
    if (!pdf) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
        if (text.includes('\0'))
            throw Error('Use a PDF or UTF-8 text packing sequence.');
    }
    const file = 'plan-' + randomUUID() + (pdf ? '.pdf' : '.txt');
    bundle.data.artifacts.push({ id: artifactId, file, sha256: digest(content), role: 'plan_sequence' });
    parseBenchmarkDataset(bundle.data, bundle.source);
    await mkdir(resolve(out));
    for (const f of bundle.files)
        await writeFile(join(out, f.file), f.content, { flag: 'wx' });
    await writeFile(join(out, file), content, { flag: 'wx' });
    await writeFile(join(out, 'trial.json'), json(bundle.data), { flag: 'wx' });
    console.log('Copied a hash-verified local bundle with plan artifact ' + artifactId + ': ' + resolve(out) + '\nOriginal files are unchanged. Set planArtifactId to this ID only for trials that follow this sequence.');
}
async function report(datasetFile: string, out: string) {
    const { data, source, bytes, verified } = await readBundle(datasetFile), result = { ...benchmarkReport(data, source), datasetSha256: digest(bytes), sourceBackupSha256: source.backupSha256, artifactsVerified: verified };
    await mkdir(resolve(out));
    await writeFile(join(out, 'report.json'), json(result), { flag: 'wx' });
    await writeFile(join(out, 'report.md'), benchmarkMarkdown(result), { flag: 'wx' });
    console.log('Local report written: ' + resolve(out) + '\nEvidence: ' + data.evidenceClass + '. Physical acceptance remains unverified.');
}
async function aggregate(out: string, datasetFiles: string[]) {
    if (datasetFiles.length < 1 || datasetFiles.length > 50) throw Error('Aggregate 1–50 benchmark packets.');
    const runs: BenchmarkRunInput[] = [], verified: Array<{ runId: string; artifacts: Awaited<ReturnType<typeof readBundle>>['verified'] }> = [];
    let totalBytes = 0;
    for (const file of datasetFiles) {
        const bundle = await readBundle(file);
        totalBytes += bundle.bytes.length + bundle.files.reduce((n, f) => n + f.content.length, 0);
        if (totalBytes > 512 * 1024 * 1024) throw Error('Combined aggregate inputs exceed 512 MiB.');
        runs.push({ dataset: bundle.data, source: bundle.source, datasetSha256: digest(bundle.bytes) });
        verified.push({ runId: bundle.data.runId, artifacts: bundle.verified });
    }
    const result = { ...aggregateBenchmarks(runs), declaredArtifactsVerified: true, artifactsVerified: verified };
    await mkdir(resolve(out));
    await writeFile(join(out, 'aggregate.json'), json(result), { flag: 'wx' });
    await writeFile(join(out, 'aggregate.md'), aggregateMarkdown(result), { flag: 'wx' });
    console.log('Verified local benchmark dataset written: ' + resolve(out) + '\nPhysical, synthetic and unexecuted evidence remain separate. Physical acceptance is unverified.');
}
const usage = 'Usage:\n  node scripts/physical-benchmark.ts prepare <backup.json> <new-folder> [pack-id]\n  node scripts/physical-benchmark.ts attach <trial.json> <plan.pdf-or-text> <new-folder> [artifact-id]\n  node scripts/physical-benchmark.ts report <trial.json> <new-report-folder>\n  node scripts/physical-benchmark.ts aggregate <new-report-folder> <trial.json> [more-trial.json ...]\nExisting output folders are refused. No network, uploads, native-source deletion or app-data changes.';
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const [, , command, ...args] = process.argv;
    if (command === '--help' || command === undefined)
        console.log(usage);
    else if (command === 'prepare' && (args.length === 2 || args.length === 3))
        prepare(args[0], args[1], args[2]).catch(error => { console.error(error instanceof Error ? error.message : 'Benchmark preparation failed.'); process.exitCode = 1; });
    else if (command === 'report' && args.length === 2)
        report(args[0], args[1]).catch(error => { console.error(error instanceof Error ? error.message : 'Benchmark report failed.'); process.exitCode = 1; });
    else if (command === 'attach' && (args.length === 3 || args.length === 4))
        attach(args[0], args[1], args[2], args[3]).catch(error => { console.error(error instanceof Error ? error.message : 'Plan attachment failed.'); process.exitCode = 1; });
    else if (command === 'aggregate' && args.length >= 2)
        aggregate(args[0], args.slice(1)).catch(error => { console.error(error instanceof Error ? error.message : 'Benchmark aggregation failed.'); process.exitCode = 1; });
    else {
        console.error(usage);
        process.exitCode = 1;
    }
}
