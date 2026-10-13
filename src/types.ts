import type { CarrierCatalog, CarrierRetrieval } from './carrier-catalog.ts';
import type { ReconstructedSolid } from './scanning/reconstructed-solid.ts';
import type { InteriorCavity } from './scanning/interior-cavity.ts';
import type { ScanCoverage } from './scanning/capture-guidance.ts';
import type { SharedPackBaseline } from './shared-pack-baseline.ts';

export interface PackingInterior {
  cavity: InteriorCavity;
  travelUp: { axis: 0 | 1 | 2; sign: 1 | -1 };
  scale: number;
  adoptedAt: string;
  /** Explicit entry/seed review and usable lowest-floor assumption, not sensor verification. */
  evidence: Evidence;
  supportReview?: {
    captureId: string;
    sourceHash: string;
    scale: number;
    travelUp: { axis: 0 | 1 | 2; sign: 1 | -1 };
    evidence: Evidence;
  };
}

/** Explicitly adopted derivative; the original native capture remains separate. */
export interface PackingShape {
  solid: ReconstructedSolid;
  sourceEnvelopeMm: DimensionsMm;
  fittedDimensionsMm: DimensionsMm;
  adoptedAt: string;
  upright?: UprightDirection;
}

/** Traveller-reviewed top direction in this exact source envelope's coordinates. */
export interface UprightDirection {
  axis: 'length' | 'width' | 'height';
  sign: 1 | -1;
  captureId: string;
  sourceHash: string;
  evidence: Evidence;
}

export type EvidenceSource = 'measured' | 'known' | 'estimated' | 'user_confirmed' | 'provider';
export type OptimizationMode = 'balanced' | 'maximum_capacity' | 'easy_access' | 'fragile_protection';
export type ItemCategory = 'clothing' | 'footwear' | 'electronics' | 'toiletries' | 'medicine' | 'documents' | 'accessories' | 'other';
export type Flexibility = 'rigid' | 'slightly_deformable' | 'foldable' | 'rollable' | 'compressible' | 'freeform';
export type ItemPriority = 'required' | 'preferred' | 'optional';
export type UnitSystem = 'metric' | 'imperial';
export type TripActivity = 'city' | 'business' | 'beach' | 'outdoors' | 'formal_event' | 'sports';

export interface Evidence {
  source: EvidenceSource;
  confidence: number;
  collectedAt: string;
  note?: string;
}

export interface ScanRecord {
  id: string;
  target: 'item' | 'container_interior';
  createdAt: string;
  platform: 'ios' | 'android';
  method: 'guided_object_capture' | 'arcore_depth';
  completedPasses: number;
  modelStoredLocally: boolean;
  /** Confirmation of original-source removal, separate from saved planning derivatives. */
  sourceRetention?: { reason: 'raw_scan_retention'; confirmedAt: string };
  /** Original bounding-box estimate, retained so later scale calibration stays auditable. */
  dimensionsEstimateMm?: DimensionsMm;
  geometry?: {
    format: 'ply_point_cloud' | 'usdz';
    units: 'metres';
    coordinateFrame: 'capture_local_right_handed' | 'model_local_right_handed';
    pointCount?: number;
    envelope?: {
      method: 'oriented_surface_envelope_v1';
      basis: 'capture_aligned' | 'principal_components' | 'orientation_search';
      /** Margin on each envelope face; does not bound sensor error or missing surfaces. */
      paddingMm: number;
    };
  };
  quality?: {
    depthFrames: number;
    viewCount: number;
    confidenceThreshold: number;
    voxelSizeMm: number;
    coverage?: ScanCoverage;
  };
}

export interface DimensionsMm {
  length: number;
  width: number;
  height: number;
}

export interface ScaleCalibration {
  method: 'measured_longest_edge';
  referenceLengthMm: number;
  calibratedAt: string;
}

/** A reproducible, independently reviewed rectangular envelope after preparation. */
export interface PackingForm {
  id: string;
  name: string;
  kind: 'folded' | 'rolled' | 'compressed';
  dimensions: DimensionsMm;
  dimensionEvidence: Evidence;
  preparation: string;
  reviewedAt: string;
  maxTopLoadGrams?: number;
  topLoadEvidence?: Evidence;
}

export interface LibraryItem {
  id: string;
  name: string;
  category: ItemCategory;
  dimensions: DimensionsMm;
  dimensionEvidence: Evidence;
  massGrams?: number;
  massRangeGrams?: { min: number; max: number };
  massEvidence?: Evidence;
  flexibility: Flexibility;
  flexibilityEvidence?: Evidence;
  fragile: boolean;
  fragileEvidence?: Evidence;
  /** Additional static mass allowed above this item, not pressure or impact resistance. */
  maxTopLoadGrams?: number;
  topLoadEvidence?: Evidence;
  keepUpright: boolean;
  keepUprightEvidence?: Evidence;
  photoId?: string;
  scan?: ScanRecord;
  packingShape?: PackingShape;
  packingForms?: PackingForm[];
  scaleCalibration?: ScaleCalibration;
  createdAt: string;
  updatedAt: string;
}

export interface Traveller {
  id: string;
  name: string;
}

export interface PackEntry {
  id: string;
  itemId: string;
  travellerId: string;
  quantity: number;
  priority: ItemPriority;
  accessPriority: number;
  required: boolean;
  containerId?: string;
  compartmentId?: string;
  packingFormId?: string;
}

export interface Container {
  id: string;
  name: string;
  kind: 'cabin_case' | 'checked_case' | 'personal_item' | 'backpack' | 'duffel' | 'other';
  inside: DimensionsMm;
  /** Separately reviewed rectangular packing areas; unrecorded space stays unused. */
  compartments?: ContainerCompartment[];
  packingInterior?: PackingInterior;
  /** Conservatively recorded intrusions or compartments that must stay empty. */
  unavailableSpaces?: UnavailableSpace[];
  /** Keep this much vertical space free below the lid; not a closure guarantee. */
  lidClearanceMm?: number;
  lidClearanceEvidence?: Evidence;
  /** Traveller-measured external dimensions, including any carrier-counted protrusions. */
  outerDimensionsMm?: DimensionsMm;
  outerDimensionsEvidence?: Evidence;
  opening: { length: number; width: number };
  openingEvidence?: Evidence;
  insideEvidence: Evidence;
  tareGrams?: number;
  tareEvidence?: Evidence;
  massLimitGrams?: number;
  massLimitEvidence?: Evidence;
  scan?: ScanRecord;
  scaleCalibration?: ScaleCalibration;
  travellerIds: string[];
  createdAt: string;
}

export interface UnavailableSpace extends DimensionsMm {
  id: string;
  name: string;
  /** Millimetres from the same inside corner used by packing instructions. */
  x: number;
  y: number;
  z: number;
  evidence: Evidence;
}

export interface ContainerCompartment extends DimensionsMm {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  opening: { length: number; width: number };
  evidence: Evidence;
  /** Review of independent top access and supporting closed bases in both orientations. */
  supportEvidence: Evidence;
  massLimitGrams?: number;
  massLimitEvidence?: Evidence;
  allowedCategories?: ItemCategory[];
}

export interface CarrierLimits {
  /** Maximum number of physical bags in this source's explicitly selected set. */
  maxBagCount?: number;
  /** Per-bag maximum for each external side; orientation may be rotated. */
  maxOuterDimensionsMm?: DimensionsMm;
  /** Per-bag maximum for the sum of the three external dimensions. */
  maxOuterLinearSumMm?: number;
  /** Applies either to every bag or to the selected bags together. */
  maxWeightGrams?: number;
  weightScope?: 'per_bag' | 'combined';
}

export interface CarrierRule {
  id: string;
  carrier: string;
  route: string;
  fare: string;
  sourceUrl: string;
  retrievedAt: string;
  staleAfterDays: number;
  applicableBagIds: string[];
  notes: string;
  status: 'manual' | 'verified';
  limits?: CarrierLimits;
  /** Immutable retrieved baseline; manual edits never refresh or replace this evidence. */
  retrieval?: CarrierRetrieval;
}

export interface Trip {
  /** Explicitly retrieved and saved forecast; no automatic location requests. */
  weather?: import('./weather.ts').SavedWeather;
  id: string;
  name: string;
  destination: string;
  startDate?: string;
  endDate?: string;
  packingOnly: boolean;
  activities?: TripActivity[];
  laundryAvailable?: boolean;
  sample: boolean;
  travellers: Traveller[];
  containerIds: string[];
  entries: PackEntry[];
  /** Traveller-chosen hard separation between every copy of two pack entries. */
  separationRules?: SeparationRule[];
  mode: OptimizationMode;
  completedInstanceIds: string[];
  unavailableInstanceIds: string[];
  lockedPlacements: Placement[];
  /** Real-world placement attempts rejected during packing, separate from absent items. */
  rejectedPlacements?: Placement[];
  /** Last explicitly selected packing step; local and included in backups. */
  packingCursor?: string;
  carrierRules: CarrierRule[];
  createdAt: string;
  updatedAt: string;
  /** A local working copy of one explicitly opened household version. */
  sharedPack?: { householdId: string; packId: string; revision: number; idPrefix: string; baseline?: SharedPackBaseline };
}

export interface AppData {
  schemaVersion: number;
  unitSystem: UnitSystem;
  settings: UserSettings;
  trips: Trip[];
  containers: Container[];
  libraryItems: LibraryItem[];
  activeTripId: string;
  locale: string;
  /** Previously retrieved public rules, available without a network connection. */
  carrierCatalog?: CarrierCatalog;
}

export interface PlanItem {
  instanceId: string;
  entryId: string;
  itemId: string;
  travellerId: string;
  name: string;
  category?: ItemCategory;
  dimensions: DimensionsMm;
  packingShape?: PackingShape;
  packingForm?: PackingForm;
  dimensionEvidence?: Evidence;
  volumeMm3: number;
  massGrams?: number;
  upperMassGrams?: number;
  massEvidenceSource?: EvidenceSource;
  fragile: boolean;
  maxTopLoadGrams?: number;
  topLoadEvidence?: Evidence;
  keepUpright: boolean;
  priority: ItemPriority;
  required: boolean;
  accessPriority: number;
  assignedContainerId?: string;
  assignedCompartmentId?: string;
}

export interface Placement {
  instanceId: string;
  entryId: string;
  itemId: string;
  containerId: string;
  compartmentId?: string;
  compartmentKey?: string;
  x: number;
  y: number;
  z: number;
  length: number;
  width: number;
  height: number;
  layer: number;
  rotation: number;
  /** Identifies the derivative and scale actually used for this placement. */
  shapeKey?: string;
  /** Reviewed bag cavity, packing frame and scale used by this placement. */
  interiorKey?: string;
  /** Exact reviewed preparation and envelope chosen for this pack entry. */
  packingFormId?: string;
  packingFormKey?: string;
  /** Planner's reachable insertion sequence, distinct from height/layer labels. */
  insertionOrder?: number;
  locked?: boolean;
}

export interface ExcludedItem {
  instanceId: string;
  entryId: string;
  itemId: string;
  name: string;
  required: boolean;
  reason: string;
}

export interface ContainerSummary {
  containerId: string;
  itemCount: number;
  usedMassGrams: number;
  massLimitGrams?: number;
  volumeUsedMm3: number;
  volumeCapacityMm3: number;
  unweighedCount: number;
  estimatedMassCount: number;
}

export interface PackingPlan {
  mode: OptimizationMode;
  placements: Placement[];
  excluded: ExcludedItem[];
  summaries: ContainerSummary[];
  warnings: string[];
  stackLoads?: StackLoadCheck[];
  /** Current mass conflicts; physical saved positions remain in the trip, never moved by this check. */
  massConflicts?: BagMassConflict[];
  totalItems: number;
  requiredExcludedCount: number;
  score: number;
  createdAt: string;
}

export interface SeparationRule {
  id: string;
  firstEntryId: string;
  secondEntryId: string;
  kind: 'different_bags' | 'different_compartments' | 'clearance';
  clearanceMm?: number;
  note?: string;
}

export interface BagMassConflict {
  containerId: string;
  status: 'over' | 'invalid';
  knownUpperMassGrams?: number;
  limitGrams?: number;
  missingItemCount: number;
  missingTare: boolean;
  reason: string;
}

export interface StackLoadCheck {
  instanceId: string;
  containerId: string;
  /** Missing on legacy/default packing checks; travel checks use a separate gravity frame. */
  orientation?: 'travel';
  /** Distinct supported descendants, counted fully on every support path. */
  aboveInstanceIds: string[];
  upperLoadGrams: number;
  unknownMassCount: number;
  limitGrams?: number;
  status: 'clear' | 'within_recorded_limit' | 'unverified' | 'conflict';
  reason?: string;
}

export interface UserSettings {
  automaticPhotoDeletionDays: number | null;
  automaticScanDeletionDays?: 7 | 30 | 90 | null;
  highContrast: boolean;
  reduceMotion: boolean;
}
