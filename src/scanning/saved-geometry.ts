import type { DimensionsMm, ScanRecord } from '../types.ts';

export interface SavedGeometryPreview {
  id: string;
  target: ScanRecord['target'];
  format: 'point_cloud_preview';
  units: 'millimetres';
  sourceHash: string;
  pointCount: number;
  samplePointCount: number;
  /** Flat x,y,z,confidence tuples in original scan-envelope coordinates. */
  pointsMm: number[];
  envelope: {
    method: 'oriented_surface_envelope_v1' | 'capture_aligned_legacy';
    basis: 'capture_aligned' | 'principal_components' | 'orientation_search' | 'capture_aligned_legacy';
    paddingMm: number;
    dimensionsMm: DimensionsMm;
  };
}

export function parseSavedGeometry(value: unknown, expected: Pick<ScanRecord,'id'|'target'|'dimensionsEstimateMm'>): SavedGeometryPreview {
  const fail = () => { throw new Error('The saved geometry returned incomplete or inconsistent source data. Your recorded dimensions are unchanged.'); };
  if (!value || typeof value !== 'object') return fail();
  const preview = value as Partial<SavedGeometryPreview>;
  const envelope = preview.envelope, dimensions = envelope?.dimensionsMm;
  if (preview.id !== expected.id || preview.target !== expected.target || preview.format !== 'point_cloud_preview' || preview.units !== 'millimetres'
    || typeof preview.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(preview.sourceHash)
    || !Number.isInteger(preview.pointCount) || (preview.pointCount ?? 0) < 4 || (preview.pointCount ?? 0) > 60000
    || !Number.isInteger(preview.samplePointCount) || (preview.samplePointCount ?? 0) < 1 || (preview.samplePointCount ?? 0) > Math.min(8000,preview.pointCount ?? 0)
    || !envelope || !['oriented_surface_envelope_v1','capture_aligned_legacy'].includes(envelope.method)
    || !['capture_aligned','principal_components','orientation_search','capture_aligned_legacy'].includes(envelope.basis)
    || !Number.isFinite(envelope.paddingMm) || (envelope.method === 'oriented_surface_envelope_v1' ? envelope.paddingMm !== 2.5 || envelope.basis === 'capture_aligned_legacy' : envelope.paddingMm !== 0 || envelope.basis !== 'capture_aligned_legacy')
    || !dimensions || ![dimensions.length,dimensions.width,dimensions.height].every((side) => typeof side === 'number' && Number.isFinite(side) && side>0 && side<=10000)
    || !Array.isArray(preview.pointsMm) || preview.pointsMm.length !== preview.samplePointCount! * 4) return fail();
  if (expected.dimensionsEstimateMm) {
    const original = expected.dimensionsEstimateMm;
    if (![original.length,original.width,original.height].every((side)=>typeof side==='number'&&Number.isFinite(side)&&side>0&&side<=10000)) return fail();
    if (['length','width','height'].some((axis) => Math.abs(dimensions[axis as keyof DimensionsMm]-original[axis as keyof DimensionsMm])>0.001)) return fail();
  }
  const bounds = [dimensions.length,dimensions.width,dimensions.height];
  for (let i=0;i<preview.pointsMm.length;i+=4) {
    for (let axis=0;axis<3;axis++) if (!Number.isFinite(preview.pointsMm[i+axis]) || preview.pointsMm[i+axis]<-0.001 || preview.pointsMm[i+axis]>bounds[axis]+0.001) return fail();
    if (!Number.isFinite(preview.pointsMm[i+3]) || preview.pointsMm[i+3]<0.8 || preview.pointsMm[i+3]>1) return fail();
  }
  return preview as SavedGeometryPreview;
}
