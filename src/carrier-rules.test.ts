import { describe, expect, it } from 'vitest';
import { assessCarrierRule, carrierReviewTimestamp, formatComparisonNumber, isCarrierRuleStale, isValidCarrierRuleRecord, secureCarrierSourceUrl } from './carrier-rules';
import type { CarrierRule, Container, ContainerSummary } from './types';

const now = Date.UTC(2026, 8, 23, 12);

function bag(id='bag-1', overrides:Partial<Container>={}):Container {
  const measuredEvidence = {source:'measured' as const,confidence:1,collectedAt:new Date(now).toISOString()};
  return {id,name:id,kind:'cabin_case',inside:{length:500,width:350,height:200},opening:{length:450,width:300},insideEvidence:measuredEvidence,outerDimensionsEvidence:measuredEvidence,tareGrams:1200,tareEvidence:measuredEvidence,travellerIds:['traveller-1'],createdAt:new Date(now).toISOString(),...overrides};
}

function rule(limits:NonNullable<CarrierRule['limits']>, applicableBagIds=['bag-1']):CarrierRule {
  return {id:'rule-1',carrier:'Example Air',route:'A-B',fare:'Flex',sourceUrl:'https://example.test/rules',retrievedAt:new Date(now).toISOString(),staleAfterDays:7,applicableBagIds,notes:'Checked source',status:'verified',limits};
}

function summary(containerId='bag-1', overrides:Partial<ContainerSummary>={}):ContainerSummary {
  return {containerId,itemCount:2,usedMassGrams:2300,massLimitGrams:undefined,volumeUsedMm3:0,volumeCapacityMm3:0,unweighedCount:0,estimatedMassCount:0,...overrides};
}

describe('carrier rule freshness', () => {
  it('uses the actual time for a review made before noon and preserves it on edit', () => {
    const morning = new Date(2026,8,30,9,0,0).getTime();
    const saved = carrierReviewTimestamp('2026-09-30',undefined,morning);
    expect(saved).toBe(new Date(morning).toISOString());
    expect(isCarrierRuleStale({retrievedAt:saved,staleAfterDays:7},morning)).toBe(false);
    expect(carrierReviewTimestamp('2026-09-30',saved,morning+3600000)).toBe(saved);
  });

  it('rejects future or impossible review dates', () => {
    const morning = new Date(2026,8,30,9,0,0).getTime();
    expect(()=>carrierReviewTimestamp('2026-10-01',undefined,morning)).toThrow();
    expect(()=>carrierReviewTimestamp('2026-02-30',undefined,morning)).toThrow();
  });
  it('keeps a source current inside its refresh window', () => {
    expect(isCarrierRuleStale({ retrievedAt: new Date(now - 6 * 24 * 60 * 60 * 1000).toISOString(), staleAfterDays: 7 }, now)).toBe(false);
  });

  it('marks records stale at the refresh boundary', () => {
    expect(isCarrierRuleStale({ retrievedAt: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(), staleAfterDays: 7 }, now)).toBe(true);
  });

  it('fails closed for invalid, future-dated, or unsafe refresh windows', () => {
    expect(isCarrierRuleStale({ retrievedAt: 'not a date', staleAfterDays: 7 }, now)).toBe(true);
    expect(isCarrierRuleStale({ retrievedAt: new Date(now + 1000).toISOString(), staleAfterDays: 7 }, now)).toBe(true);
    expect(isCarrierRuleStale({ retrievedAt: new Date(now).toISOString(), staleAfterDays: 0 }, now)).toBe(true);
  });

  it('accepts only credential-free HTTPS source links', () => {
    expect(secureCarrierSourceUrl('https://www.example-airline.test/baggage')).toBe('https://www.example-airline.test/baggage');
    expect(secureCarrierSourceUrl('javascript:alert(1)')).toBeUndefined();
    expect(secureCarrierSourceUrl('https://user:secret@example-airline.test/baggage')).toBeUndefined();
  });

  it('rejects imported source records attached to bags outside the trip', () => {
    const record = { id: 'r1', carrier: 'Example Air', route: 'A-B', fare: 'Basic', sourceUrl: 'https://example.test/rules', retrievedAt: new Date(now).toISOString(), staleAfterDays: 7, applicableBagIds: ['bag-other'], notes: 'Manual record', status: 'manual' };
    expect(isValidCarrierRuleRecord(record, ['bag-trip'])).toBe(false);
    expect(isValidCarrierRuleRecord({ ...record, applicableBagIds: ['bag-trip'] }, ['bag-trip'])).toBe(true);
  });

  it('validates numeric carrier limits and rejects malformed thresholds', () => {
    const record = rule({ maxOuterDimensionsMm: { length: 550, width: 350, height: 250 }, maxWeightGrams: 12000, weightScope: 'combined' });
    expect(isValidCarrierRuleRecord(record, ['bag-1'])).toBe(true);
    expect(isValidCarrierRuleRecord({ ...record, limits: { maxOuterDimensionsMm: { length: 0, width: 350, height: 250 } } }, ['bag-1'])).toBe(false);
    expect(isValidCarrierRuleRecord({ ...record, limits: { maxWeightGrams: 12000, weightScope: 'airline_guess' } }, ['bag-1'])).toBe(false);
    expect(isValidCarrierRuleRecord({ ...record, limits: {} }, ['bag-1'])).toBe(false);
  });

  it('compares rotated outside dimensions per side and flags a missing measurement', () => {
    const measured = bag('bag-1', { outerDimensionsMm: { length: 350, width: 550, height: 250 } });
    const result = assessCarrierRule(rule({ maxOuterDimensionsMm: { length: 550, width: 350, height: 250 } }), [measured], []);
    expect(result.bags[0].checks[0].status).toBe('within');
    expect(result.bags[0].checks[0].detail).toContain('handles and wheels');

    measured.outerDimensionsMm = { length: 560, width: 350, height: 250 };
    const over = assessCarrierRule(rule({ maxOuterDimensionsMm: { length: 550, width: 350, height: 250 } }), [measured], []);
    expect(over.bags[0].checks[0].status).toBe('over');

    const unmeasured = assessCarrierRule(rule({ maxOuterLinearSumMm: 1580 }), [bag()], []);
    expect(unmeasured.bags[0].checks[0].status).toBe('unknown');
  });

  it('checks the sum of external dimensions at the exact limit', () => {
    const measured = bag('bag-1', { outerDimensionsMm: { length: 700, width: 500, height: 380 } });
    const result = assessCarrierRule(rule({ maxOuterLinearSumMm: 1580 }), [measured], []);
    expect(result.bags[0].checks[0].status).toBe('within');
    expect(result.bags[0].checks[0].margin).toBe(0);
  });

  it('keeps near-threshold differences visible and describes exact weight equality', () => {
    const measured = bag('bag-1', {outerDimensionsMm:{length:550.038,width:350,height:250}});
    const size = assessCarrierRule(rule({maxOuterDimensionsMm:{length:550.037,width:350,height:250}}),[measured],[]).bags[0].checks[0];
    expect(size.status).toBe('over');
    expect(size.detail).toContain('55.0038');
    expect(size.detail).toContain('55.0037');
    const weight = assessCarrierRule(rule({maxWeightGrams:3500,weightScope:'per_bag'}),[bag()],[summary()]).bags[0].checks[0];
    expect(weight.detail).toContain('3500 g is at the 3500 g');
    expect(formatComparisonNumber(0.000001)).not.toBe('0');
  });

  it('distinguishes recorded, estimated, and incomplete weight comparisons', () => {
    const source = rule({ maxWeightGrams: 4000, weightScope: 'per_bag' });
    const checked = assessCarrierRule(source, [bag()], [summary()]);
    expect(checked.bags[0].checks[0].status).toBe('within');
    expect(checked.bags[0].checks[0].measured).toBe(3500);

    const estimated = assessCarrierRule(source, [bag()], [summary('bag-1', { estimatedMassCount: 1 })]);
    expect(estimated.bags[0].checks[0].status).toBe('estimate_within');
    const overweightEstimate = assessCarrierRule(rule({ maxWeightGrams: 3000, weightScope: 'per_bag' }), [bag()], [summary('bag-1', { estimatedMassCount: 1 })]);
    expect(overweightEstimate.bags[0].checks[0].status).toBe('estimate_over');

    const missingTare = assessCarrierRule(source, [bag('bag-1', { tareGrams: undefined })], [summary()]);
    expect(missingTare.bags[0].checks[0].status).toBe('unknown');
    const missingItem = assessCarrierRule(source, [bag()], [summary('bag-1', { unweighedCount: 1 })]);
    expect(missingItem.bags[0].checks[0].status).toBe('unknown');
  });

  it('adds selected bags for a combined weight limit and fails closed on an incomplete bag', () => {
    const bags = [bag('bag-1'), bag('bag-2', { tareGrams: 700 })];
    const source = rule({ maxWeightGrams: 8000, weightScope: 'combined' }, ['bag-1', 'bag-2']);
    const combined = assessCarrierRule(source, bags, [summary('bag-1'), summary('bag-2', { usedMassGrams: 2500 })]);
    expect(combined.combinedWeight?.measured).toBe(6700);
    expect(combined.combinedWeight?.status).toBe('within');

    const incomplete = assessCarrierRule(source, bags, [summary('bag-1'), summary('bag-2', { unweighedCount: 1 })]);
    expect(incomplete.combinedWeight?.status).toBe('unknown');
  });

  it('keeps estimated exterior measurements and legacy tare values visibly uncertain', () => {
    const source = rule({ maxOuterDimensionsMm: {length:550,width:350,height:250}, maxWeightGrams:4000, weightScope:'per_bag' });
    const unverified = bag('bag-1', {outerDimensionsMm:{length:550,width:350,height:250},outerDimensionsEvidence:undefined,tareEvidence:undefined});
    expect(assessCarrierRule(source,[unverified],[summary()]).bags[0].checks.map((check)=>check.status)).toEqual(['estimate_within','estimate_within']);
  });

  it('never reports a pass for malformed geometry, weight inputs, or source thresholds', () => {
    const source=rule({maxOuterLinearSumMm:1580,maxWeightGrams:4000,weightScope:'per_bag'});
    const invalid=bag('bag-1',{outerDimensionsMm:{length:NaN,width:350,height:250},tareGrams:NaN});
    expect(assessCarrierRule(source,[invalid],[summary()]).bags[0].checks.every((check)=>check.status==='unknown')).toBe(true);
    expect(assessCarrierRule(source,[bag()],[summary('bag-1',{usedMassGrams:NaN})]).bags[0].checks[1].status).toBe('unknown');
    expect(assessCarrierRule(rule({maxWeightGrams:NaN,weightScope:'combined'}),[bag()],[summary()]).error).toBeTruthy();
  });
});
