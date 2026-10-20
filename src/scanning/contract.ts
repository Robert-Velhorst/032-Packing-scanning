import type { DimensionsMm, ScanRecord } from '../types.ts';
import {parseItemRecognition,type ItemRecognition} from './recognition.ts';
import {validScanCoverageRecord} from './capture-guidance.ts';

export type ScanTarget = ScanRecord['target'];

/** Shared native-to-web contract. Dimensions are estimates until physically checked. */
export interface ScanResult {
  record: ScanRecord;
  dimensionsMm: DimensionsMm;
  warnings: string[];
  recognition?:ItemRecognition;
}

export interface ScanCapabilities {
  supported: boolean;
  platform: 'ios' | 'android' | 'web';
  minimumOsVersion?: number;
  reason?: string;
  recognitionSupported?:boolean;
}

export function normalizeScanDimensions(value: unknown): DimensionsMm {
  if (!value || typeof value !== 'object') throw new Error('The scan did not return usable dimensions.');
  const dimensions = value as Partial<DimensionsMm>;
  const values = [dimensions.length, dimensions.width, dimensions.height];
  if (!values.every((part) => typeof part === 'number' && Number.isFinite(part) && part > 0)) {
    throw new Error('The scan did not return three positive dimensions.');
  }
  const [length, width, height] = (values as number[]).sort((a, b) => b - a);
  return { length, width, height };
}

export function parseScanResult(value: unknown, expectedTarget: ScanTarget): ScanResult {
  if (!value || typeof value !== 'object') throw new Error('The scanner returned an invalid result.');
  const result = value as Partial<ScanResult>;
  const record = result.record as Partial<ScanRecord> | undefined;
  if (!record || typeof record.id !== 'string' || !record.id || record.target !== expectedTarget
    || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
    || !['ios', 'android'].includes(record.platform ?? '')
    || !['guided_object_capture', 'arcore_depth', 'arkit_scene_depth'].includes(record.method ?? '')
    || !Number.isInteger(record.completedPasses) || (record.completedPasses ?? -1) < 1
    || typeof record.modelStoredLocally !== 'boolean') {
    throw new Error('The scanner returned incomplete capture details.');
  }
  if ((record.platform === 'ios' && record.method !== 'guided_object_capture' && record.method !== 'arkit_scene_depth')
    || (record.platform === 'android' && record.method !== 'arcore_depth')) {
    throw new Error('The scanner returned inconsistent capture details.');
  }
  if (record.geometry && (record.geometry.units !== 'metres'
    || !['ply_point_cloud', 'usdz'].includes(record.geometry.format)
    || !['capture_local_right_handed', 'model_local_right_handed'].includes(record.geometry.coordinateFrame)
    || (record.geometry.format === 'ply_point_cloud' && (!Number.isInteger(record.geometry.pointCount) || (record.geometry.pointCount ?? 0) < 1)))) {
    throw new Error('The scanner returned invalid geometry details.');
  }
  if (record.geometry?.envelope && (record.platform !== 'android' && record.method !== 'arkit_scene_depth' || record.geometry.format !== 'ply_point_cloud'
    || record.geometry.coordinateFrame !== 'capture_local_right_handed' || record.geometry.envelope.method !== 'oriented_surface_envelope_v1'
    || !['capture_aligned','principal_components','orientation_search'].includes(record.geometry.envelope.basis)
    || record.geometry.envelope.paddingMm !== 2.5)) throw new Error('The scanner returned invalid envelope details.');
  if (record.quality && (!Number.isInteger(record.quality.depthFrames) || record.quality.depthFrames < 1
    || !Number.isInteger(record.quality.viewCount) || record.quality.viewCount < 1
    || !Number.isFinite(record.quality.confidenceThreshold) || record.quality.confidenceThreshold <= 0 || record.quality.confidenceThreshold > 1
    || !Number.isFinite(record.quality.voxelSizeMm) || record.quality.voxelSizeMm <= 0)) {
    throw new Error('The scanner returned invalid quality details.');
  }
  if(record.quality?.confidenceKind!==undefined&&(record.method!=='arkit_scene_depth'||record.quality.confidenceKind!=='arkit_high_category'))throw new Error('The scanner returned invalid confidence semantics.');
  if(record.method==='arkit_scene_depth'){
    const g=record.geometry,q=record.quality;
    if(!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(record.id)||!g||g.format!=='ply_point_cloud'||g.coordinateFrame!=='capture_local_right_handed'||!g.envelope
      ||!Number.isSafeInteger(g.pointCount)||(g.pointCount??0)<300||(g.pointCount??0)>60000
      ||!q||q.confidenceKind!=='arkit_high_category'||q.confidenceThreshold!==1||q.voxelSizeMm!==5
      ||!Number.isSafeInteger(q.depthFrames)||q.depthFrames<6||q.depthFrames>12000
      ||!Number.isSafeInteger(q.viewCount)||q.viewCount<3||q.viewCount>Math.min(q.depthFrames,1000)||record.completedPasses!==q.viewCount
      ||typeof q.pointLimitReached!=='boolean'||q.pointLimitReached&&g.pointCount!==60000||q.coverage!==undefined)
      throw new Error('The scanner returned inconsistent iOS depth details.');
  }
  const dimensionsMm = normalizeScanDimensions(result.dimensionsMm);
  if(record.method==='arkit_scene_depth'&&Object.values(dimensionsMm).some(side=>side>10000))throw new Error('The scanner returned invalid iOS depth dimensions.');
  if(!validScanCoverageRecord(record))throw new Error('The scanner returned invalid capture diagnostics.');
  const warnings = Array.isArray(result.warnings) && result.warnings.every((warning) => typeof warning === 'string')
    ? result.warnings : [];
  return { record: { ...record, dimensionsEstimateMm: dimensionsMm } as ScanRecord, dimensionsMm, warnings,
    ...(expectedTarget==='item'&&record.platform==='android'&&result.recognition!==undefined?{recognition:parseItemRecognition(result.recognition)}:{}) };
}
