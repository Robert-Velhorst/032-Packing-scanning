import type { AppData, Container, LibraryItem, Placement, Trip } from './types.ts';
import { isPackingBackup } from './backup.ts';
import {canonicalSharedValue,isSharedPackBaseline,type SharedPackBaseline} from './shared-pack-baseline.ts';

export interface SharedPackingRecords { format: 'packing-scanning-shared-pack'; trip: Trip; libraryItems: LibraryItem[]; containers: Container[]; }
export interface SharedPackSummary { id: string; name: string; revision: number; updatedAt: string; updatedBy: string; }
export interface SharedPackSnapshot extends SharedPackSummary { householdId: string; records: SharedPackingRecords; }
export interface HouseholdSummary { id: string; name: string; ownerId: string; createdAt: string; }
export interface HouseholdDetail extends HouseholdSummary { members: Array<{ id: string; name: string; username: string }>; packs: SharedPackSummary[]; invitations: Array<{ id: string; username: string; expiresAt: string }>; }
export interface SharedCopyWitness {tripId:string;localCanonical:string;linkCanonical:string;}
const tripFields = ['id','name','destination','startDate','endDate','packingOnly','activities','laundryAvailable','weather','sample','travellers','containerIds','entries','separationRules','mode','completedInstanceIds','unavailableInstanceIds','lockedPlacements','rejectedPlacements','packingCursor','carrierRules','createdAt','updatedAt'] as const;
const itemFields = ['id','name','category','dimensions','dimensionEvidence','massGrams','massRangeGrams','massEvidence','flexibility','flexibilityEvidence','fragile','fragileEvidence','maxTopLoadGrams','topLoadEvidence','keepUpright','keepUprightEvidence','packingShape','packingForms','scaleCalibration','createdAt','updatedAt'] as const;
const bagFields = ['id','name','kind','inside','compartments','packingInterior','unavailableSpaces','lidClearanceMm','lidClearanceEvidence','outerDimensionsMm','outerDimensionsEvidence','opening','openingEvidence','insideEvidence','tareGrams','tareEvidence','massLimitGrams','massLimitEvidence','scaleCalibration','travellerIds','createdAt'] as const;
const pick = <T>(value: T, fields: readonly string[]): T => Object.fromEntries(fields.filter(key => (value as Record<string, unknown>)[key] !== undefined).map(key => [key, structuredClone((value as Record<string, unknown>)[key])])) as T;
const text = (v: unknown, max = 160) => typeof v === 'string' && v.length > 0 && v.length <= max;
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const unique = (ids: string[]) => new Set(ids).size === ids.length;
const keys = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const date = (value: unknown) => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
export function isSharedPackSnapshot(value:unknown):value is SharedPackSnapshot {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;const p=value as SharedPackSnapshot;
  return [p.id,p.householdId,p.updatedBy].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(v))&&text(p.name,120)&&date(p.updatedAt)&&Number.isSafeInteger(p.revision)&&p.revision>=1&&isSharedPackingRecords(p.records);
}
const evidence = (value: unknown) => {if(!value||typeof value!=='object'||Array.isArray(value))return false;const e=value as Record<string,unknown>;return keys(e,['source','confidence','collectedAt','note'])&&['measured','known','estimated','user_confirmed','provider'].includes(String(e.source))&&finite(e.confidence)&&Number(e.confidence)<=1&&date(e.collectedAt)&&(e.note===undefined||typeof e.note==='string'&&e.note.length<=2000);};
const calibration = (value: unknown) => {if(value===undefined)return true;if(!value||typeof value!=='object')return false;const c=value as Record<string,unknown>;return keys(c,['method','referenceLengthMm','calibratedAt'])&&c.method==='measured_longest_edge'&&finite(c.referenceLengthMm)&&Number(c.referenceLengthMm)>=1&&Number(c.referenceLengthMm)<=10000&&date(c.calibratedAt);};
const nestedFields: Record<string, readonly string[]> = {
  weather:['destination','forecast'],forecast:['provider','version','place','retrievedAt','sourceUrl','sourceHash','gridLatitude','gridLongitude','days'],
  place:['id','name','region','country','countryCode','latitude','longitude','timezone'],days:['date','minC','maxC','precipitationProbability'],
  separationRules: ['id','firstEntryId','secondEntryId','kind','clearanceMm','note'],
  trip:tripFields,libraryItems:itemFields,containers:bagFields,travellers:['id','name'],entries:['id','itemId','travellerId','quantity','priority','accessPriority','required','containerId','compartmentId','packingFormId'],
  packingShape:['solid','sourceEnvelopeMm','fittedDimensionsMm','adoptedAt','upright'],
  solid:['id','target','format','units','sourceHash','sourcePointCount','method','resolutionMm','grid','occupiedCells','observedCellCount','enclosedCellCount','surfaceFaceCount','dimensionsMm','warnings'],
  packingInterior:['cavity','travelUp','scale','adoptedAt','evidence','supportReview'],
  cavity:['id','target','format','units','sourceHash','sourcePointCount','method','grid','boundsMm','cellSizeMm','seedMm','opening','freeCells','observedCells','wallCellCount','surfaceFaceCount','estimatedVolumeMm3','warnings'],
  travelUp:['axis','sign'],upright:['axis','sign','captureId','sourceHash','evidence'],supportReview:['captureId','sourceHash','scale','travelUp','evidence'],
  packingForms:['id','name','kind','dimensions','dimensionEvidence','preparation','reviewedAt','maxTopLoadGrams','topLoadEvidence'],
  compartments:['id','name','x','y','z','length','width','height','opening','evidence','supportEvidence','massLimitGrams','massLimitEvidence','allowedCategories'],
  unavailableSpaces:['id','name','x','y','z','length','width','height','evidence'],opening:['length','width','axis','sign','planeMm','cells'],scaleCalibration:['method','referenceLengthMm','calibratedAt'],massRangeGrams:['min','max'],
  carrierRules:['id','carrier','route','fare','sourceUrl','retrievedAt','staleAfterDays','applicableBagIds','notes','status','limits','retrieval'],retrieval:['catalog','allowanceId'],catalog:['carrier','sourceUrl','retrievedAt','sourceHash','adapterVersion','staleAfterDays','allowances'],allowances:['id','title','applicability','caveats','limits'],limits:['maxBagCount','maxOuterDimensionsMm','maxOuterLinearSumMm','maxWeightGrams','weightScope'],
};
for(const key of ['dimensions','inside','outerDimensionsMm','sourceEnvelopeMm','fittedDimensionsMm','dimensionsMm','boundsMm','cellSizeMm','maxOuterDimensionsMm'])nestedFields[key]=['length','width','height'];
for(const key of ['grid','seedMm'])nestedFields[key]=['x','y','z'];
for(const key of ['flexibilityEvidence','fragileEvidence','keepUprightEvidence','openingEvidence','dimensionEvidence','massEvidence','insideEvidence','outerDimensionsEvidence','topLoadEvidence','tareEvidence','massLimitEvidence','lidClearanceEvidence','evidence','supportEvidence'])nestedFields[key]=['source','confidence','collectedAt','note'];
for(const key of ['lockedPlacements','rejectedPlacements'])nestedFields[key]=['instanceId','entryId','itemId','containerId','compartmentId','compartmentKey','x','y','z','length','width','height','layer','rotation','shapeKey','interiorKey','packingFormId','packingFormKey','insertionOrder','locked'];
function knownFields(value:unknown,parent:string):boolean {
  if(Array.isArray(value))return value.every(child=>knownFields(child,parent));
  if(!value||typeof value!=='object')return true;
  const allowed=nestedFields[parent];return !!allowed&&keys(value,allowed)&&Object.entries(value).every(([key,child])=>knownFields(child,key));
}

/** Share one selected pack; never copy unused private library, preferences or sources. */
export function sharedPackingRecords(data: AppData, tripId: string): SharedPackingRecords {
  const source = data.trips.find(trip => trip.id === tripId); if (!source) throw Error('Choose a saved pack to share.');
  const trip = pick(source, tripFields), items = new Set(trip.entries.map(entry => entry.itemId)), travellers = new Set(trip.travellers.map(person => person.id));
  const records: SharedPackingRecords = { format: 'packing-scanning-shared-pack', trip,
    libraryItems: data.libraryItems.filter(item => items.has(item.id)).map(item => pick(item, itemFields)),
    containers: data.containers.filter(bag => trip.containerIds.includes(bag.id)).map(bag => ({ ...pick(bag, bagFields), travellerIds: bag.travellerIds.filter(id => travellers.has(id)) })) };
  if (source.sharedPack) remapRecords(records, id => id.startsWith(source.sharedPack!.idPrefix) ? id.slice(source.sharedPack!.idPrefix.length) : id);
  if (!isSharedPackingRecords(records)) throw Error('Review this pack’s missing or invalid items, bags, travellers or progress before sharing. Local records are unchanged.');
  return records;
}

/** A separate copy avoids collisions and never overwrites another pack or source file. */
export function openSharedPack(data: AppData, snapshot: SharedPackSnapshot, copyId: string, baseline?:SharedPackBaseline,witness?:SharedCopyWitness): AppData {
  if(witness){try{const source=data.trips.find(t=>t.id===witness.tripId);if(!source||canonicalSharedValue(source.sharedPack)!==witness.linkCanonical||canonicalSharedValue(sharedPackingRecords(data,witness.tripId))!==witness.localCanonical)return data;}catch{return data;}}
  if (!isSharedPackingRecords(snapshot.records) || !text(snapshot.id) || !text(snapshot.householdId) || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || !text(copyId)) throw Error('This shared pack version is unsupported.');
  const records = structuredClone(snapshot.records), prefix = `shared-${copyId}:`;
  if(baseline!==undefined&&(!isSharedPackBaseline(baseline)||baseline.revision!==snapshot.revision||baseline.tripId!==records.trip.id))throw Error('The comparison baseline does not match this shared version.');
  remapRecords(records, id => prefix + id);
  records.trip.sharedPack = { householdId: snapshot.householdId, packId: snapshot.id, revision: snapshot.revision, idPrefix: prefix,...(baseline?{baseline:structuredClone(baseline)}:{}) };
  records.trip.sample = false;
  if (data.trips.some(trip => trip.id === records.trip.id) || records.libraryItems.some(item => data.libraryItems.some(existing => existing.id === item.id)) || records.containers.some(bag => data.containers.some(existing => existing.id === bag.id))) throw Error('Choose a fresh local copy identifier.');
  return { ...data, activeTripId: records.trip.id, trips: [records.trip, ...data.trips], libraryItems: [...records.libraryItems, ...data.libraryItems], containers: [...records.containers, ...data.containers] };
}
function remapRecords(records: SharedPackingRecords, id: (value: string) => string) {
  const trip = records.trip;
  const instance = (value: string) => { const split = value.lastIndexOf('#'); return split < 0 ? id(value) : id(value.slice(0, split)) + value.slice(split); };
  const placement = (p: Placement) => ({ ...p, instanceId: instance(p.instanceId), entryId: id(p.entryId), itemId: id(p.itemId), containerId: id(p.containerId) });
  if(trip.separationRules)trip.separationRules=trip.separationRules.map(rule=>({...rule,id:id(rule.id),firstEntryId:id(rule.firstEntryId),secondEntryId:id(rule.secondEntryId)}));
  trip.id = id(trip.id); trip.travellers = trip.travellers.map(p => ({ ...p, id: id(p.id) })); trip.containerIds = trip.containerIds.map(id);
  trip.entries = trip.entries.map(e => ({ ...e, id: id(e.id), itemId: id(e.itemId), travellerId: id(e.travellerId), ...(e.containerId ? { containerId: id(e.containerId) } : {}) }));
  trip.completedInstanceIds = trip.completedInstanceIds.map(instance); trip.unavailableInstanceIds = trip.unavailableInstanceIds.map(instance);
  trip.lockedPlacements = trip.lockedPlacements.map(placement); trip.rejectedPlacements = trip.rejectedPlacements?.map(placement); trip.packingCursor = trip.packingCursor ? instance(trip.packingCursor) : undefined;
  trip.carrierRules = trip.carrierRules.map(rule => ({ ...rule, id: id(rule.id), applicableBagIds: rule.applicableBagIds.map(id) }));
  records.libraryItems = records.libraryItems.map(item => ({ ...item, id: id(item.id) })); records.containers = records.containers.map(bag => ({ ...bag, id: id(bag.id), travellerIds: bag.travellerIds.map(id) }));
}
export function isSharedPackingRecords(value: unknown): value is SharedPackingRecords {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const records = value as SharedPackingRecords, trip = records.trip;
    if (records.format !== 'packing-scanning-shared-pack' || !keys(records, ['format','trip','libraryItems','containers']) || !trip || !keys(trip, tripFields) || !Array.isArray(records.libraryItems) || records.libraryItems.length > 500 || !Array.isArray(records.containers) || records.containers.length > 20) return false;
    if(!knownFields(trip,'trip')||!knownFields(records.libraryItems,'libraryItems')||!knownFields(records.containers,'containers'))return false;
    const app: AppData = { schemaVersion: 1, trips: [trip], libraryItems: records.libraryItems, containers: records.containers, activeTripId: trip.id, unitSystem: 'metric', locale: 'en', settings: { automaticPhotoDeletionDays: null, highContrast: false, reduceMotion: false } };
    if (!isPackingBackup({ format: 'packing-scanning-backup', app, photos: [] }) || !text(trip.id) || !text(trip.name, 120) || typeof trip.destination !== 'string' || trip.destination.length > 200 || typeof trip.packingOnly !== 'boolean' || typeof trip.sample !== 'boolean' || !text(trip.createdAt) || !text(trip.updatedAt)) return false;
    if(!date(trip.createdAt)||!date(trip.updatedAt)||(trip.startDate!==undefined&&!date(trip.startDate))||(trip.endDate!==undefined&&!date(trip.endDate))||(trip.laundryAvailable!==undefined&&typeof trip.laundryAvailable!=='boolean')||(trip.activities!==undefined&&(!Array.isArray(trip.activities)||trip.activities.length>6||!unique(trip.activities)||!trip.activities.every(a=>['city','business','beach','outdoors','formal_event','sports'].includes(a)))))return false;
    if (trip.travellers.length < 1 || trip.travellers.length > 20 || trip.entries.length > 1000 || !trip.travellers.every(p => p && keys(p,['id','name']) && text(p.id) && text(p.name,70)) || !unique(trip.travellers.map(p => p.id))) return false;
    if(trip.separationRules?.some(rule=>![rule.id,rule.firstEntryId,rule.secondEntryId].every(id=>text(id))))return false;
    const items = new Set(records.libraryItems.map(item => item.id)), bags = new Set(records.containers.map(bag => bag.id)), people = new Set(trip.travellers.map(p => p.id));
    if (items.size !== records.libraryItems.length || bags.size !== records.containers.length || !unique(trip.containerIds) || trip.containerIds.length !== bags.size || !trip.containerIds.every(id => bags.has(id))) return false;
    if (!trip.entries.every(e => e && keys(e,['id','itemId','travellerId','quantity','priority','accessPriority','required','containerId','compartmentId','packingFormId']) && text(e.id) && items.has(e.itemId) && people.has(e.travellerId) && Number.isSafeInteger(e.quantity) && e.quantity >= 1 && e.quantity <= 100 && ['required','preferred','optional'].includes(e.priority) && finite(e.accessPriority) && e.accessPriority <= 10 && typeof e.required === 'boolean' && (e.containerId === undefined || bags.has(e.containerId))) || !unique(trip.entries.map(e => e.id))) return false;
    if (items.size !== new Set(trip.entries.map(e => e.itemId)).size) return false;
    const instances = new Set(trip.entries.flatMap(e => Array.from({length:e.quantity},(_,i)=>`${e.id}#${i+1}`)));
    if (instances.size > 2000 || ![trip.completedInstanceIds,trip.unavailableInstanceIds].every(ids => Array.isArray(ids) && unique(ids) && ids.every(id => instances.has(id))) || trip.completedInstanceIds.some(id => trip.unavailableInstanceIds.includes(id))) return false;
    if (trip.packingCursor !== undefined && !instances.has(trip.packingCursor)) return false;
    if (![trip.lockedPlacements,trip.rejectedPlacements ?? []].every(list => unique(list.map(p => p.instanceId)) && list.every(p => { const entry = trip.entries.find(e => e.id === p.entryId); return instances.has(p.instanceId) && p.instanceId.startsWith(p.entryId+'#') && entry?.itemId === p.itemId && bags.has(p.containerId); }))) return false;
    if (!records.libraryItems.every(item => keys(item,itemFields) && text(item.id) && text(item.name,120) && ['clothing','footwear','electronics','toiletries','medicine','documents','accessories','other'].includes(item.category) && ['rigid','slightly_deformable','foldable','rollable','compressible','freeform'].includes(item.flexibility) && typeof item.fragile === 'boolean' && typeof item.keepUpright === 'boolean' && (item.massGrams === undefined || finite(item.massGrams)) && (item.massRangeGrams === undefined || finite(item.massRangeGrams.min) && finite(item.massRangeGrams.max) && item.massRangeGrams.min <= item.massRangeGrams.max))) return false;
    if(!records.libraryItems.every(item=>evidence(item.dimensionEvidence)&&(item.massEvidence===undefined||evidence(item.massEvidence))&&date(item.createdAt)&&date(item.updatedAt)&&calibration(item.scaleCalibration)))return false;
    if(!records.containers.every(bag=>evidence(bag.insideEvidence)&&[bag.outerDimensionsEvidence,bag.tareEvidence,bag.massLimitEvidence].every(e=>e===undefined||evidence(e))&&date(bag.createdAt)&&calibration(bag.scaleCalibration)))return false;
    return records.containers.every(bag => keys(bag,bagFields) && text(bag.id) && text(bag.name,120) && ['cabin_case','checked_case','personal_item','backpack','duffel','other'].includes(bag.kind) && Array.isArray(bag.travellerIds) && unique(bag.travellerIds) && bag.travellerIds.every(id => people.has(id)) && (bag.tareGrams === undefined || finite(bag.tareGrams)) && (bag.massLimitGrams === undefined || finite(bag.massLimitGrams)));
  } catch { return false; }
}
