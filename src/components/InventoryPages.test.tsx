import { renderToString as renderToStaticMarkup } from 'preact-render-to-string';
import { describe, expect, it, vi } from 'vitest';
import { createInitialData } from '../seed';
import { LibraryPage } from './InventoryPages';

vi.mock('lucide-react', () => ({
  AlertTriangle: () => null, Backpack: () => null, Package: () => null, Plus: () => null,
  Ruler: () => null, Search: () => null, ShieldCheck: () => null, Trash2: () => null, X: () => null,
}));

describe('large inventory rendering', () => {
  it('renders the first 100 matches and provides a control for a large inventory', () => {
    const base = createInitialData().libraryItems[0];
    const items = Array.from({ length: 1000 }, (_, index) => ({
      ...structuredClone(base), id: `library-item-${index}`, name: `Library item ${index}`, photoId: undefined,
    }));
    const markup = renderToStaticMarkup(<LibraryPage items={items} itemCount={1000} trips={[]} search="" setSearch={() => {}}
      getPhoto={async () => undefined} unit="metric" onAdd={() => {}} onEdit={() => {}} onDelete={() => {}}
      onAddEntry={() => {}} formatters={{ mmToDisplay: String, gramToDisplay: String, dimLabel: () => 'mm', sourceLabel: value => value,
        evidenceLabel: value => value.source, uprightInstruction: () => '', uprightTag: () => '' }}/>);

    expect(markup.match(/class="library-item-card"/g)).toHaveLength(100);
    expect(markup).toContain('Showing 100 of 1000 matches');
    expect(markup).toContain('Show next 100 items');
  });
});
