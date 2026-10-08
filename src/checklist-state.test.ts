import { describe, expect, it } from 'vitest';
import { checklistInstanceState } from './checklist-state';

describe('checklist instance state', () => {
  it('classifies each copy once while preserving packed, unavailable and unplaced behavior', () => {
    const completed = new Set(['entry#1', 'entry#2']);
    const unavailable = new Set(['entry#2']);
    const placed = new Set(['entry#1', 'entry#3']);

    const state = checklistInstanceState('entry', 4, completed, unavailable, placed);

    expect(state).toEqual({
      itemDone: 2,
      notPlaced: true,
      unavailable: [{ id: 'entry#2', index: 1 }],
      packable: ['entry#1', 'entry#3'],
      undo: false,
    });

    completed.add('entry#3');
    expect(checklistInstanceState('entry', 4, completed, unavailable, placed).undo).toBe(true);
  });

  it('retains one-item fallback for legacy zero quantities and ignores unavailable copies in the unplaced warning', () => {
    const state = checklistInstanceState('legacy', 0, new Set(), new Set(['legacy#1']), new Set());

    expect(state).toMatchObject({ itemDone: 0, notPlaced: false, unavailable: [{ id: 'legacy#1', index: 0 }], packable: [], undo: false });
  });
});
