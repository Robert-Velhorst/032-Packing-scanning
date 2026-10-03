import { afterEach, describe, expect, it, vi } from 'vitest';
import { carrierCatalogStale, carrierRuleDraft, carrierRuleOverridden, carrierRuleHasUpdatedLimits, fetchCarrierCatalog, isCarrierCatalog } from './carrier-catalog';
import { isCarrierRuleStale, isValidCarrierRuleRecord } from './carrier-rules';
import { parseEasyjet } from '../server/easyjet.ts';
import { fixture } from '../server/test-fixtures.ts';

afterEach(() => vi.unstubAllGlobals());
const catalog = () => parseEasyjet(fixture(), new Date(Date.now()-1000).toISOString());
describe('retrieved carrier records', () => {
  it('flags newer changed limits immediately but ignores markup hashes and older copies', () => {
    const source=catalog(), rule=carrierRuleDraft(source,'small');
    const latest=structuredClone(source);latest.retrievedAt=new Date().toISOString();latest.sourceHash='b'.repeat(64);
    expect(carrierRuleHasUpdatedLimits(rule,latest)).toBe(false);
    latest.allowances[0].limits.maxWeightGrams=14000;
    expect(carrierRuleHasUpdatedLimits(rule,latest)).toBe(true);
    latest.retrievedAt=new Date(Date.parse(source.retrievedAt)-1000).toISOString();
    expect(carrierRuleHasUpdatedLimits(rule,latest)).toBe(false);
    expect(rule.retrieval?.catalog.allowances[0].limits.maxWeightGrams).toBe(15000);
  });
  it('requires manual booking confirmation and bag selection and retains the original source baseline', () => {
    const source = catalog(); const rule = carrierRuleDraft(source,'large-benefit');
    expect(rule.status).toBe('manual'); expect(rule.applicableBagIds).toEqual([]);
    expect(rule.retrieval?.catalog.retrievedAt).toBe(source.retrievedAt);
    expect(isValidCarrierRuleRecord(rule)).toBe(true);
    expect(carrierRuleOverridden(rule)).toBe(false);
    rule.limits!.maxWeightGrams = 14000;
    expect(carrierRuleOverridden(rule)).toBe(true);
    expect(source.allowances[2].limits.maxWeightGrams).toBe(15000);
    expect(rule.retrieval?.catalog.allowances[2].limits.maxWeightGrams).toBe(15000);
  });
  it('a new manual review cannot make an old retrieved source fresh', () => {
    const source = catalog(); source.retrievedAt = new Date(Date.now()-8*86400000).toISOString();
    const rule = carrierRuleDraft(source,'small'); rule.retrievedAt = new Date().toISOString();
    expect(carrierCatalogStale(source)).toBe(true); expect(isCarrierRuleStale(rule)).toBe(true);
  });
  it('rejects bad sources, duplicate products, missing limits and future retrieval timestamps', () => {
    const source = catalog();
    expect(isCarrierCatalog({...source,sourceUrl:'https://example.test'})).toBe(false);
    expect(isCarrierCatalog({...source,allowances:[source.allowances[0],source.allowances[0],source.allowances[2]]})).toBe(false);
    expect(isCarrierCatalog({...source,retrievedAt:'2099-01-01T00:00:00Z'})).toBe(false);
    expect(isValidCarrierRuleRecord({...carrierRuleDraft(source,'small'),retrieval:{catalog:source,allowanceId:'other'}})).toBe(false);
  });
});
describe('browser carrier protocol', () => {
  it('bounds streaming data and hides malformed JSON contents', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('x'.repeat(20001), {headers:{'Content-Type':'application/json'}}))
      .mockResolvedValueOnce(new Response('private unexpected contents', {headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher); const signal=new AbortController().signal;
    await expect(fetchCarrierCatalog('/api',signal)).rejects.toThrow('unsupported response');
    await expect(fetchCarrierCatalog('/api',signal)).rejects.toThrow('invalid copy');
  });
  it('sends no trip data or credentials and validates a response', async () => {
    const source = catalog(), fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data:source,meta:{delivery:'retrieved'} }),{headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher);
    expect((await fetchCarrierCatalog('/api/v1/carrier-rules/easyjet',new AbortController().signal)).data).toEqual(source);
    expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    expect(fetcher.mock.calls[0][1].body).toBeUndefined();
  });
  it('fails closed for a static HTML host, an unavailable endpoint and invalid data', async () => {
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('<html/>',{headers:{'Content-Type':'text/html'}}))
      .mockResolvedValueOnce(new Response('{}',{status:503}))
      .mockResolvedValueOnce(new Response(JSON.stringify({data:catalog(),meta:{delivery:'new'}}),{headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',fetcher); const signal = new AbortController().signal;
    await expect(fetchCarrierCatalog('/api',signal)).rejects.toThrow('not configured');
    await expect(fetchCarrierCatalog('/api',signal)).rejects.toThrow('unavailable');
    await expect(fetchCarrierCatalog('/api',signal)).rejects.toThrow('invalid');
  });
});
