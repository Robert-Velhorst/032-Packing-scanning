import type {DimensionsMm,EvidenceSource,Flexibility,ItemCategory,LibraryItem,PackingForm,PackingShape,ScaleCalibration,ScanRecord,UnitSystem} from './types';
import type { Evidence } from './types';
import { handlingEvidenceError } from './property-evidence';
import type {TripSuggestion} from './trip-assistant';
export interface ItemEditorDraft {
  version:1;initial?:LibraryItem;suggestion?:TripSuggestion;sourceTripId?:string;unit:UnitSystem;
  name:string;category:ItemCategory;length:string;width:string;height:string;mass:string;
  dimensionSource:EvidenceSource;massSource:EvidenceSource;flexibility:Flexibility;fragile:boolean;
  topLoad:string;topLoadSource:EvidenceSource;keepUpright:boolean;scan?:ScanRecord;
  flexibilityEvidence?:Evidence;fragileEvidence?:Evidence;keepUprightEvidence?:Evidence;
  formsNeedRecovery:boolean;packingForms:PackingForm[];packingShape?:PackingShape;
  calibrationBasis?:DimensionsMm;scaleCalibration?:ScaleCalibration;scannedEstimate:boolean;
  scanDimensionsEdited:boolean;scaleReference:string;removePhoto:boolean;
}
export function isItemEditorDraft(value:unknown):value is ItemEditorDraft {
  if(!value||typeof value!=='object')return false;const d=value as Record<string,unknown>;
  if(d.version!==1||!['metric','imperial'].includes(d.unit as string))return false;
  for(const key of ['name','length','width','height','mass','topLoad','scaleReference'])if(typeof d[key]!=='string'||(d[key] as string).length>500)return false;
  for(const key of ['fragile','keepUpright','formsNeedRecovery','scannedEstimate','scanDimensionsEdited','removePhoto'])if(typeof d[key]!=='boolean')return false;
  if(!['clothing','footwear','electronics','toiletries','medicine','documents','accessories','other'].includes(d.category as string)||!['rigid','slightly_deformable','foldable','rollable','compressible','freeform'].includes(d.flexibility as string)||!Array.isArray(d.packingForms))return false;
  for(const key of ['dimensionSource','massSource','topLoadSource'])if(!['measured','known','estimated','user_confirmed','provider'].includes(d[key] as string))return false;
  if(d.initial!==undefined){const item=d.initial as Partial<LibraryItem>;if(!item||typeof item.id!=='string'||typeof item.updatedAt!=='string'||!item.dimensions)return false;}
  if(d.sourceTripId!==undefined&&typeof d.sourceTripId!=='string')return false;
  if(handlingEvidenceError(d as unknown as ItemEditorDraft))return false;
  return true;
}
