import { describe, expect, it, vi } from 'vitest';
import { parseEasyjet, retrieveEasyjet } from './easyjet.ts';

import { fixture } from './test-fixtures.ts';

const retrievedAt = '2026-09-23T12:00:00.000Z';

describe('official-source parser', () => {
  it('extracts dimensions and mass and keeps distinct booking and locker-space conditions', () => {
    const catalog = parseEasyjet(fixture(), retrievedAt);
    expect(catalog.allowances[0].limits.maxOuterDimensionsMm).toEqual({ length:450,width:360,height:200 });
    expect(catalog.allowances[1].limits.maxWeightGrams).toBe(15000);
    expect(catalog.allowances[2].applicability).toContain('subject to available locker space');
    expect(catalog.allowances[0].applicability).toContain('alone does not establish');
    expect(catalog.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('retrieves changed numeric values instead of hardcoding today’s allowances', () => {
    const catalog = parseEasyjet(fixture('44 x 35 x 19', '55 x 44 x 24', '14'), retrievedAt);
    expect(catalog.allowances[0].limits.maxOuterDimensionsMm.length).toBe(440);
    expect(catalog.allowances[1].limits.maxWeightGrams).toBe(14000);
  });
  it('rejects conflicting repeated limits', () => {
    expect(() => parseEasyjet(fixture().replace('Maximum size 45', 'Maximum size 46'), retrievedAt)).toThrow('conflicting');
  });
  it('rejects missing entitlement or available-space conditions', () => {
    expect(() => parseEasyjet(fixture().replace('Your large cabin bag will be subject to available space on board.', ''), retrievedAt)).toThrow('applicability');
    expect(() => parseEasyjet(fixture().replace('easyJet Plus membership and have booked a large cabin bag', 'any seat'), retrievedAt)).toThrow('applicability');
  });
  it('does not treat scripts as source evidence', () => {
    expect(() => parseEasyjet(`<script>${fixture()}</script>`, retrievedAt)).toThrow();
  });
  it('rejects missing, duplicated, implausible values and future provenance', () => {
    expect(() => parseEasyjet(fixture().replace('Maximum weight 15kg', 'Weight unknown'), retrievedAt)).toThrow();
    expect(() => parseEasyjet(fixture().replace('Maximum weight 15kg', 'Maximum weight 15kg Maximum weight 16kg'), retrievedAt)).toThrow();
    expect(() => parseEasyjet(fixture('999 x 36 x 20'), retrievedAt)).toThrow();
    expect(() => parseEasyjet(fixture(), '2099-01-01T00:00:00Z')).toThrow();
  });
  it('accepts entity-encoded punctuation and introductory dimension punctuation', () => {
    const html = fixture().replaceAll("you're", 'you&rsquo;re').replace('Maximum size 56 x 45 x 25 cm (including', 'max. 56 x 45 x 25 cm, including');
    expect(parseEasyjet(html, retrievedAt).allowances).toHaveLength(3);
  });
});

describe('bounded public source fetch', () => {
  it('uses only the canonical official URL, no credentials and no redirects', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(fixture(), { headers: { 'Content-Type':'text/html' } }));
    expect((await retrieveEasyjet(fetcher, () => Date.parse(retrievedAt))).retrievedAt).toBe(retrievedAt);
    expect(fetcher.mock.calls[0][0]).toBe('https://www.easyjet.com/en/help/baggage/cabin-bags');
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials:'omit',redirect:'error' });
  });
  it('fails closed on HTTP errors, wrong content types and oversized streaming responses', async () => {
    await expect(retrieveEasyjet(vi.fn().mockResolvedValue(new Response('blocked',{status:403})))).rejects.toThrow();
    await expect(retrieveEasyjet(vi.fn().mockResolvedValue(new Response(fixture(),{headers:{'Content-Type':'application/json'}})))).rejects.toThrow();
    await expect(retrieveEasyjet(vi.fn().mockResolvedValue(new Response('x'.repeat(1500001),{headers:{'Content-Type':'text/html'}})))).rejects.toThrow('too large');
  });
});
