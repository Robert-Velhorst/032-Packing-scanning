import type { CarrierLimits, CarrierRule } from './types.ts';

export const EASYJET_SOURCE = 'https://www.easyjet.com/en/help/baggage/cabin-bags';
export const CARRIER_ADAPTER_VERSION = 'easyjet-cabin-v1';
export const ALLOWANCE_IDS = ['small', 'large-booked', 'large-benefit'] as const;
export type AllowanceId = typeof ALLOWANCE_IDS[number];
export interface CarrierAllowance {
  id: AllowanceId;
  title: string;
  applicability: string;
  caveats: string;
  limits: Required<Pick<CarrierLimits, 'maxOuterDimensionsMm' | 'maxWeightGrams' | 'weightScope'>> & Pick<CarrierLimits, 'maxBagCount'>;
}
export interface CarrierCatalog {
  carrier: 'easyJet';
  sourceUrl: typeof EASYJET_SOURCE;
  retrievedAt: string;
  sourceHash: string;
  adapterVersion: typeof CARRIER_ADAPTER_VERSION;
  staleAfterDays: 7;
  allowances: CarrierAllowance[];
}
export interface CarrierRetrieval {
  catalog: CarrierCatalog;
  allowanceId: AllowanceId;
}
export interface CarrierCatalogResponse {
  data: CarrierCatalog;
  meta: { delivery: 'retrieved' | 'cached' | 'fallback'; warning?: string };
}

export function isCarrierCatalog(value: unknown, now = Date.now()): value is CarrierCatalog {
  if (!value || typeof value !== 'object') return false;
  const catalog = value as Partial<CarrierCatalog>;
  return catalog.carrier === 'easyJet' && catalog.sourceUrl === EASYJET_SOURCE
    && catalog.adapterVersion === CARRIER_ADAPTER_VERSION && catalog.staleAfterDays === 7
    && typeof catalog.retrievedAt === 'string' && Number.isFinite(Date.parse(catalog.retrievedAt))
    && Date.parse(catalog.retrievedAt) > 0 && Date.parse(catalog.retrievedAt) <= now
    && typeof catalog.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(catalog.sourceHash)
    && Array.isArray(catalog.allowances) && catalog.allowances.length === ALLOWANCE_IDS.length
    && ALLOWANCE_IDS.every((id) => catalog.allowances!.filter((allowance) => allowance?.id === id).length === 1)
    && catalog.allowances.every((allowance) => {
      if (!allowance || typeof allowance !== 'object') return false;
      const limits = allowance.limits;
      const dimensions = limits?.maxOuterDimensionsMm;
      return [allowance.title, allowance.applicability, allowance.caveats].every((text) => typeof text === 'string' && text.length > 0 && text.length <= 1000)
        && !!dimensions && [dimensions.length, dimensions.width, dimensions.height].every((side) => Number.isFinite(side) && side > 0 && side <= 2000)
        && Number.isFinite(limits.maxWeightGrams) && limits.maxWeightGrams > 0 && limits.maxWeightGrams <= 100000
        && limits.weightScope === 'per_bag'
        && (limits.maxBagCount === undefined || limits.maxBagCount === 1);
    });
}

export function isCarrierRetrieval(value: unknown): value is CarrierRetrieval {
  if (!value || typeof value !== 'object') return false;
  const retrieval = value as Partial<CarrierRetrieval>;
  return isCarrierCatalog(retrieval.catalog) && ALLOWANCE_IDS.includes(retrieval.allowanceId as AllowanceId);
}

export function carrierCatalogStale(catalog: CarrierCatalog, now = Date.now()): boolean {
  return !isCarrierCatalog(catalog, now) || now - Date.parse(catalog.retrievedAt) >= catalog.staleAfterDays * 86400000;
}

/** Retrieval remains evidence of a public page, never evidence of a traveller's booking. */
export function carrierRuleDraft(catalog: CarrierCatalog, allowanceId: AllowanceId): CarrierRule {
  if (!isCarrierCatalog(catalog)) throw new Error('This carrier copy is invalid. Retrieve the official source again.');
  const allowance = catalog.allowances.find((entry) => entry.id === allowanceId);
  if (!allowance) throw new Error('Choose a supported allowance.');
  return {
    id: 'retrieved-draft', carrier: catalog.carrier, route: '', fare: allowance.title,
    sourceUrl: catalog.sourceUrl, retrievedAt: catalog.retrievedAt, staleAfterDays: catalog.staleAfterDays,
    applicableBagIds: [], notes: `${allowance.applicability}\n${allowance.caveats}`,
    status: 'manual', limits: structuredClone(allowance.limits),
    retrieval: { catalog: structuredClone(catalog), allowanceId },
  };
}

export function carrierRuleOverridden(rule: CarrierRule): boolean {
  if (!rule.retrieval) return false;
  const original = rule.retrieval.catalog.allowances.find((allowance) => allowance.id === rule.retrieval!.allowanceId);
  if (!original) return true;
  const expected = original.limits, actual = rule.limits;
  return rule.sourceUrl !== rule.retrieval.catalog.sourceUrl || rule.carrier !== rule.retrieval.catalog.carrier
    || actual?.maxOuterDimensionsMm?.length !== expected.maxOuterDimensionsMm.length
    || actual?.maxOuterDimensionsMm?.width !== expected.maxOuterDimensionsMm.width
    || actual?.maxOuterDimensionsMm?.height !== expected.maxOuterDimensionsMm.height
    || actual?.maxWeightGrams !== expected.maxWeightGrams || actual?.weightScope !== expected.weightScope || actual?.maxBagCount !== expected.maxBagCount
    || actual?.maxOuterLinearSumMm !== undefined;
}

/** Dynamic HTML hashes may differ without a policy change; compare supported numeric rules. */
export function carrierRuleHasUpdatedLimits(rule: CarrierRule, latest?: CarrierCatalog): boolean {
  const baseline = rule.retrieval;
  if (!baseline || !latest || !isCarrierCatalog(latest) || Date.parse(latest.retrievedAt) <= Date.parse(baseline.catalog.retrievedAt)) return false;
  const previous = baseline.catalog.allowances.find((entry) => entry.id === baseline.allowanceId)?.limits;
  const current = latest.allowances.find((entry) => entry.id === baseline.allowanceId)?.limits;
  if (!previous || !current) return true;
  const values = (limits: CarrierAllowance['limits']) => [...Object.values(limits.maxOuterDimensionsMm).sort((a,b) => b-a), limits.maxWeightGrams, limits.weightScope, limits.maxBagCount ?? null];
  return JSON.stringify(values(previous)) !== JSON.stringify(values(current));
}

/** Used by both browser and optional configured native API; no trip data is sent. */
export async function fetchCarrierCatalog(endpoint: string, signal: AbortSignal): Promise<CarrierCatalogResponse> {
  const response = await fetch(endpoint, { signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error('The official-source lookup is unavailable. Your saved copy and manual records are unchanged.');
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Carrier lookup is not configured on this server. Manual records remain available.');
  // The protocol is deliberately small; never import arbitrary provider HTML into the UI.
  if (!response.body || Number(response.headers.get('content-length')) > 20000) {
    await response.body?.cancel(); throw new Error('The carrier lookup returned an unsupported response.');
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = '', bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 20000) throw new Error('The carrier lookup returned an unsupported response.');
      text += decoder.decode(value, { stream:true });
    }
    text += decoder.decode();
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  let payload: Partial<CarrierCatalogResponse>;
  try { payload = JSON.parse(text); } catch { throw new Error('The carrier lookup returned an invalid copy.'); }
  if (!payload || typeof payload !== 'object') throw new Error('The carrier lookup returned an invalid copy.');
  if (!isCarrierCatalog(payload.data) || !payload.meta || !['retrieved', 'cached', 'fallback'].includes(payload.meta.delivery)
    || (payload.meta.warning !== undefined && (typeof payload.meta.warning !== 'string' || payload.meta.warning.length > 500))) {
    throw new Error('The carrier lookup returned an invalid copy. Your previous copy is unchanged.');
  }
  return payload as CarrierCatalogResponse;
}
