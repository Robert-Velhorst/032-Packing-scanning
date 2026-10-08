/** Display practical precision without changing an untouched stored measurement. */
export function measurementInput(value: number | undefined, unitsPerDisplayUnit: number): string {
  return value === undefined ? '' : String(Number((value / unitsPerDisplayUnit).toFixed(4)));
}

export function measurementFromInput(input: string, unitsPerDisplayUnit: number, original?: number): number {
  if (original !== undefined && Number(input) === Number(measurementInput(original, unitsPerDisplayUnit))) return original;
  return Number(input) * unitsPerDisplayUnit;
}
