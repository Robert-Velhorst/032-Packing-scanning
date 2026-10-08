import { describe, expect, it } from 'vitest';
import { measurementFromInput, measurementInput } from './measurement-input';

describe('stored measurement editing', () => {
  it('preserves untouched metric and imperial dimensions and weights exactly', () => {
    for (const [stored, conversion] of [[550.037, 1], [550.037, 25.4], [12000.035, 28.3495]]) {
      expect(measurementFromInput(measurementInput(stored, conversion), conversion, stored)).toBe(stored);
    }
  });

  it('converts a changed measurement using the selected unit', () => {
    expect(measurementFromInput('22', 25.4, 550)).toBeCloseTo(558.8);
    expect(measurementFromInput('550.5', 1, 550)).toBe(550.5);
  });
});
