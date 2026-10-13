import { useState } from 'react';
import { SCAN_RETENTION_DAYS, type ScanRetentionDays } from '../scan-retention';

export function ScanRetentionSettings({ days, supported, status, saving, onApply }: { days: ScanRetentionDays | null; supported: boolean; status: string; saving: boolean; onApply: (days: ScanRetentionDays | null) => void }) {
  const [draft, setDraft] = useState<ScanRetentionDays | null>(days), [acknowledged, setAcknowledged] = useState(false);
  return <section className="raw-scan-retention" aria-label="Raw scan retention"><h3>Original raw scans</h3>
    <p>Keep saved measurements and adopted packing geometry while removing old original scan point clouds. Reference photos have a separate setting.</p>
    <label className="field compact-field"><span>Automatically remove original scans after</span><select aria-label="Raw scan retention period" value={draft ?? ''} disabled={!supported && days === null} onChange={e => { setDraft(e.target.value ? Number(e.target.value) as ScanRetentionDays : null); setAcknowledged(false); }}><option value="">Keep until I remove them</option>{SCAN_RETENTION_DAYS.map(value => <option key={value} value={value}>{value} days after capture</option>)}</select></label>
    <p className="settings-note">Age uses this device's clock and the completed capture date. Checks run when this workspace is unlocked and the app is visible, including offline and after reopening. They pause while an editor, scan or pending file/photo draft is open. An already started batch can finish. The app does not run a locked-workspace or closed-app deletion service.</p>
    {draft !== null && draft !== days && <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/><span>I understand this also applies to existing captures older than {draft} days. Their original source files cannot be restored from packing backups; future source review or reconstruction will need a new scan.</span></label>}
    <button className="button button-secondary" type="button" disabled={saving || draft === days || draft !== null && (!supported || !acknowledged)} onClick={() => onApply(draft)}>{saving ? 'Saving policy…' : draft === null ? 'Stop future automatic scan deletion' : 'Apply raw scan deletion policy'}</button>
    <p className="settings-note" role="status" aria-live="polite">{status}</p>
  </section>;
}
