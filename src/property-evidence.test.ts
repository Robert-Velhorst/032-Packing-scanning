import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import { buildPlan } from './optimizer';
import { accountMetadataBackup, isPackingBackup } from './backup';
import { sharedPackingRecords, openSharedPack } from './shared-packs';
import { isItemEditorDraft, type ItemEditorDraft } from './item-photo-draft';
import { changedPropertyEvidence, handlingPropertyRows, isPropertyEvidence, needsPropertyReview, propertyEvidenceText } from './property-evidence';
import type { Evidence } from './types';

const reviewed: Evidence = { source: 'known', confidence: .87, collectedAt: '2026-10-01T01:02:03.123Z', note: 'Synthetic handling record, not physical validation.' };
const data = () => structuredClone(createInitialData());

describe('handling and opening property evidence', () => {
  it('preserves missing legacy evidence instead of confirming defaults', () => {
    const app = data(), before = structuredClone(app), item = app.libraryItems[1];
    expect(handlingPropertyRows(item).every(row => row.evidence === undefined)).toBe(true);
    expect(propertyEvidenceText(undefined)).toBe('Not reviewed · confidence unknown');
    expect(changedPropertyEvidence(undefined)).toBeUndefined();
    const plan = buildPlan(app.trips[0], app.libraryItems, app.containers);
    expect(plan.warnings.some(warning => warning.includes('missing fragile or upright flag'))).toBe(true);
    expect(plan.warnings.some(warning => warning.includes('openings are unreviewed'))).toBe(true);
    expect(app).toEqual(before);
  });

  it('does not weaken legacy fragile or upright constraints when evidence is missing', () => {
    const app = data(), item = app.libraryItems[0], trip = app.trips[0], bag = app.containers[0];
    item.dimensions = { length: 10, width: 10, height: 15 }; item.fragile = true; item.keepUpright = true;
    trip.entries = [{ ...trip.entries[0], quantity: 2 }];
    bag.inside = { length: 10, width: 10, height: 50 }; bag.opening = { length: 10, width: 10 };
    for (const mode of ['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'] as const) {
      const plan = buildPlan(trip, app.libraryItems, app.containers, mode);
      expect(plan.placements).toHaveLength(1);
      expect(plan.placements[0].height).toBe(15);
      expect(plan.excluded).toHaveLength(1);
    }
  });

  it('downgrades edited values without inventing a higher confidence or retaining old confirmation', () => {
    const at = '2026-10-01T03:04:05Z', next = changedPropertyEvidence(reviewed, at);
    expect(next).toMatchObject({ source: 'estimated', confidence: .5, collectedAt: at });
    expect(next?.note).toMatch(/Value changed/);
    expect(changedPropertyEvidence({ ...reviewed, confidence: .2 }, at)?.confidence).toBe(.2);
    expect(reviewed.confidence).toBe(.87);
  });

  it('keeps source, confidence, dates and affirmative/negative handling values together in backups', () => {
    const app = data(), item = app.libraryItems[0], bag = app.containers[0];
    item.flexibilityEvidence = reviewed; item.fragileEvidence = { ...reviewed, source: 'user_confirmed', confidence: .93 };
    item.keepUpright = false; item.keepUprightEvidence = { ...reviewed, source: 'estimated', confidence: .3 };
    bag.openingEvidence = { ...reviewed, source: 'measured', confidence: .9 };
    const backup = JSON.parse(JSON.stringify(accountMetadataBackup(app)));
    expect(isPackingBackup(backup)).toBe(true);
    expect(backup.app.libraryItems[0]).toMatchObject({ flexibilityEvidence: reviewed, fragileEvidence: item.fragileEvidence, keepUpright: false, keepUprightEvidence: item.keepUprightEvidence });
    expect(backup.app.containers[0].openingEvidence).toEqual(bag.openingEvidence);
  });

  it('preserves evidence in separate shared copies without changing the private originals or locks', () => {
    const app = data(), trip = app.trips[0];
    for (const item of app.libraryItems) { item.flexibilityEvidence = reviewed; item.fragileEvidence = reviewed; item.keepUprightEvidence = reviewed; }
    app.containers[0].openingEvidence = reviewed;
    const placed = buildPlan(trip, app.libraryItems, app.containers).placements[0];
    trip.lockedPlacements = [{ ...placed, locked: true }]; trip.completedInstanceIds = [placed.instanceId];
    const before = structuredClone(app), records = sharedPackingRecords(app, trip.id);
    const copy = openSharedPack(app, { id: 'evidence-pack', householdId: 'family', revision: 1, name: trip.name, updatedAt: trip.updatedAt, updatedBy: 'tester', records }, 'evidence-copy');
    expect(app).toEqual(before);
    expect(copy.libraryItems.find(item => item.id.startsWith('shared-evidence-copy:'))?.fragileEvidence).toEqual(reviewed);
    expect(copy.containers.find(bag => bag.id.startsWith('shared-evidence-copy:'))?.openingEvidence).toEqual(reviewed);
    const copyTrip = copy.trips.find(t => t.id === copy.activeTripId)!;
    const copiedPlan = buildPlan(copyTrip, copy.libraryItems, copy.containers);
    expect(copiedPlan.placements.find(p => p.instanceId.endsWith(placed.instanceId))).toMatchObject({ x: placed.x, y: placed.y, z: placed.z, locked: true });
    expect(copiedPlan.warnings.some(w => w.includes('handling properties'))).toBe(false);
  });

  it('rejects malformed evidence and impossible calendar dates, with no trusted label', () => {
    for (const bad of [null, { ...reviewed, confidence: NaN }, { ...reviewed, confidence: -1 }, { ...reviewed, confidence: 1.1 }, { ...reviewed, source: 'scan_verified' }, { ...reviewed, collectedAt: '2026-02-31T01:02:03Z' }, { ...reviewed, collectedAt: '2026-10-01' }, { ...reviewed, secret: 'hidden' }]) {
      expect(isPropertyEvidence(bad)).toBe(false);
      expect(propertyEvidenceText(bad as Evidence)).toMatch(/Invalid|Not reviewed/);
      const app = data(); app.libraryItems[0].fragileEvidence = bad as Evidence;
      expect(isPackingBackup({ format: 'packing-scanning-backup', app, photos: [] })).toBe(false);
      expect(() => sharedPackingRecords(app, app.activeTripId)).toThrow(/invalid/);
    }
  });

  it('refuses new placement from invalid handling evidence while preserving the source record', () => {
    const app = data(), before = structuredClone(app);
    app.libraryItems[0].keepUprightEvidence = { ...reviewed, confidence: 99 };
    const plan = buildPlan(app.trips[0], app.libraryItems, app.containers);
    expect(plan.placements.some(p => p.itemId === app.libraryItems[0].id)).toBe(false);
    expect(plan.excluded.some(p => p.reason.includes('handling evidence'))).toBe(true);
    expect(app.libraryItems[0].dimensions).toEqual(before.libraryItems[0].dimensions);
  });

  it('pauses a bag with malformed opening evidence rather than discarding saved positions', () => {
    const app = data(), trip = app.trips[0], placed = buildPlan(app.trips[0], app.libraryItems, app.containers).placements[0];
    trip.lockedPlacements = [{ ...placed, locked: true }]; trip.completedInstanceIds = [placed.instanceId];
    app.containers[0].openingEvidence = { ...reviewed, collectedAt: 'bad' };
    const before = structuredClone(app), plan = buildPlan(trip, app.libraryItems, app.containers);
    expect(plan.warnings.some(w => w.includes('Opening evidence is invalid'))).toBe(true);
    expect(plan.placements.some(p => !p.locked)).toBe(false);
    expect(app).toEqual(before);
    expect(isPackingBackup({ format: 'packing-scanning-backup', app, photos: [] })).toBe(false);
  });

  it('retains incomplete and negative-value reviews in resumable photo drafts and rejects corruption', () => {
    const draft: ItemEditorDraft = { version: 1, unit: 'metric', name: '', category: 'other', length: '', width: '', height: '', mass: '', dimensionSource: 'estimated', massSource: 'known', flexibility: 'rigid', fragile: false, keepUpright: false, topLoad: '', topLoadSource: 'known', formsNeedRecovery: false, packingForms: [], scannedEstimate: false, scanDimensionsEdited: false, scaleReference: '', removePhoto: false, fragileEvidence: reviewed };
    expect(isItemEditorDraft(JSON.parse(JSON.stringify(draft)))).toBe(true);
    expect(isItemEditorDraft({ ...draft, fragileEvidence: { ...reviewed, confidence: Infinity } })).toBe(false);
  });

  it('warns on explicit estimates and low confidence without calling them physical verification', () => {
    expect(needsPropertyReview(reviewed)).toBe(false);
    expect(needsPropertyReview({ ...reviewed, source: 'estimated', confidence: 1 })).toBe(true);
    expect(needsPropertyReview({ ...reviewed, confidence: .79 })).toBe(true);
    expect(propertyEvidenceText(reviewed)).toContain('87% recorded confidence');
    expect(propertyEvidenceText(reviewed)).not.toContain('verified');
  });
});
