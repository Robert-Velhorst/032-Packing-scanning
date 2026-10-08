import type { DimensionsMm } from '../types';
import { normalizeScanDimensions } from './contract';

export interface ScaleCalibrationResult {
  dimensionsMm: DimensionsMm;
  scaleFactor: number;
}

/** Calibrate an unscaled scan with a traveller-measured longest edge. */
export function calibrateLongestEdge(estimate: DimensionsMm, referenceLengthMm: number): ScaleCalibrationResult {
  const normalized = normalizeScanDimensions(estimate);
  if (!Number.isFinite(referenceLengthMm) || referenceLengthMm < 1 || referenceLengthMm > 10_000) {
    throw new Error('Enter a measured longest edge between 1 and 10,000 mm.');
  }

  const scaleFactor = referenceLengthMm / normalized.length;
  if (scaleFactor < 0.25 || scaleFactor > 4) {
    throw new Error('That measurement differs too much from the scan estimate. Check the edge and units, or enter all dimensions manually.');
  }

  const roundTenth = (value: number) => Math.round(value * 10) / 10;
  return {
    dimensionsMm: {
      length: roundTenth(referenceLengthMm),
      width: roundTenth(normalized.width * scaleFactor),
      height: roundTenth(normalized.height * scaleFactor),
    },
    scaleFactor,
  };
}
