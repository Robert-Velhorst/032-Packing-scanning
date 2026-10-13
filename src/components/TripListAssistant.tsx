import { useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { weatherSuggestions } from '../weather';
import { buildTripSuggestions, matchTripSuggestionItems, type TripSuggestion } from '../trip-assistant';
import { useWeatherClock } from '../weather-clock';
import type { LibraryItem, Trip } from '../types';

export function TripListAssistant({ trip, library, onAdd }: {
  trip: Trip;
  library: LibraryItem[];
  onAdd: (suggestion: TripSuggestion, item?: LibraryItem) => void;
}) {
  const now = useWeatherClock();
  const suggestions = useMemo(() => [...weatherSuggestions(trip, now), ...buildTripSuggestions(trip)], [trip, now]);
  const optionsBySuggestion = useMemo(() => new Map(suggestions.map((suggestion) => [suggestion.id, matchTripSuggestionItems(suggestion, library)])), [suggestions, library]);
  const [selectedItems, setSelectedItems] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const listedItemIds = useMemo(() => new Set(trip.entries.map((entry) => entry.itemId)), [trip.entries]);

  return <section className="trip-assistant" aria-labelledby="trip-assistant-title">
    <div className="trip-assistant-heading"><div><span className="panel-kicker">TRIP-AWARE STARTER</span><h2 id="trip-assistant-title">Build a first checklist</h2><p>Suggestions are optional. Add only what suits your trip.</p></div><span className="local-chip"><Lock size={12}/> On this device</span></div>
    <div className="trip-suggestions">{suggestions.map((suggestion) => {
      const options = optionsBySuggestion.get(suggestion.id) ?? [];
      const selectedId = selectedItems[suggestion.id] ?? '';
      const selectedItem = options.find((item) => item.id === selectedId);
      const alreadyListed = Boolean(selectedItem && listedItemIds.has(selectedItem.id));
      const quantity = quantities[suggestion.id] ?? suggestion.quantity;
      return <article className="trip-suggestion" key={suggestion.id}>
        <div className="trip-suggestion-copy"><strong>{suggestion.name}</strong><p>{suggestion.reason}</p></div>
        <div className="trip-suggestion-controls">
          {options.length > 0 && <label className="suggestion-item-select"><span>Use saved item</span><select aria-label={`Saved item for ${suggestion.name}`} value={selectedId} onChange={(event) => setSelectedItems((current) => ({ ...current, [suggestion.id]: event.target.value }))}><option value="">Choose a matching item…</option>{options.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>}
          {options.length === 0 && library.some((item) => item.category === suggestion.category) && <small className="suggestion-no-match">No saved item name matches this reminder yet.</small>}
          <label className="suggestion-quantity"><span>Qty</span><input aria-label={`Quantity for ${suggestion.name}`} type="number" min="1" max="99" value={quantity} onChange={(event) => setQuantities((current) => ({ ...current, [suggestion.id]: Math.max(1, Math.min(99, Number(event.target.value) || 1)) }))}/></label>
          <button className="button button-secondary" type="button" disabled={alreadyListed} onClick={() => onAdd({ ...suggestion, quantity }, selectedItem)}>{alreadyListed ? 'Already added' : selectedItem ? 'Add saved item' : 'Add details'}</button>
        </div>
      </article>;
    })}</div>
    <p className="trip-assistant-note">Choose “Add details” to measure or scan a new item before it enters the space plan. Weather reminders use only a saved, current forecast for covered trip dates. Carrier rules and medical needs are not inferred; add personal essentials yourself.</p>
  </section>;
}
