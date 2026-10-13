import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { carrierCatalogStale, carrierRuleDraft, EASYJET_SOURCE, fetchCarrierCatalog, type AllowanceId, type CarrierCatalog } from '../carrier-catalog';
import type { CarrierRule } from '../types';

function lookupEndpoint(): string | undefined {
  if (!Capacitor.isNativePlatform()) return '/api/v1/carrier-rules/easyjet';
  const configured = import.meta.env.VITE_CARRIER_API_ORIGIN;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== configured) return undefined;
    return `${url.origin}/api/v1/carrier-rules/easyjet`;
  } catch { return undefined; }
}

export function CarrierLookup({ catalog, onCatalog, onReview }: { catalog?: CarrierCatalog; onCatalog: (catalog: CarrierCatalog) => void; onReview: (draft: CarrierRule) => void }) {
  const [allowanceId, setAllowanceId] = useState<AllowanceId>('small');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => { const pending = request.current; request.current = undefined; pending?.abort(); }, []);
  const endpoint = lookupEndpoint();
  const allowance = catalog?.allowances.find((entry) => entry.id === allowanceId);
  const retrieve = async () => {
    if (request.current || !endpoint) return;
    if (!navigator.onLine) { setMessage('You are offline. Your previous retrieved copy and manual records remain available.'); setFailed(true); return; }
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage('Retrieving the official public cabin-bag page…'); setFailed(false);
    const deadline = setTimeout(() => controller.abort(new Error('Lookup timed out.')), 20000);
    try {
      const result = await fetchCarrierCatalog(endpoint, controller.signal);
      if (controller.signal.aborted) return;
      // Never replace trip records, booking confirmations or manual overrides on refresh.
      onCatalog(result.data);
      setFailed(result.meta.delivery === 'fallback');
      setMessage(result.meta.warning ?? (result.meta.delivery === 'retrieved' ? 'Official page retrieved. Review the allowance before saving it to this pack.' : 'Using the server’s previously retrieved copy. Its original retrieval time is shown below.'));
    } catch (error) {
      if (request.current === controller) {
        setFailed(true);
        setMessage(controller.signal.aborted ? 'Lookup timed out. Your previous copy and manual records are unchanged.' : error instanceof Error ? error.message : 'Carrier lookup failed. Your saved records are unchanged.');
      }
    } finally {
      clearTimeout(deadline);
      if (request.current === controller) { request.current = undefined; setBusy(false); }
    }
  };
  return <section className="carrier-lookup" aria-labelledby="carrier-lookup-title">
    <div className="carrier-lookup-heading"><div><p className="eyebrow">OFFICIAL SOURCE LOOKUP</p><h2 id="carrier-lookup-title">easyJet cabin bags</h2></div><button className="button button-secondary" disabled={busy || !endpoint} onClick={() => void retrieve()}>{busy ? 'Retrieving…' : catalog ? 'Refresh official rules' : 'Retrieve easyJet rules'}</button></div>
    <p>Retrieve size, weight and fare conditions from the public page. Your route, booking, travellers and bag contents stay on this device. This lookup does not access your booking.</p>
    {!endpoint && <p className="carrier-lookup-warning">Live lookup is unavailable in this version. Use a saved copy or a manual source record, and check your booking through the official source below.</p>}
    {message && <p className={failed ? 'carrier-lookup-warning' : 'carrier-lookup-message'} role={failed ? 'alert' : 'status'}>{message}</p>}
    {catalog && <>
      <div className="carrier-copy-meta"><span>Retrieved {new Date(catalog.retrievedAt).toLocaleString()}</span><strong>{carrierCatalogStale(catalog) ? 'Stale copy · recheck official source' : 'Saved retrieved copy · recheck after 7 days'}</strong></div>
      <label className="field"><span>Which allowance describes your booking?</span><select value={allowanceId} onChange={(event) => setAllowanceId(event.target.value as AllowanceId)}>{catalog.allowances.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label>
      {allowance && <div className="retrieved-allowance"><h3>{allowance.title}</h3><p><strong>Applies when:</strong> {allowance.applicability}</p><p className="retrieved-limits">{Object.values(allowance.limits.maxOuterDimensionsMm).map((side) => side / 10).join(' × ')} cm outside · {allowance.limits.maxWeightGrams / 1000} kg per bag · {allowance.limits.maxBagCount === undefined ? 'Piece count not recorded in this copy' : `${allowance.limits.maxBagCount} bag per passenger for this allowance`}</p><p>{allowance.caveats}</p><button className="button button-primary" onClick={() => onReview(carrierRuleDraft(catalog, allowanceId))}>Review and save allowance</button><small>Select the bags for one passenger and this allowance, record your route and confirm the exact fare yourself. The count checks that selected set; separate records are not pooled. You can edit limits as a manual override.</small></div>}
    </>}
    <a className="text-button" href={EASYJET_SOURCE} target="_blank" rel="noreferrer">Open official easyJet source ↗</a>
  </section>;
}
