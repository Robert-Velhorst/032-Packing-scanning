import { renderToString as renderToStaticMarkup } from 'preact-render-to-string';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialData } from '../seed';
import { buildPlan } from '../optimizer';
import type { OptimizationMode } from '../types';

const { renderRetrievalNotes, renderSeparationNotes } = vi.hoisted(() => ({
  renderRetrievalNotes: vi.fn(),
  renderSeparationNotes: vi.fn(),
}));

vi.mock('./RetrievalNotes', () => ({ RetrievalNotes: () => { renderRetrievalNotes(); return null; } }));
vi.mock('./SeparationNotes', () => ({ SeparationNotes: () => { renderSeparationNotes(); return null; } }));

import { PlanComparison } from './PlanComparison';

const modes: OptimizationMode[] = ['balanced', 'maximum_capacity', 'easy_access', 'fragile_protection'];
const modeCopy = {
  balanced: { title: 'Balanced', detail: 'Space, weight & careful placement' },
  maximum_capacity: { title: 'Maximum capacity', detail: 'Prioritize fitting more items' },
  easy_access: { title: 'Easy access', detail: 'Frequently needed items nearer the top' },
  fragile_protection: { title: 'Fragile protection', detail: 'No load on fragile items and full occupied base support' },
} satisfies Record<OptimizationMode, { title: string; detail: string }>;

describe('candidate comparison details', () => {
  afterEach(() => vi.clearAllMocks());

  it('does not mount retrieval or separation analysis while candidate details are closed', () => {
    const app = createInitialData();
    const trip = app.trips[0];
    const plans = modes.map(mode => buildPlan({ ...trip, mode }, app.libraryItems, app.containers, mode));
    const markup = renderToStaticMarkup(<PlanComparison trip={trip} items={app.libraryItems} bags={app.containers} plans={plans}
      unit="metric" modeCopy={modeCopy} onSelect={() => undefined}/>);

    expect(markup.match(/<details class="candidate-details"/g)).toHaveLength(4);
    expect(renderRetrievalNotes).not.toHaveBeenCalled();
    expect(renderSeparationNotes).not.toHaveBeenCalled();
  });
});
