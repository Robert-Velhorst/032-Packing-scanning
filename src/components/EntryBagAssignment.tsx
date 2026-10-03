import type { Container, PackEntry } from '../types';

export function EntryBagAssignment({ entry, name, bags, onChange }: { entry: PackEntry; name: string; bags: Container[]; onChange: (bagId: string, compartmentId?: string) => void }) {
  const bag = bags.find(value => value.id === entry.containerId);
  return <div className="entry-bag-assignment"><label className="field"><span>Bag for {name}</span><select aria-label={`Bag for ${name}`} value={entry.containerId ?? ''} onChange={e => onChange(e.target.value)}><option value="">Any eligible bag</option>{entry.containerId && !bag && <option value={entry.containerId}>Missing bag · review selection</option>}{bags.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>
    {(bag?.compartments || entry.compartmentId) && <label className="field"><span>Compartment for {name}</span><select aria-label={`Compartment for ${name}`} value={entry.compartmentId ?? ''} onChange={e => onChange(entry.containerId ?? '', e.target.value || undefined)}><option value="">Any eligible compartment</option>{entry.compartmentId && !bag?.compartments?.some(c => c.id === entry.compartmentId) && <option value={entry.compartmentId}>Missing compartment · review selection</option>}{bag?.compartments?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <small>Applies to all {entry.quantity} {entry.quantity === 1 ? 'copy' : 'copies'}. Changing assignments keeps packed positions saved and can pause a bag.</small>
  </div>;
}
