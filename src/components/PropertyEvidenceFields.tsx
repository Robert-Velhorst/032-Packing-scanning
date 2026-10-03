import type { Evidence } from '../types';
import { isPropertyEvidence, propertyEvidenceText } from '../property-evidence';

/** Evidence is created only by an explicit source/confidence review, never by saving defaults. */
export function PropertyEvidenceFields({ label, evidence, onChange, measurable = false }: {
  label: string; evidence?: Evidence; onChange: (evidence: Evidence | undefined) => void; measurable?: boolean;
}) {
  const valid = isPropertyEvidence(evidence);
  const review = (source: Evidence['source'], confidence: number) => onChange({ source, confidence,
    collectedAt: new Date().toISOString(), note: 'Traveller-recorded review. Confidence is a judgement, not a measured error bound or guarantee.' });
  return <div className="property-evidence-fields">
    <label className="field"><span>{label} source</span><select aria-label={`${label} source`} value={valid ? evidence.source : ''}
      onChange={event => event.target.value ? review(event.target.value as Evidence['source'], valid ? evidence.confidence : .5) : onChange(undefined)}>
      <option value="">Not reviewed</option>{measurable && <option value="measured">Measured by you</option>}
      <option value="known">Known product record</option><option value="estimated">Estimate</option><option value="user_confirmed">Confirmed by you</option>
      {valid && (evidence.source === 'provider' || evidence.source === 'measured' && !measurable) && <option value={evidence.source}>{evidence.source === 'provider' ? 'Saved provider record' : 'Saved measurement'}</option>}
    </select></label>
    {valid && <label className="field"><span>{label} confidence · 0–100</span><input aria-label={`${label} confidence`} type="number" min="0" max="100" step="1"
      value={Math.round(evidence.confidence * 100)} onChange={event => {
        const value = Number(event.target.value);
        if (event.target.value.trim() && Number.isFinite(value) && value >= 0 && value <= 100) review(evidence.source, value / 100);
      }}/></label>}
    <small>{propertyEvidenceText(evidence)}. Confidence is a recorded judgement, not a probability of safe packing.</small>
  </div>;
}
