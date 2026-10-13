import { separationRuleError } from './item-separation.ts';
import { isSavedWeather } from './weather.ts';
import {validScanRetentionDays} from './scan-retention.ts';
import {validScanCoverageRecord} from './scanning/capture-guidance.ts';
import {validSharedPackLink} from './shared-pack-baseline.ts';
import { handlingEvidenceError, openingEvidenceError } from './property-evidence.ts';
import {compartmentAssignmentError} from './compartments.ts';
import type { AppData } from './types.ts';
import { isCarrierCatalog } from './carrier-catalog.ts';
import { isValidCarrierRuleRecord } from './carrier-rules.ts';
import { isValidRejectedPlacement } from './packing-progress.ts';
import { containerSpaceError } from './container-space.ts';
import { packingShapeError } from './packing-geometry.ts';
import { packingFormsError } from './packing-forms.ts';
import { topLoadError } from './stack-load.ts';
import { bagMassRecordError, itemMassError } from './mass-constraints.ts';

export interface PackingBackup { format: 'packing-scanning-backup'; app: AppData; photos: Array<{ id: string; dataUrl: string; createdAt?: string }>; exportedAt?: string; }

/** Explicit account uploads retain planning derivatives, never native links or photos. */
export function accountMetadataBackup(data: AppData): PackingBackup {
  const app = structuredClone(data);
  for (const item of app.libraryItems) { delete item.scan; delete item.photoId; }
  for (const bag of app.containers) delete bag.scan;
  return { format: 'packing-scanning-backup', exportedAt: new Date().toISOString(), app, photos: [] };
}

export function isPackingBackup(value: unknown): value is PackingBackup {
  if (!value || typeof value !== 'object') return false;
  const backup = value as { format?:unknown; app?:unknown; photos?:unknown };
  if (backup.format !== 'packing-scanning-backup' || !backup.app || typeof backup.app !== 'object' || !Array.isArray(backup.photos)) return false;
  const app=backup.app as Partial<AppData>;
  if (app.schemaVersion!==1 || !Array.isArray(app.trips) || !Array.isArray(app.containers) || !Array.isArray(app.libraryItems)
    || (app.carrierCatalog !== undefined && !isCarrierCatalog(app.carrierCatalog))
    || !app.settings || typeof app.settings !== 'object' || Array.isArray(app.settings)||!validScanRetentionDays(app.settings.automaticScanDeletionDays)
    || !['metric','imperial'].includes(app.unitSystem ?? '') || typeof app.activeTripId !== 'string'
    || !app.trips.every((trip) => !!trip && typeof trip.id === 'string' && typeof trip.name === 'string' && Array.isArray(trip.travellers) && Array.isArray(trip.entries) && Array.isArray(trip.containerIds) && Array.isArray(trip.lockedPlacements) && trip.lockedPlacements.every(isValidRejectedPlacement) && ['balanced','maximum_capacity','easy_access','fragile_protection'].includes(trip.mode) && (trip.rejectedPlacements === undefined || (Array.isArray(trip.rejectedPlacements) && trip.rejectedPlacements.every(isValidRejectedPlacement))) && Array.isArray(trip.carrierRules) && trip.carrierRules.every((rule) => isValidCarrierRuleRecord(rule, trip.containerIds)))
    || !app.containers.every((bag) => !!bag && validScanCoverageRecord(bag.scan) && typeof bag.id === 'string' && typeof bag.name === 'string' && validDimensions(bag.inside) && !containerSpaceError(bag) && (bag.outerDimensionsMm === undefined || validDimensions(bag.outerDimensionsMm)) && validOpening(bag.opening) && !openingEvidenceError(bag) && !bagMassRecordError(bag))
    || !app.libraryItems.every((item) => !!item && validScanCoverageRecord(item.scan) && typeof item.id === 'string' && typeof item.name === 'string' && validDimensions(item.dimensions) && !itemMassError(item) && !handlingEvidenceError(item) && !topLoadError(item) && !packingShapeError(item) && !packingFormsError(item) && !!item.dimensionEvidence && typeof item.dimensionEvidence.source === 'string')) return false;
  if (!app.trips.every(trip => !separationRuleError(trip))) return false;
  if (!app.trips.every(trip => validSharedPackLink(trip.sharedPack))) return false;
  if (!app.trips.every(trip => trip.weather === undefined || isSavedWeather(trip.weather))) return false;
  if (!app.trips.every((trip) => trip.packingCursor === undefined || typeof trip.packingCursor === 'string')) return false;
  if(!app.trips.every(trip=>trip.entries.every(entry=>!compartmentAssignmentError(entry)&&(entry.packingFormId===undefined||typeof entry.packingFormId==='string'&&entry.packingFormId.trim().length>0&&entry.packingFormId.length<=80))))return false;
  const seenPhotoIds = new Set<string>();
  return backup.photos.every((photo) => !!photo && typeof photo === 'object'
    && typeof (photo as { id?:unknown }).id === 'string' && Boolean((photo as { id:string }).id)
    && !seenPhotoIds.has((photo as { id:string }).id) && Boolean(seenPhotoIds.add((photo as { id:string }).id))
    && typeof (photo as { dataUrl?:unknown }).dataUrl === 'string'
    && /^data:image\/(png|jpeg|webp|gif);base64,/i.test((photo as { dataUrl:string }).dataUrl)
    && (photo as { dataUrl:string }).dataUrl.length <= 18_000_000);
}

function validDimensions(value: unknown): value is { length:number; width:number; height:number } {
  if (!value || typeof value !== 'object') return false;
  const box=value as {length?:unknown;width?:unknown;height?:unknown};
  return [box.length,box.width,box.height].every((dimension)=>typeof dimension==='number'&&Number.isFinite(dimension)&&dimension>0);
}

function validOpening(value: unknown): value is { length:number; width:number } {
  if (!value || typeof value !== 'object') return false;
  const opening=value as {length?:unknown;width?:unknown};
  return [opening.length,opening.width].every((dimension)=>typeof dimension==='number'&&Number.isFinite(dimension)&&dimension>0);
}
