import { benchmarkReport, fixtureClasses, hash, outcomeRate, parseBenchmarkDataset, parseBenchmarkSource } from './physical-benchmarks.ts';
import type { BenchmarkDataset, BenchmarkSource } from './physical-benchmarks.ts';

export interface BenchmarkRunInput { dataset: unknown; source: unknown; datasetSha256: string }
type Run = { data: BenchmarkDataset; source: BenchmarkSource; datasetSha256: string; report: ReturnType<typeof benchmarkReport> };
const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b), n = sorted.length; return n ? n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : null; };
const duration = (row: { startedAt: string | null; finishedAt: string | null }) => (Date.parse(row.finishedAt!) - Date.parse(row.startedAt!)) / 1000;

function summarize(runs: Run[]) {
  const scans = runs.flatMap(r => r.data.scanAttempts.filter(s => s.status !== 'not_attempted'));
  const trials = runs.flatMap(r => r.data.packingTrials.filter(t => t.status !== 'not_attempted'));
  const comparisons = runs.flatMap(r => r.report.scanComparisons);
  const differences = comparisons.flatMap(c => c.differenceMm?.map(Math.abs) ?? []);
  const trialResults = runs.flatMap(r => r.report.trialResults);
  const measuredMass = trialResults.filter(t => t.totalPackedMassGrams !== null);
  return {
    runCount: runs.length, runIds: runs.map(r => r.data.runId), sampleRunCount: runs.filter(r => r.source.sample).length,
    referenceRecordCount: runs.reduce((n, r) => n + r.data.references.length, 0),
    scanAttempts: {
      planned: runs.reduce((n, r) => n + r.data.scanAttempts.length, 0), attempted: scans.length,
      completed: scans.filter(s => s.status === 'completed').length, failed: scans.filter(s => s.status === 'failed').length,
      cancelled: scans.filter(s => s.status === 'cancelled').length,
      completionPercent: scans.length ? 100 * scans.filter(s => s.status === 'completed').length / scans.length : null,
      comparable: comparisons.filter(c => c.comparable).length, unscoredCompleted: comparisons.filter(c => !c.comparable).length,
      medianDurationSeconds: median(scans.map(duration)), medianCompletedDurationSeconds: median(scans.filter(s => s.status === 'completed').map(duration)),
      comparedEdgeCount: differences.length, medianAbsoluteDifferenceMm: median(differences),
      maximumAbsoluteDifferenceMm: differences.length ? differences.reduce((maximum, n) => Math.max(maximum, n), 0) : null,
    },
    packing: {
      planned: runs.reduce((n, r) => n + r.data.packingTrials.length, 0), attempted: trials.length,
      completed: trials.filter(t => t.status === 'completed').length, aborted: trials.filter(t => t.status === 'aborted').length,
      firstPlanFit: outcomeRate(trials.map(t => t.firstPlanFit)), finalFit: outcomeRate(trials.map(t => t.finalFit)),
      closureAllBags: outcomeRate(trials.map(t => t.closure.some(c => c.outcome === 'fail') ? 'fail' : !t.closure.length || t.closure.some(c => c.outcome === 'not_tested') ? 'not_tested' : 'pass')),
      replanning: outcomeRate(trials.map(t => t.replanCount === null ? 'not_tested' : t.replanCount > 0 ? 'pass' : 'fail')),
      independentTrials: trials.filter(t => t.independentTester === true).length, unknownIndependence: trials.filter(t => t.independentTester === null).length,
      blindedTrials: trials.filter(t => t.blindedToPlanGeneration === true).length, unknownBlinding: trials.filter(t => t.blindedToPlanGeneration === null).length,
      medianDurationSeconds: median(trials.map(duration)), access: outcomeRate(trials.map(t => t.access)),
      damage: { none: trials.filter(t => t.damage === 'none').length, observed: trials.filter(t => t.damage === 'observed').length, notChecked: trials.filter(t => t.damage === 'not_checked').length },
      excessCompression: { none: trials.filter(t => t.excessCompression === 'none').length, observed: trials.filter(t => t.excessCompression === 'observed').length, notChecked: trials.filter(t => t.excessCompression === 'not_checked').length },
      measuredPackedMassCount: measuredMass.length, unweighedTrials: trials.length - measuredMass.length,
      medianRecordedMinusObservedMassGrams: median(trialResults.flatMap(t => t.recordedMinusObservedMassGrams === null ? [] : [t.recordedMinusObservedMassGrams])),
    },
    coverage: fixtureClasses.map(fixture => {
      const refs = runs.flatMap(r => r.data.references.filter(ref => ref.fixture === fixture));
      const attempted = runs.flatMap(r => r.data.scanAttempts.filter(s => s.status !== 'not_attempted' && r.data.references.find(ref => ref.id === s.referenceId)!.fixture === fixture));
      return { fixture, referenceRecords: refs.length, measuredReferenceRecords: refs.filter(r => r.dimensionsMm !== null).length,
        attemptedScans: attempted.length, failedScans: attempted.filter(s => s.status === 'failed').length, cancelledScans: attempted.filter(s => s.status === 'cancelled').length,
        comparableCompletedScans: runs.reduce((n, r) => n + r.report.scanComparisons.filter(c => c.comparable && r.data.references.find(ref => ref.id === c.referenceId)!.fixture === fixture).length, 0) };
    }),
  };
}

/** Revalidate raw packets, never aggregate percentages or medians from precomputed reports. */
export function aggregateBenchmarks(inputs: BenchmarkRunInput[]) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 50) throw Error('Aggregate 1–50 benchmark packets.');
  const runs: Run[] = inputs.map(input => {
    const source = parseBenchmarkSource(input.source), data = parseBenchmarkDataset(input.dataset, source);
    return { source, data, datasetSha256: hash(input.datasetSha256, 'datasetSha256'), report: benchmarkReport(data, source) };
  });
  const identities = new Map<string, string>();
  function unique(key: string, runId: string, kind: string) {
    const prior = identities.get(key); if (prior !== undefined) throw Error(`Duplicate ${kind} evidence in runs ${prior} and ${runId}; supply each observation once.`);
    identities.set(key, runId);
  }
  for (const run of runs) {
    const { data, source } = run;
    unique(JSON.stringify(['run', data.runId]), data.runId, 'run ID');
    unique(JSON.stringify(['dataset', run.datasetSha256]), data.runId, 'dataset');
    for (const scan of data.scanAttempts.filter(s => s.status !== 'not_attempted')) {
      if (scan.status === 'completed') {
        const capture = source.captures.find(c => c.id === scan.captureId)!;
        unique(JSON.stringify(['capture', capture.platform, capture.method, capture.id, capture.createdAt]), data.runId, 'completed capture');
      } else {
        unique(JSON.stringify(['scan', data.device, data.conditions.operatorId, scan.referenceId, scan.startedAt, scan.finishedAt]), data.runId, 'scan attempt');
      }
    }
    for (const trial of data.packingTrials.filter(t => t.status !== 'not_attempted')) {
      const plan = data.artifacts.find(a => a.id === trial.planArtifactId)!;
      unique(JSON.stringify(['trial', plan.sha256, trial.testerId, trial.startedAt, trial.finishedAt]), data.runId, 'packing trial');
    }
  }
  function groups(conditionDetails: boolean) {
    const byIdentity = new Map<string, { evidenceClass: BenchmarkDataset['evidenceClass']; device: BenchmarkDataset['device']; conditions: { lighting: string | null; background: string | null; network: string | null } | null; runs: Run[] }>();
    for (const run of runs) {
      const { data } = run, conditions = conditionDetails ? { lighting: data.conditions.lighting, background: data.conditions.background, network: data.conditions.network } : null;
      const key = JSON.stringify([data.evidenceClass, data.device, conditions]);
      const group = byIdentity.get(key) ?? { evidenceClass: data.evidenceClass, device: data.device, conditions, runs: [] };
      group.runs.push(run); byIdentity.set(key, group);
    }
    return [...byIdentity.values()].map(g => ({ evidenceClass: g.evidenceClass, device: g.device, conditions: g.conditions, ...summarize(g.runs) }));
  }
  return {
    format: 'packing-scanning-benchmark-aggregate', version: 1, protocolVersion: '032-physical-v1',
    physicalAcceptanceVerified: false, rawSourceFilesVerified: false, declaredArtifactsVerified: false, runCount: runs.length,
    evidenceSummaries: (['physical_observation', 'synthetic', 'unexecuted'] as const).map(evidenceClass => ({ evidenceClass, ...summarize(runs.filter(r => r.data.evidenceClass === evidenceClass)) })),
    deviceGroups: groups(false), conditionGroups: groups(true),
    runs: runs.map(r => ({ runId: r.data.runId, datasetSha256: r.datasetSha256, sourceBackupSha256: r.source.backupSha256,
      sourceSnapshotSha256: r.data.artifacts.find(a => a.role === 'source_records')!.sha256, packId: r.source.packId, report: r.report })),
    limitations: [
      'Physical observations are operator-reported; no acceptance threshold or certification is inferred.',
      'Physical, synthetic and unexecuted evidence is never pooled into one performance rate.',
      'Reference identities and revisions are local to each run; record counts do not count unique physical objects.',
      'Differences compare sorted envelope edges only, not collision surfaces, usable interiors, openings or physical fit.',
      'Reference uncertainty is retained in each run, not assumed zero or combined into a confidence interval.',
      'Repeated observations matching recorded identities are rejected; identity checks cannot prove that differently labelled records are independent.',
      'Original native capture files and actual device support are not verified by this report.',
    ],
  };
}

export function aggregateMarkdown(report: ReturnType<typeof aggregateBenchmarks>) {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}[\]()#+.!|<>]/g, '\\$&');
  const value = (n: number | null) => n === null ? 'Not observed' : String(Math.round(n * 1000) / 1000);
  const unit = (n: number | null, suffix: string) => n === null ? 'Not observed' : value(n) + suffix;
  const rate = (r: ReturnType<typeof outcomeRate>) => `${r.passed}/${r.attempted} attempted; ${r.failed} negative, ${r.unknown} untested; observed ${unit(r.observedPercent, '%')}; all-attempt lower bound ${unit(r.allAttemptLowerBoundPercent, '%')}`;
  const lines = ['# Packing Scanning benchmark dataset', '', '**Physical acceptance is not established.** Synthetic examples do not represent physical results.', '', `${report.runCount} input packets. Declared artifact hashes verified: ${report.declaredArtifactsVerified ? 'yes' : 'no'}. Reference counts are records, not unique physical objects.`, '', '## Evidence classes', ''];
  for (const s of report.evidenceSummaries) lines.push(`### ${s.evidenceClass}`, '', `Runs: ${s.runCount}; example-source runs: ${s.sampleRunCount}; reference records: ${s.referenceRecordCount}.`,
    `Scans: ${s.scanAttempts.attempted} attempted; ${s.scanAttempts.completed} completed; ${s.scanAttempts.failed} failed; ${s.scanAttempts.cancelled} cancelled. Completion: ${unit(s.scanAttempts.completionPercent, '%')}.`,
    `Comparable scans: ${s.scanAttempts.comparable}; unscored completed scans: ${s.scanAttempts.unscoredCompleted}; compared edges: ${s.scanAttempts.comparedEdgeCount}. Median absolute reference difference: ${unit(s.scanAttempts.medianAbsoluteDifferenceMm, ' mm')}; maximum: ${unit(s.scanAttempts.maximumAbsoluteDifferenceMm, ' mm')}.`,
    `First-plan fit: ${rate(s.packing.firstPlanFit)}.`, `Final fit: ${rate(s.packing.finalFit)}.`, `Every bag closes: ${rate(s.packing.closureAllBags)}.`, `Needed replanning: ${rate(s.packing.replanning)}.`,
    `Packing duration median: ${unit(s.packing.medianDurationSeconds, ' seconds')}; aborted trials: ${s.packing.aborted}. Independent testers: ${s.packing.independentTrials}; unknown independence: ${s.packing.unknownIndependence}; blinded: ${s.packing.blindedTrials}; unknown blinding: ${s.packing.unknownBlinding}.`,
    `Access: ${rate(s.packing.access)}. Damage observed/not checked: ${s.packing.damage.observed}/${s.packing.damage.notChecked}; excessive compression observed/not checked: ${s.packing.excessCompression.observed}/${s.packing.excessCompression.notChecked}. Unweighed trials: ${s.packing.unweighedTrials}.`, '',
    '| Fixture | Reference records | Measured records | Scan attempts | Failed | Cancelled | Comparable scans |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...s.coverage.map(c => `| ${c.fixture} | ${c.referenceRecords} | ${c.measuredReferenceRecords} | ${c.attemptedScans} | ${c.failedScans} | ${c.cancelledScans} | ${c.comparableCompletedScans} |`), '');
  for (const [heading, groups] of [['Device groups', report.deviceGroups], ['Device and condition groups', report.conditionGroups]] as const) {
    lines.push(`## ${heading}`, '');
    for (const g of groups) lines.push(`### ${g.evidenceClass} · ${escape(g.device.model ?? 'Device not recorded')}`, '',
      ...Object.entries({ ...g.device, ...g.conditions }).map(([key, v]) => `- ${key}: ${v === null ? 'Not recorded' : escape(v)}`),
      `- Runs: ${g.runCount}; scans attempted/completed/failed/cancelled: ${g.scanAttempts.attempted}/${g.scanAttempts.completed}/${g.scanAttempts.failed}/${g.scanAttempts.cancelled}.`,
      `- Comparable scans: ${g.scanAttempts.comparable}; median absolute reference difference: ${unit(g.scanAttempts.medianAbsoluteDifferenceMm, ' mm')}.`,
      `- Final fit: ${rate(g.packing.finalFit)}.`, `- Every bag closes: ${rate(g.packing.closureAllBags)}.`, `- Needed replanning: ${rate(g.packing.replanning)}.`, `- Run IDs: ${g.runIds.map(escape).join(', ')}.`, '');
  }
  lines.push('## Input provenance', '', '| Run | Dataset SHA-256 | Source snapshot SHA-256 |', '| --- | --- | --- |', ...report.runs.map(r => `| ${escape(r.runId)} | ${r.datasetSha256} | ${r.sourceSnapshotSha256} |`), '', '## Limits', '', ...report.limitations.map(l => '- ' + l), '', 'The JSON report preserves each run’s measured references, uncertainties, comparison rows and trial observations. Inputs remain unchanged; nothing is uploaded.');
  return lines.join('\n') + '\n';
}
