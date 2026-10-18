import type { LibraryItem } from './types';

/** Filter without rebuilding lowercase search text on every keystroke. */
export function filterLibraryItems(
  items: LibraryItem[],
  search: string,
  cache: WeakMap<LibraryItem, string>,
): LibraryItem[] {
  if (!search) return items;
  const query = search.toLowerCase();
  return items.filter((item) => {
    let text = cache.get(item);
    if (text === undefined) {
      text = `${item.name} ${item.category}`.toLowerCase();
      cache.set(item, text);
    }
    return text.includes(query);
  });
}
