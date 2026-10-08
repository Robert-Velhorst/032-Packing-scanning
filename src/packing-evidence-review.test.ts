import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import { buildPlan } from './optimizer';
import { buildPackingEvidenceReview, reviewProperty } from './packing-evidence-review';
import type { Evidence, PackingShape } from './types';

const e: Evidence = { source: 'known', confidence: .9, collectedAt: '2026-10-01T00:00:00Z', note: 'Synthetic record.' };
function fixture() {
  const app = structuredClone(createInitialData()), trip = app.trips[0], item = app.libraryItems[0], bag = app.containers[0];
  app.libraryItems = [item]; trip.entries = [trip.entries[0]]; trip.sample = false;
  item.dimensionEvidence = e; item.massEvidence = e; item.flexibilityEvidence = e; item.fragileEvidence = e; item.keepUprightEvidence = e;
  bag.insideEvidence = e; bag.openingEvidence = e; bag.tareGrams = 100; bag.tareEvidence = e; bag.massLimitEvidence = e;
  const plan = () => buildPlan(trip, app.libraryItems, app.containers);
  const review = () => buildPackingEvidenceReview(trip, app.libraryItems, app.containers, plan(), app.unitSystem);
  return { app, trip, item, bag, plan, review };
}

describe('pack-specific evidence review', () => {
  it('accepts explicit zero empty weight while retaining missing-source and invalid-number reviews', () => {
    const f = fixture(); f.bag.tareGrams = 0;
    const row = () => f.review().groups.find(g => g.recordId === f.bag.id)!.properties.find(p => p.id === 'tare')!;
    expect(row()).toMatchObject({ status: 'recorded', value: '0 g', needsReview: false });
    delete f.bag.tareEvidence; expect(row().status).toBe('missing');
    f.bag.tareEvidence = e;
    for (const value of [-1, NaN, Infinity]) { f.bag.tareGrams = value; expect(row().status).toBe('invalid'); }
    delete f.bag.tareGrams; expect(row().status).toBe('invalid');
  });
  it('flags conflicting selected identities without arbitrarily choosing an editor record', () => {
    const f = fixture(), plan = f.plan(); f.app.libraryItems.push({ ...f.item, name: 'Conflicting kit' }); f.app.containers.push({ ...f.bag, name: 'Conflicting case' });
    const before = structuredClone(f.app), r = buildPackingEvidenceReview(f.trip, f.app.libraryItems, f.app.containers, plan, 'metric');
    expect(r.groups.every(g => g.kind === 'missing' && g.name.startsWith('Conflicting'))).toBe(true);
    expect(r.needsReviewCount).toBe(2); expect(f.app).toEqual(before);
  });
  it('flags missing handling and opening reviews without changing values, sources or packed locks', () => {
    const f = fixture(), placed = f.plan().placements[0];
    f.trip.lockedPlacements = [{ ...placed, locked: true }]; f.trip.completedInstanceIds = [placed.instanceId];
    delete f.item.flexibilityEvidence; delete f.item.fragileEvidence; delete f.item.keepUprightEvidence; delete f.bag.openingEvidence;
    const before = structuredClone(f.app), r = f.review();
    expect(r.needsReviewCount).toBe(5); // Fragility also supplies the enforced no-stack restriction.
    expect(r.reviewGroupCount).toBe(2);
    expect(r.groups[0].properties.find(p => p.label === 'Fragility')).toMatchObject({ status: 'missing', needsReview: true });
    expect(f.app).toEqual(before);
  });

  it('excludes unused library records and bags, and deduplicates copies of the same selected form', () => {
    const f = fixture(); f.app.libraryItems.push({ ...f.item, id: 'private-unused', name: 'Unused private kit' });
    f.app.containers.push({ ...f.bag, id: 'private-bag', name: 'Unused private bag' });
    f.trip.entries.push({ ...f.trip.entries[0], id: 'copy-entry', quantity: 5 });
    const r = f.review(); expect(r.groups).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain('Unused private'); expect(r.needsReviewCount).toBe(0);
  });

  it('uses the selected preparation source and size rather than the original confirmed envelope', () => {
    const f = fixture(); f.item.flexibility = 'foldable'; f.item.packingForms = [{ id: 'fold', name: 'Small fold', kind: 'folded', dimensions: { length: 100, width: 80, height: 30 }, dimensionEvidence: { ...e, confidence: .6 }, reviewedAt: e.collectedAt, preparation: 'Fold without pressure.' }];
    f.trip.entries.push({ ...f.trip.entries[0], id: 'fold-entry', packingFormId: 'fold' });
    const r = f.review(), folded = r.groups.find(g => g.name.endsWith('Small fold'))!;
    expect(r.groups.filter(g => g.kind === 'item')).toHaveLength(2);
    expect(folded.properties.find(p => p.id === 'size')).toMatchObject({ value: '100 × 80 × 30 mm', status: 'low_confidence', evidence: { confidence: .6 } });
    expect(r.groups[0].properties.find(p => p.id === 'size')?.status).toBe('recorded');
  });

  it('keeps missing selected forms and missing records visible instead of removing required entries', () => {
    const f = fixture(); f.trip.entries[0].packingFormId = 'gone';
    const before = structuredClone(f.app), r = f.review();
    expect(r.groups[0].properties[0]).toMatchObject({ status: 'invalid', value: 'Selected form cannot be used' });
    expect(f.app).toEqual(before);
    f.trip.entries[0].itemId = 'missing-required'; f.trip.containerIds.push('missing-bag');
    const missing = f.review().groups.filter(g => g.kind === 'missing');
    expect(missing).toHaveLength(2); expect(missing.every(g => g.properties[0].needsReview)).toBe(true);
    expect(f.trip.entries[0].required).toBe(true); expect(f.trip.containerIds).toContain('missing-bag');
  });

  it('distinguishes optional weights from missing inputs needed for limits or cross-bag comparison', () => {
    const f = fixture(); delete f.item.massGrams; delete f.item.massEvidence; delete f.bag.tareGrams; delete f.bag.tareEvidence;
    expect(f.review().groups[0].properties.find(p => p.id === 'mass')?.status).toBe('missing');
    delete f.bag.massLimitGrams; delete f.bag.massLimitEvidence;
    expect(f.review().groups[0].properties.find(p => p.id === 'mass')?.status).toBe('optional');
    expect(f.review().groups[1].properties.find(p => p.id === 'tare')?.status).toBe('optional');
    f.app.containers.push({ ...f.bag, id: 'second' }); f.trip.containerIds.push('second');
    expect(f.review().groups[0].properties.find(p => p.id === 'mass')?.status).toBe('missing');
    expect(f.review().groups[1].properties.find(p => p.id === 'tare')?.status).toBe('missing');
  });

  it('requires outside measurements only when an applicable saved size rule needs them', () => {
    const f = fixture(); expect(f.review().groups[1].properties.find(p => p.id === 'outside')?.status).toBe('optional');
    f.trip.carrierRules = [{ id: 'rule', carrier: 'Synthetic rule', route: '', fare: '', sourceUrl: 'https://example.com/', retrievedAt: e.collectedAt, staleAfterDays: 7, applicableBagIds: [f.bag.id], notes: '', status: 'manual', limits: { maxOuterDimensionsMm: { length: 600, width: 400, height: 250 } } }];
    expect(f.review().groups[1].properties.find(p => p.id === 'outside')?.status).toBe('missing');
    f.trip.carrierRules[0].applicableBagIds = [];
    expect(f.review().groups[1].properties.find(p => p.id === 'outside')?.status).toBe('optional');
  });

  it('keeps range uncertainty and upper-weight use visible, including a valid zero lower bound', () => {
    const f = fixture(); f.item.massRangeGrams = { min: 0, max: 1700 }; f.item.massEvidence = { ...e, source: 'estimated', confidence: 1 };
    const row = f.review().groups[0].properties.find(p => p.id === 'mass')!;
    expect(row.value).toBe('0 g–1,700 g · upper value used'); expect(row.status).toBe('estimated'); expect(row.needsReview).toBe(true);
    f.item.massRangeGrams = { min: 1800, max: 1700 };
    expect(f.review().groups[0].properties.find(p => p.id === 'mass')?.status).toBe('invalid');
  });

  it('aggregates actual proposed loads across duplicate entries rather than inspecting only the first', () => {
    const f = fixture(); f.item.fragile = false; delete f.item.maxTopLoadGrams; delete f.item.topLoadEvidence;
    f.trip.entries.push({ ...f.trip.entries[0], id: 'later-entry' });
    const plan = f.plan(), p = plan.placements.find(p => p.entryId === 'later-entry')!;
    plan.stackLoads = [{ instanceId: p.instanceId, containerId: f.bag.id, aboveInstanceIds: ['another-item#1'], upperLoadGrams: 10, unknownMassCount: 0, status: 'unverified' }];
    const r = buildPackingEvidenceReview(f.trip, f.app.libraryItems, f.app.containers, plan, 'metric');
    expect(r.groups[0].properties.find(p => p.id === 'top-load')?.status).toBe('missing');
  });

  it('exposes intrusion, lid and compartment sources without mistaking positions for missing dimensions', () => {
    const f = fixture(); f.bag.lidClearanceMm = 5; f.bag.lidClearanceEvidence = { ...e, source: 'estimated' };
    f.bag.unavailableSpaces = [{ id: 'intrusion', name: 'Handle frame', x: 0, y: 0, z: 0, length: 20, width: 30, height: 40, evidence: e }];
    f.bag.compartments = [{ id: 'pocket', name: 'Pocket', x: 30, y: 0, z: 0, length: 150, width: 100, height: 100, opening: { length: 140, width: 90 }, evidence: { ...e, confidence: .6 }, supportEvidence: { ...e, source: 'user_confirmed' } }];
    const rows = f.review().groups[1].properties;
    expect(rows.find(p => p.id === 'space:intrusion')?.value).toBe('20 × 30 × 40 mm');
    expect(rows.find(p => p.id === 'compartment:pocket')).toMatchObject({ status: 'low_confidence', value: '150 × 100 × 100 mm · opening 140 × 90 mm' });
    expect(rows.find(p => p.id === 'support:pocket')?.status).toBe('recorded'); expect(rows.find(p => p.id === 'lid')?.status).toBe('estimated');
  });

  it('never promotes reconstructed shape completeness because a size has high confirmed confidence', () => {
    const f = fixture(), dimensions = { length: 60, width: 50, height: 40 };
    const shape: PackingShape = { sourceEnvelopeMm: dimensions, fittedDimensionsMm: dimensions, adoptedAt: e.collectedAt, solid: { id: '00000000-0000-4000-8000-000000000001', target: 'item', format: 'voxel_solid_v1', units: 'millimetres', sourceHash: 'a'.repeat(64), sourcePointCount: 400, method: 'observed_voxel_shell_fill_v1', resolutionMm: 10, grid: { x: 6, y: 5, z: 4 }, dimensionsMm: dimensions, occupiedCells: Array.from({ length: 120 }, (_, i) => i), observedCellCount: 96, enclosedCellCount: 24, surfaceFaceCount: 148, warnings: ['Synthetic fixture.'] } };
    f.item.dimensions = dimensions; f.item.packingShape = shape;
    const row = f.review().groups[0].properties.find(p => p.id === 'shape')!;
    expect(row.status).toBe('estimated'); expect(row.evidence).toBeUndefined(); expect(row.detail).toContain('physically verified');
    expect(f.item.dimensionEvidence).toEqual(e);
  });

  it('flags malformed source, confidence, future review dates and value-without-record contradictions', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    for (const bad of [{ ...e, confidence: NaN }, { ...e, confidence: 3 }, { ...e, collectedAt: '2026-02-31T00:00:00Z' }, { ...e, collectedAt: '2027-10-01T00:00:00Z' }]) {
      expect(reviewProperty('x', 'Size', '10 mm', bad, { now }).status).toBe('invalid');
    }
    const f = fixture(); f.bag.outerDimensionsEvidence = e;
    expect(f.review().groups[1].properties.find(p => p.id === 'outside')?.status).toBe('invalid');
    f.bag.compartments = [null as never];
    expect(f.review().groups[1].properties.find(p => p.id === 'space-validation')?.status).toBe('invalid');
  });

  it('formats the same immutable records in both unit systems and retains exact evidence', () => {
    const f = fixture(), before = structuredClone(f.app);
    const imperial = buildPackingEvidenceReview(f.trip, f.app.libraryItems, f.app.containers, f.plan(), 'imperial');
    expect(imperial.groups[0].properties[0].value).toBe('12.598 × 8.661 × 0.984 in');
    expect(imperial.groups[0].properties[0].evidence).toBe(f.item.dimensionEvidence);
    expect(f.app).toEqual(before); expect(f.review().needsReviewCount).toBe(0);
  });
});
