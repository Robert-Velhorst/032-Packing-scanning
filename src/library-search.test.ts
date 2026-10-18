import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import { filterLibraryItems } from './library-search';

describe('library search', () => {
  it('returns the original list and does not build a cache for an empty query', () => {
    const items = createInitialData().libraryItems;
    const cache = new WeakMap();

    expect(filterLibraryItems(items, '', cache)).toBe(items);
    expect(cache.has(items[0])).toBe(false);
  });

  it('matches names and categories without changing order', () => {
    const items = createInitialData().libraryItems;
    const cache = new WeakMap();

    expect(filterLibraryItems(items, 'LAPTOP', cache)).toEqual(items.filter((item) => item.name === 'Laptop'));
    expect(filterLibraryItems(items, 'electronics', cache)).toEqual(items.filter((item) => item.category === 'electronics'));
    expect(cache.has(items[0])).toBe(true);
  });

  it('indexes replacement records by their new identity after an edit', () => {
    const original = createInitialData().libraryItems[0];
    const cache = new WeakMap();
    filterLibraryItems([original], original.name.toLowerCase(), cache);

    const updated = { ...original, name: 'Renamed travel item' };
    expect(filterLibraryItems([updated], 'renamed', cache)).toEqual([updated]);
  });
});
