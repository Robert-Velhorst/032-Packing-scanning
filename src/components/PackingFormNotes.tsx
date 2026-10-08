import { packingFormInstruction } from '../packing-forms';
import type { PackingForm } from '../types';

export function PackingFormNotes({form}:{form?:PackingForm}) {
  return form?<aside className="packing-form-notes" aria-label="Preparation for the selected packing form"><strong>Selected packing form · {form.name}</strong><p>{packingFormInstruction(form)}</p><small>{form.dimensionEvidence.source.replace('_',' ')} dimensions · reviewed {new Date(form.reviewedAt).toLocaleString()}. Weight and fragile/upright care remain unchanged. Check the recorded form-specific stacking limit.</small></aside>:null;
}
