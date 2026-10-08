import {recordSharedPublication} from './shared-pack-combination';
import type {SharedPackBaseline} from './shared-pack-baseline';
import type {SharedCopyWitness} from './shared-packs';
import type { SeparationRule } from './types';
import type { SavedWeather } from './weather';
import { SeparationRules, SeparationNotes } from './components/SeparationRules';
import { entryHasSeparation, separationRuleError, MAX_SEPARATION_RULES } from './item-separation';
import { bagMassRecordError } from './mass-constraints';
import { ScanRetentionSettings } from './components/ScanRetentionSettings';
import { PackingEvidenceReview } from './components/PackingEvidenceReview';
import { PropertyEvidenceFields } from './components/PropertyEvidenceFields';
import { HandlingPropertyNotes, OpeningEvidenceNotes } from './components/HandlingPropertyNotes';
import { changedPropertyEvidence } from './property-evidence';
import { useRawScanRetention } from './scanning/useRawScanRetention';
import { recordRemovedScanSources,type ScanRetentionDays,type ScanRetentionReply } from './scan-retention';
import { CompartmentFields } from './components/CompartmentFields';
import { EntryBagAssignment } from './components/EntryBagAssignment';
import type {ItemEditorDraft} from './item-photo-draft';
import {DeviceWorkspace,DeviceWorkspaceSettings,useDeviceWorkspace} from './components/DeviceWorkspace';
import { openSharedPack, type SharedPackSnapshot } from './shared-packs';
import { isPackingBackup as isBackup } from './backup';
import { BagWeightNotes } from './components/BagWeightNotes';
import { adoptInterior, interiorGeometry, interiorSupportError, interiorTravelLabel } from './packing-interior';
import type { ReconstructedInterior } from './scanning/interior-cavity';
import type { PackingInterior } from './types';
import { uprightInstruction, uprightTag } from './upright';
import { StackLoadNotes } from './components/StackLoadNotes';
import { packingFormsForSelection,packingItem,canSeparatePackingCopy,separatePackingCopy,changePackingQuantity } from './packing-forms';
import { InteriorSupportReview } from './components/InteriorSupportReview';
import { UnavailableSpaceFields } from './components/UnavailableSpaceFields';
import { ContainerSpaceNotes } from './components/ContainerSpaceNotes';
import { containerSpaceError } from './container-space';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AlertTriangle, Backpack, BookOpen, Check, ChevronDown, CircleHelp,
  ClipboardList, Download, Lock, MapPin, MoreHorizontal, Package, PackageCheck, Plus,
  Ruler, ScanLine, Search, Settings, ShieldCheck, Trash2, Upload, Weight, X,
} from 'lucide-react';
import type { ItemDraft } from './components/ItemCapture';
import { calibrateLongestEdge } from './scanning/calibration';
import { assessCarrierRule, carrierReviewDate, carrierReviewTimestamp, formatComparisonNumber, isCarrierRuleStale, secureCarrierSourceUrl, type CarrierLimitCheck } from './carrier-rules';
import { useScannerCapabilities } from './scanning/useScannerCapabilities';
import { PackCanvas } from './components/PackCanvas';
import { LocalPhoto } from './components/LocalPhoto';
import { carrierRuleOverridden, carrierRuleHasUpdatedLimits,  type CarrierCatalog } from './carrier-catalog';
import type { TripSuggestion } from './trip-assistant';
import { buildPlan } from './optimizer';
import {  markPackingItemUnavailable, rejectPackingPlacement, setPackingItemComplete } from './packing-progress';
import { measurementFromInput, measurementInput } from './measurement-input';
import {workspaceStorage} from './storage';
import { createInitialData } from './seed';
import type { AppData, CarrierLimits, CarrierRule, Container, ContainerSummary, Evidence, ItemPriority, LibraryItem, OptimizationMode, PackEntry, PackingPlan, Placement, Traveller, Trip, TripActivity, UnavailableSpace, ContainerCompartment, UnitSystem } from './types';

type Page = 'workspace' | 'items' | 'bags' | 'carrier-rules' | 'settings' | 'steps' | 'sequence';
type CaptureState = { kind: 'item'; item?: LibraryItem; suggestion?: TripSuggestion; resumed?:{draft:ItemEditorDraft;photo?:Blob} } | { kind: 'bag'; bag?: Container } | { kind: 'trip'; trip?: Trip } | { kind: 'carrier-rule'; rule?: CarrierRule; draft?: CarrierRule } | null;

const ItemCapture = lazy(() => import('./components/ItemCapture').then((module) => ({ default: module.ItemCapture })));
const AccountPanel = lazy(() => import('./components/AccountPanel').then((module) => ({ default: module.AccountPanel })));
const PlanSteps = lazy(() => import('./components/PlanSteps').then((module) => ({ default: module.PlanSteps })));
const PackingSequence = lazy(() => import('./components/PackingSequence').then((module) => ({ default: module.PackingSequence })));
const SavedScanPreview = lazy(() => import('./components/SavedScanPreview').then((module) => ({ default: module.SavedScanPreview })));
const CarrierLookup = lazy(() => import('./components/CarrierLookup').then((module) => ({ default: module.CarrierLookup })));
const PlanReview = lazy(() => import('./components/PlanComparison').then((module) => ({ default: module.PlanReview })));
const WeatherLookup = lazy(() => import('./components/WeatherLookup').then((module) => ({ default: module.WeatherLookup })));
const TripListAssistant = lazy(() => import('./components/TripListAssistant').then((module) => ({ default: module.TripListAssistant })));

const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const evidence = (source: Evidence['source'], note?: string): Evidence => ({ source, confidence: 1, collectedAt: new Date().toISOString(), note });
const mmToDisplay = (value: number, unit: UnitSystem) => unit === 'metric' ? String(Math.round(value)) : String(Math.round(value / 25.4 * 10) / 10);
const displayToMm = (value: number, unit: UnitSystem) => unit === 'metric' ? value : value * 25.4;
const lengthInput = (value: number | undefined, unit: UnitSystem) => measurementInput(value, unit === 'metric' ? 1 : 25.4);
const massInput = (value: number | undefined, unit: UnitSystem) => measurementInput(value, unit === 'metric' ? 1 : 28.3495);
const gramToDisplay = (value: number, unit: UnitSystem) => unit === 'metric' ? `${Math.round(value)} g` : `${Math.round(value / 28.3495 * 10) / 10} oz`;
const dimLabel = (unit: UnitSystem) => unit === 'metric' ? 'mm' : 'in';
const instanceIds = (entry: PackEntry) => Array.from({ length: Math.max(1, entry.quantity) }, (_, index) => `${entry.id}#${index + 1}`);
const sourceLabel = (source: Evidence['source']) => ({ measured: 'Measured', known: 'Known', estimated: 'Estimated', user_confirmed: 'Confirmed', provider: 'Provider' })[source];
const evidenceLabel = (value:Evidence) => value.source === 'estimated' ? 'Estimate · unverified' : `${sourceLabel(value.source)} · ${Math.round(value.confidence*100)}%`;
const modeCopy: Record<OptimizationMode, { title: string; detail: string }> = {
  balanced: { title: 'Balanced', detail: 'Space, weight & careful placement' },
  maximum_capacity: { title: 'Maximum capacity', detail: 'Prioritize fitting more items' },
  easy_access: { title: 'Easy access', detail: 'Frequently needed items nearer the top' },
  fragile_protection: { title: 'Fragile protection', detail: 'No load on fragile items and full occupied base support' },
};

export function App() {
  return <DeviceWorkspace><PackingApp/></DeviceWorkspace>;
}
function PackingApp() {
  const device=useDeviceWorkspace();
  const {clearScanCaptures,deleteScanCapture}=device.capture;
  const {clearLocalData,deletePhoto,exportPhotos,getPhoto,importPhoto,loadAppData,prunePhotos,removeUnreferencedPhotos,saveAppData,savePhoto}=useMemo(()=>workspaceStorage(device.session),[device.session]);
  const scanCapabilities = useScannerCapabilities();
  const [data, setData] = useState<AppData>();
  const [savedData,setSavedData]=useState<AppData>();
  const [page, setPage] = useState<Page>('workspace');
  const [capture, setCapture] = useState<CaptureState>(null);
  const [selectedContainerId, setSelectedContainerId] = useState('');
  const [canvasView, setCanvasView] = useState<'3d' | 'top' | 'layers'>('top');
  const [layer, setLayer] = useState(1);
  const [search, setSearch] = useState('');
  const [editingPhotoUrl, setEditingPhotoUrl] = useState<string>();
  const [syncStatus, setSyncStatus] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [syncError, setSyncError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    loadAppData().then((loaded) => {
      if (active) { setData(loaded); setSavedData(loaded); setSyncStatus('saved'); }
    }).catch((error: unknown) => {
      if (active) { setSyncStatus('error'); setSyncError(error instanceof Error ? error.message : 'Saved data could not be opened.'); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!data || data === savedData) return;
    let active = true;
    setSyncStatus('saving');
    saveAppData(data).then(() => {
      if (active) { setSavedData(data);setSyncStatus('saved'); setSyncError(''); }
    }).catch((error: unknown) => {
      if (active) { setSyncStatus('error'); setSyncError(error instanceof Error ? error.message : 'Your changes could not be saved locally.'); }
    });
    return () => { active = false; };
  }, [data, savedData, saveAppData]);

  const activeTrip = data?.trips.find((trip) => trip.id === data.activeTripId) ?? data?.trips[0];
  const libraryItems = useMemo(() => {
    if (!data) return [];
    if (!search) return data.libraryItems;
    const normalizedSearch = search.toLowerCase();
    return data.libraryItems.filter((item) => `${item.name} ${item.category}`.toLowerCase().includes(normalizedSearch));
  }, [data?.libraryItems, search]);
  const editingPhotoId = capture?.kind === 'item' ? capture.item?.photoId : undefined;
  useEffect(() => {
    let active = true;
    let url = '';
    setEditingPhotoUrl(undefined);
    if (editingPhotoId) void getPhoto(editingPhotoId).then((photo) => {
      if (photo && active) { url = URL.createObjectURL(photo); setEditingPhotoUrl(url); }
    }).catch(() => undefined);
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [getPhoto, editingPhotoId]);

  const activeContainers = useMemo(() => data && activeTrip ? data.containers.filter((bag) => activeTrip.containerIds.includes(bag.id)) : [], [data?.containers, activeTrip?.containerIds]);
  const selectedContainer = activeContainers.find((bag) => bag.id === selectedContainerId) ?? activeContainers[0];
  // Selecting a step must not rerun the solver or recreate unchanged view geometry.
  const plan = useMemo(() => data && activeTrip ? buildPlan(activeTrip, data.libraryItems, data.containers) : undefined,
    [data?.libraryItems, data?.containers, activeTrip?.id, activeTrip?.entries, activeTrip?.containerIds, activeTrip?.mode, activeTrip?.lockedPlacements, activeTrip?.unavailableInstanceIds, activeTrip?.rejectedPlacements, activeTrip?.separationRules]);
  useEffect(() => {
    if (data?.settings.automaticPhotoDeletionDays) prunePhotos(data.settings.automaticPhotoDeletionDays).catch(() => undefined);
  }, [data?.settings.automaticPhotoDeletionDays]);

  const confirmRemovedSources=useCallback((reply:ScanRetentionReply)=>setData(current=>current?recordRemovedScanSources(current,reply):current),[]);
  const scanRetention=useRawScanRetention({data,savedData,capture:device.capture,deferred:!!capture||!!device.pendingPhoto||!!device.pendingBackup||device.fileBusy,onRemoved:confirmRemovedSources});

  const updateData = (updater: (current: AppData) => AppData) => setData((current) => current ? updater(current) : current);
  const updateTrip = (updater: (trip: Trip) => Trip) => updateData((current) => ({
    ...current, trips: current.trips.map((trip) => trip.id === current.activeTripId ? { ...updater(trip), updatedAt: new Date().toISOString() } : trip),
  }));
  const switchTrip = (id: string) => { updateData((current) => ({ ...current, activeTripId: id })); setSelectedContainerId(''); setPage('workspace'); };
  const addEntry = (item: LibraryItem) => {
    if (!activeTrip) return;
    const existing = activeTrip.entries.find((entry) => entry.itemId === item.id);
    if (existing) updateTrip((trip) => ({ ...trip, entries: trip.entries.map((entry) => entry.id === existing.id ? { ...entry, quantity: entry.quantity + 1 } : entry) }));
    else updateTrip((trip) => ({ ...trip, entries: [...trip.entries, { id: newId(), itemId: item.id, travellerId: trip.travellers[0]?.id ?? '', quantity: 1, priority: 'preferred', accessPriority: 2, required: false }] }));
    setNotice(`${item.name} added to ${activeTrip.name}.`);
    setPage('workspace');
  };
  const addSuggestedItem = (suggestion: TripSuggestion, item?: LibraryItem) => {
    if (!item) { setCapture({ kind: 'item', suggestion }); return; }
    if (!activeTrip || activeTrip.entries.some((entry) => entry.itemId === item.id)) {
      setNotice(`${item.name} is already on this packing list.`);
      return;
    }
    const entry: PackEntry = {
      id: newId(), itemId: item.id, travellerId: activeTrip.travellers[0]?.id ?? '',
      quantity: suggestion.quantity, priority: suggestion.priority,
      accessPriority: suggestion.accessPriority, required: suggestion.priority === 'required',
    };
    updateTrip((trip) => ({ ...trip, entries: [...trip.entries, entry] }));
    setNotice(`${item.name} added to ${activeTrip.name}.`);
  };
  const setMode = (mode: OptimizationMode) => updateTrip((trip) => ({ ...trip, mode }));
  const setEntryPriority = (entryId:string, priority:ItemPriority) => updateTrip((trip) => ({ ...trip, entries:trip.entries.map((entry)=>entry.id===entryId?{...entry,priority,required:priority==='required'}:entry) }));
  const setEntryAccess = (entryId:string, accessPriority:number) => updateTrip((trip) => ({ ...trip, entries:trip.entries.map((entry)=>entry.id===entryId?{...entry,accessPriority}:entry) }));
  const changeEntryQuantity = (entryId:string,quantity:number) => updateTrip(trip=>changePackingQuantity(trip,entryId,quantity));
  const splitPackingCopy = (entryId:string) => {
    if(activeTrip && (separationRuleError(activeTrip) || (activeTrip.separationRules?.length??0)+(activeTrip.separationRules?.filter(rule=>rule.firstEntryId===entryId||rule.secondEntryId===entryId).length??0)>MAX_SEPARATION_RULES)){setNotice('Correct or simplify separation rules before splitting another copy. Existing copies and rules remain unchanged.');return;}
    updateTrip(trip=>separatePackingCopy(trip,entryId,newId()));
  };
  const setEntryBagAssignment = (entryId:string,containerId:string,compartmentId?:string) => updateTrip(trip=>({...trip,entries:trip.entries.map(entry=>entry.id===entryId?{...entry,containerId:containerId||undefined,compartmentId}:entry)}));
  const setEntryPackingForm = (entryId:string,packingFormId:string) => updateTrip(trip=>({...trip,entries:trip.entries.map(entry=>entry.id===entryId?{...entry,packingFormId:packingFormId||undefined}:entry)}));
  const setEntryTraveller = (entryId:string, travellerId:string) => updateTrip((trip) => ({ ...trip, entries:trip.entries.map((entry)=>entry.id===entryId?{...entry,travellerId}:entry) }));

  const resumeItemPhoto=async()=>{
    try{const resumed=await device.resumeItemPhoto();device.checkActive();const initial=resumed.draft.initial;
      if(initial&&!data?.libraryItems.some(item=>item.id===initial.id&&JSON.stringify(item)===JSON.stringify(initial)))throw new Error('The saved item changed or was removed after this photo draft began. It was not overwritten. Discard this draft and edit the current item.');
      if(resumed.draft.suggestion&&resumed.draft.sourceTripId!==data?.activeTripId)throw new Error('Return to the pack that started this suggested item before resuming its photo draft.');
      setCapture({kind:'item',item:initial,suggestion:resumed.draft.suggestion,resumed});
    }catch(error){setNotice(error instanceof Error?error.message:'The photo draft could not be resumed.');}
  };
  const closeItemEditor=async()=>{if(capture?.kind==='item'&&capture.resumed){try{await device.discardItemPhoto();}catch{setNotice('The editor closed, but its encrypted photo draft could not be discarded. Use its discard control before selecting another photo.');}}setCapture(null);};
  const saveItem = async (draft: ItemDraft, photo?: Blob) => {
    if (!data || capture?.kind !== 'item') return;
    device.checkActive();const existing=capture.item;
    if(existing&&!data.libraryItems.some(item=>item.id===existing.id&&JSON.stringify(item)===JSON.stringify(existing)))throw new Error('This saved item changed. Close the draft and reopen the current record.');
    const id=existing?.id??newId(),previousPhoto=existing?.photoId;
    let photoId=draft.photoId,stagedPhoto:string|undefined;
    try{
      if(photo){stagedPhoto=newId();photoId=stagedPhoto;await savePhoto(photoId,photo);}
      device.checkActive();const item:LibraryItem={...draft,...(photoId?{photoId}:{}),id,createdAt:existing?.createdAt??new Date().toISOString(),updatedAt:new Date().toISOString()};
      const suggestion=!existing?capture.suggestion:undefined;
      const suggestedEntry:PackEntry|undefined=suggestion&&activeTrip?{id:newId(),itemId:id,travellerId:activeTrip.travellers[0]?.id??'',quantity:suggestion.quantity,priority:suggestion.priority,accessPriority:suggestion.accessPriority,required:suggestion.priority==='required'}:undefined;
      const next:AppData={...data,libraryItems:existing?data.libraryItems.map(record=>record.id===id?item:record):[item,...data.libraryItems],trips:suggestedEntry?data.trips.map(trip=>trip.id===data.activeTripId?{...trip,entries:[...trip.entries,suggestedEntry],updatedAt:new Date().toISOString()}:trip):data.trips};
      await saveAppData(next);stagedPhoto=undefined;setData(next);
      let cleanupFailed=false;
      if(previousPhoto&&previousPhoto!==photoId)try{await deletePhoto(previousPhoto);}catch{cleanupFailed=true;}
      if(existing?.scan&&existing.scan.id!==item.scan?.id)try{await deleteScanCapture(existing.scan.id);}catch{cleanupFailed=true;}
      if(capture.resumed)try{await device.discardItemPhoto(true);}catch{cleanupFailed=true;}
      setCapture(null);if(cleanupFailed)setNotice('The item was saved, but previous photos, source captures or its encrypted draft could not all be removed. Review the pending draft and local cleanup controls.');else if(suggestedEntry)setNotice(`${item.name} was saved and added to the trip checklist.`);
    }catch(error){if(stagedPhoto)await deletePhoto(stagedPhoto).catch(()=>undefined);throw error;}
  };
  const saveBag = async (draft: Omit<Container, 'id' | 'createdAt'>, draftSourceIds: string[]) => {
    if (!data || capture?.kind !== 'bag' || !activeTrip) throw new Error('Reopen the bag in its original pack before saving.');
    device.checkActive();
    const existing = capture.bag;
    if (existing && !data.containers.some(record => record.id === existing.id && JSON.stringify(record) === JSON.stringify(existing))) throw new Error('This saved bag changed. Close the draft and reopen the current record.');
    const bag: Container = { ...draft, id: existing?.id ?? newId(), createdAt: existing?.createdAt ?? new Date().toISOString() };
    const now = new Date().toISOString();
    const next: AppData = { ...data,
      containers: existing ? data.containers.map(record => record.id === existing.id ? bag : record) : [...data.containers, bag],
      trips: data.trips.map(trip => trip.id === activeTrip.id && !trip.containerIds.includes(bag.id) ? { ...trip, containerIds: [...trip.containerIds, bag.id], updatedAt: now } : trip),
    };
    await saveAppData(next);
    device.checkActive();
    setData(next); setSavedData(next); setSyncStatus('saved'); setSyncError('');
    const obsoleteSources = new Set(draftSourceIds);
    if (existing?.scan && existing.scan.id !== bag.scan?.id) obsoleteSources.add(existing.scan.id);
    if (bag.scan) obsoleteSources.delete(bag.scan.id);
    let cleanupFailed = false;
    for (const id of obsoleteSources) try { await deleteScanCapture(id); } catch { cleanupFailed = true; }
    setSelectedContainerId(bag.id); setCapture(null);
    if (cleanupFailed) setNotice('The bag was saved, but previous source captures could not all be removed from this workspace. Original-source cleanup remains incomplete.');
  };
  const saveCarrierRule = (draft: Omit<CarrierRule, 'id'>) => {
    if (!activeTrip || capture?.kind !== 'carrier-rule') return;
    const existing = capture.rule;
    const rule: CarrierRule = { ...draft, id: existing?.id ?? newId() };
    updateTrip((trip) => ({ ...trip, carrierRules: existing ? trip.carrierRules.map((current) => current.id === existing.id ? rule : current) : [...trip.carrierRules, rule] }));
    setCapture(null);
    setNotice(`${rule.carrier} source record updated for ${activeTrip.name}.`);
  };
  const createTrip = (name: string, destination: string, startDate: string, endDate: string, packingOnly: boolean, travellerNames: string[], activities: TripActivity[], laundryAvailable: boolean, existingId?: string) => {
    if (existingId) {
      updateData((current) => {
        const oldTrip = current.trips.find((trip) => trip.id === existingId);
        if (!oldTrip) return current;
        const travellers = travellerNames.map((travellerName, index) => ({ id: oldTrip.travellers[index]?.id ?? newId(), name: travellerName.trim() || (index === 0 ? 'You' : `Traveller ${index + 1}`) }));
        const retainedIds = new Set(travellers.map((traveller) => traveller.id));
        const fallbackTravellerId = travellers[0]?.id ?? '';
        return {
          ...current,
          trips: current.trips.map((trip) => trip.id === existingId ? {
            ...trip, name, destination, startDate: startDate || undefined, endDate: endDate || undefined, packingOnly, sample: false,
            activities: packingOnly ? [] : activities, laundryAvailable: packingOnly ? undefined : laundryAvailable,
            travellers,
            entries: trip.entries.map((entry) => retainedIds.has(entry.travellerId) ? entry : { ...entry, travellerId: fallbackTravellerId }),
            updatedAt: new Date().toISOString(),
          } : trip),
          containers: current.containers.map((bag) => {
            if (!oldTrip.containerIds.includes(bag.id)) return bag;
            const previouslyAllAssigned = oldTrip.travellers.every((person) => bag.travellerIds.includes(person.id));
            const nextIds = bag.travellerIds.filter((id) => retainedIds.has(id));
            if (previouslyAllAssigned) travellers.forEach((person) => { if (!nextIds.includes(person.id)) nextIds.push(person.id); });
            return { ...bag, travellerIds: nextIds };
          }),
        };
      });
      setCapture(null);
      return;
    }
    if (!data) return;
    const travellers = travellerNames.map((travellerName, index) => ({ id: newId(), name: travellerName.trim() || (index === 0 ? 'You' : `Traveller ${index + 1}`) }));
    const trip: Trip = { id: newId(), name, destination, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}), packingOnly, ...(!packingOnly ? { activities, laundryAvailable } : {}), sample: false, travellers, containerIds: [], entries: [], mode: 'balanced', completedInstanceIds: [], unavailableInstanceIds: [], lockedPlacements: [], carrierRules: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    setData((current) => current ? { ...current, trips: [trip, ...current.trips], activeTripId: trip.id } : current);
    setSelectedContainerId(''); setPage('workspace'); setCapture(null);
  };

  const toggleComplete = (instanceId: string, complete: boolean) => updateTrip((trip) =>
    setPackingItemComplete(trip, instanceId, complete, plan?.placements.find((item) => item.instanceId === instanceId)));
  const toggleLock = (placement: Placement) => updateTrip((trip) => {
    if (trip.completedInstanceIds.includes(placement.instanceId)) return trip;
    const isLocked = trip.lockedPlacements.some((item) => item.instanceId === placement.instanceId);
    return { ...trip, lockedPlacements: isLocked ? trip.lockedPlacements.filter((item) => item.instanceId !== placement.instanceId) : [...trip.lockedPlacements, { ...placement, locked: true }] };
  });
  const setUnavailable = (instanceId: string) => updateTrip((trip) => {
    const isUnavailable = trip.unavailableInstanceIds.includes(instanceId);
    return {
      ...trip,
      unavailableInstanceIds: isUnavailable ? trip.unavailableInstanceIds.filter((id) => id !== instanceId) : [...trip.unavailableInstanceIds, instanceId],
      completedInstanceIds: trip.completedInstanceIds.filter((id) => id !== instanceId),
      lockedPlacements: trip.lockedPlacements.filter((placement) => placement.instanceId !== instanceId),
    };
  });
  const rejectPlacement = (placement: Placement) => updateTrip((trip) => rejectPackingPlacement(trip, placement));
  const lockPlacement = (placement: Placement) => updateTrip((trip) => trip.lockedPlacements.some((saved) => saved.instanceId === placement.instanceId)
    ? trip : { ...trip, lockedPlacements: [...trip.lockedPlacements, { ...placement, locked: true }] });
  const removeEntry = (entryId: string) => {
    if(activeTrip && entryHasSeparation(activeTrip,entryId)){setNotice('Edit or remove the linked separation rule before removing this checklist entry.');return;}
    updateTrip((trip) => {
    const entry = trip.entries.find((item) => item.id === entryId);
    const instances = entry ? new Set(instanceIds(entry)) : new Set<string>();
    return { ...trip, entries: trip.entries.filter((item) => item.id !== entryId), completedInstanceIds: trip.completedInstanceIds.filter((id) => !instances.has(id)), unavailableInstanceIds: trip.unavailableInstanceIds.filter((id) => !instances.has(id)), lockedPlacements: trip.lockedPlacements.filter((placement) => !instances.has(placement.instanceId)), rejectedPlacements: trip.rejectedPlacements?.filter((placement) => !instances.has(placement.instanceId)) };
  });
  };

  const deleteLibraryItem = async (item: LibraryItem) => {
    if(data?.trips.some(trip=>trip.entries.some(entry=>entry.itemId===item.id && entryHasSeparation(trip,entry.id)))){setNotice('Edit or remove the linked separation rules before removing this item from the library.');return;}
    const linked = data?.trips.some((trip) => trip.entries.some((entry) => entry.itemId === item.id));
    if (linked && !window.confirm(`Remove ${item.name} from every packing list and delete it from your library?`)) return;
    if (!window.confirm(`Delete ${item.name} from your item library? This cannot be undone.`)) return;
    if (item.photoId) await deletePhoto(item.photoId);
    if (item.scan) await deleteScanCapture(item.scan.id).catch(() => setNotice('The item record was removed, but its 3D source capture could not be removed from this device.'));
    updateData((current) => ({ ...current, libraryItems: current.libraryItems.filter((record) => record.id !== item.id), trips: current.trips.map((trip) => ({ ...trip, entries: trip.entries.filter((entry) => entry.itemId !== item.id), lockedPlacements: trip.lockedPlacements.filter((placement) => placement.itemId !== item.id) })) }));
  };
  const removeBag = (bag: Container) => {
    if (!activeTrip || !window.confirm(`Remove ${bag.name} from this pack? Its dimensions will remain in other packs that use it.`)) return;
    updateData((current) => ({ ...current, trips: current.trips.map((trip) => trip.id === activeTrip.id ? { ...trip, containerIds: trip.containerIds.filter((id) => id !== bag.id), carrierRules: trip.carrierRules.map((rule) => ({ ...rule, applicableBagIds: rule.applicableBagIds.filter((id) => id !== bag.id) })) } : trip) }));
    setSelectedContainerId('');
  };

  const deleteCarrierRule = (rule: CarrierRule) => {
    if (!activeTrip || !window.confirm(`Remove the ${rule.carrier} source record from ${activeTrip.name}?`)) return;
    updateTrip((trip) => ({ ...trip, carrierRules: trip.carrierRules.filter((current) => current.id !== rule.id) }));
    setNotice(`${rule.carrier} source record removed from this pack.`);
  };

  const deleteTrip = async (tripId: string) => {
    const target = data?.trips.find((trip) => trip.id === tripId);
    if (!data || !target || !window.confirm(`Delete ${target.name} and its packing list from this device? Reusable items and bags used by other packs will remain.`)) return;
    const remainingTrips = data.trips.filter((trip) => trip.id !== tripId);
    const stillUsedBagIds = new Set(remainingTrips.flatMap((trip) => trip.containerIds));
    const orphanedBagIds = new Set(target.containerIds.filter((id) => !stillUsedBagIds.has(id)));
    let scanCleanupFailed = false;
    for (const bag of data.containers.filter((container) => orphanedBagIds.has(container.id) && container.scan)) {
      try { await deleteScanCapture(bag.scan!.id); } catch { scanCleanupFailed = true; }
    }
    updateData((current) => ({
      ...current,
      trips: current.trips.filter((trip) => trip.id !== tripId),
      containers: current.containers.filter((bag) => !orphanedBagIds.has(bag.id)),
      activeTripId: current.activeTripId === tripId ? remainingTrips[0]?.id ?? '' : current.activeTripId,
    }));
    setCapture(null);
    setSelectedContainerId('');
    setPage('workspace');
    setNotice(scanCleanupFailed ? `${target.name} was deleted, but a bag’s native scan files could not be removed.` : `${target.name} was deleted from this device. Its reusable items remain in your library.`);
  };

  const exportBackup = async () => {
    if (!data) return;
    try {
      const backup = { format: 'packing-scanning-backup', schemaVersion: data.schemaVersion, exportedAt: new Date().toISOString(), app: data, photos: await exportPhotos() };
      const text=JSON.stringify(backup,null,2);
      device.checkActive();
      if(device.native){await device.saveBackup(text);return;}
      const blob=new Blob([text],{type:'application/json'});
      if(blob.size>80*1024*1024)throw new Error('This backup is over 80 MB. Remove unneeded photos before exporting.');
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`packing-scanning-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice('Backup downloaded. Keep it somewhere private; it may include your item photos.');
    }catch(error){setNotice(error instanceof Error?error.message:'The backup could not be prepared.');}
  };
  const importBackup = async (file?: File): Promise<boolean> => {
    if (!file || !data) return false;
    if (file.size > 80 * 1024 * 1024) { setNotice('This backup is over 80 MB. Choose a smaller backup file.'); return false; }
    const stagedPhotoIds: string[] = [];
    let committed = false;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      if (!isBackup(parsed)) throw new Error('This file is not a supported Packing Scanning backup.');
      device.checkActive();
      if (!window.confirm(device.session ? 'Replace the packing records and photos in this protected workspace with this backup? Existing original scan files in this workspace will also be removed because JSON backups do not include them. Guest packs and other workspaces remain.' : 'Import this backup and replace the guest packing data saved on this device? JSON backups do not contain native 3D files, so existing saved guest scans on this device will also be removed. Protected workspaces remain.')) return false;
      const photoIds = new Map<string,string>();
      for (const photo of parsed.photos) {
        device.checkActive();
        const stagedId = `restore-${newId()}`;
        await importPhoto(stagedId, photo.dataUrl, photo.createdAt);
        stagedPhotoIds.push(stagedId);
        photoIds.set(photo.id, stagedId);
      }
      const restoredItems = parsed.app.libraryItems.map((item) => {
        const withoutScan = { ...item };
        delete withoutScan.scan;
        if (!withoutScan.photoId) return withoutScan;
        const photoId = photoIds.get(withoutScan.photoId);
        if (!photoId) { delete withoutScan.photoId; return withoutScan; }
        return { ...withoutScan, photoId };
      });
      const restored: AppData = {
        ...parsed.app,
        containers: parsed.app.containers.map((bag) => { const restoredBag = { ...bag }; delete restoredBag.scan; return restoredBag; }),
        libraryItems: restoredItems,
      };
      device.checkActive();
      await saveAppData(restored);
      committed = true;
      setData(restored);
      const referencedPhotoIds = new Set(restored.libraryItems.flatMap((item) => item.photoId ? [item.photoId] : []));
      await removeUnreferencedPhotos(referencedPhotoIds);
      let scanCleanupFailed = false;
      try { await clearScanCaptures(); } catch { scanCleanupFailed = true; }
      setNotice(scanCleanupFailed ? 'Backup restored, but some previous native scan files could not be removed.' : 'Backup restored on this device. Native scans were not included in the backup.');
      return true;
    } catch (error) {
      if (!committed) await Promise.all(stagedPhotoIds.map((id) => deletePhoto(id).catch(() => undefined)));
      setNotice(error instanceof Error ? error.message : 'The backup could not be imported.');
      return committed;
    }
  };
  const deleteAllData = async () => {
    if (!window.confirm(device.session ? 'Delete all packing records and photos in this protected workspace? Guest packs, other workspaces and server records remain. This cannot be undone.' : 'Delete all guest trips, bags, items, photos, and native 3D scan files from this device? Protected workspaces remain. This cannot be undone.')) return;
    let scanCleanupFailed = false;
    try { await clearScanCaptures(); } catch { scanCleanupFailed = true; }
    await clearLocalData();
    const empty = createInitialData(); empty.trips = []; empty.containers = []; empty.libraryItems = []; empty.activeTripId = '';
    await saveAppData(empty);
    setData(empty); setEditingPhotoUrl(undefined); setNotice(scanCleanupFailed ? 'Packing data was deleted, but some native scan files could not be removed from this device.' : 'All local packing data and saved scans have been deleted.'); setPage('workspace');
  };

  if (!data) return <div className="boot-screen"><div className="brand-mark">P</div><p>{syncStatus === 'error' ? syncError : 'Opening your local packing space…'}</p>{syncStatus === 'error' && <button className="button button-secondary" onClick={() => { setSyncStatus('loading'); loadAppData().then((loaded) => { setData(loaded); setSavedData(loaded); setSyncStatus('saved'); }).catch((error: unknown) => setSyncError(error instanceof Error ? error.message : 'Could not load saved data.')); }}>Try again</button>}</div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand-lockup" onClick={() => setPage('workspace')}><span className="brand-mark" aria-hidden="true">P</span><span className="brand-words"><strong>packing</strong><small>scanning</small></span></button>
      <div className="trip-switcher-wrap"><span className="sidebar-label">YOUR PACKS</span><div className="trip-switcher"><Package size={16}/><select id="active-pack" name="activePackId" aria-label="Choose pack" value={activeTrip?.id ?? ''} onChange={(event) => switchTrip(event.target.value)}>{data.trips.map((trip) => <option value={trip.id} key={trip.id}>{trip.name}{trip.sample ? ' · example' : ''}</option>)}</select><ChevronDown size={14}/></div><button className="new-pack-link" onClick={() => setCapture({ kind: 'trip' })}><Plus size={15}/> New pack</button></div>
      <nav className="primary-nav" aria-label="Main navigation">
        <button className={page === 'workspace' || page === 'steps' ? 'selected' : ''} onClick={() => setPage('workspace')}><ClipboardList size={18}/> Packing plan</button>
        <button className={page === 'items' ? 'selected' : ''} onClick={() => { setSearch(''); setPage('items'); }}><Package size={18}/> My items <span className="nav-count">{data.libraryItems.length}</span></button>
        <button className={page === 'bags' ? 'selected' : ''} onClick={() => setPage('bags')}><Backpack size={18}/> My bags <span className="nav-count">{activeContainers.length}</span></button>
        <button className={page === 'carrier-rules' ? 'selected' : ''} onClick={() => setPage('carrier-rules')}><BookOpen size={18}/> Carrier rules <span className="nav-count">{activeTrip?.carrierRules.length ?? 0}</span></button>
      </nav>
      <div className="sidebar-bottom"><button className={page === 'settings' ? 'selected' : ''} onClick={() => setPage('settings')}><Settings size={18}/> Settings</button><div className="local-status"><span className={syncStatus === 'error' ? 'status-dot error' : 'status-dot'}/><span>{syncStatus === 'saving' ? 'Saving on this device…' : syncStatus === 'error' ? 'Save issue' : 'Saved on this device'}</span></div><p>Your packs stay on this device. Account backups are optional; nothing uploads automatically.</p></div>
    </aside>

    <div className="main-column">
      <header className="topbar"><div className="mobile-brand"><span className="brand-mark">P</span><strong>packing scanning</strong></div><div className="topbar-left">{activeTrip && <><MapPin size={15}/><span>{activeTrip.destination || 'Packing session'}</span>{activeTrip.sample && <span className="sample-tag">EXAMPLE</span>}</>}</div><div className="topbar-right"><span className="offline-badge"><span/> Works offline</span>{device.session && <button className="button button-secondary device-lock-button" onClick={device.lock}>Lock workspace</button>}<button className="icon-button help-button" title="About packing estimates" onClick={() => setNotice('Photos and scan files stay on this device. Supported iPhones and iPads can suggest unverified dimensions from guided capture; scans do not measure weight. Carrier source records are manual and do not check your booking or constrain the packing plan.') }><CircleHelp size={18}/></button></div></header>
      {syncStatus === 'error' && <div className="inline-error"><AlertTriangle size={16}/>{syncError}</div>}
      {data.trips.length>0&&<div className="mobile-pack-switcher"><label><span>Pack</span><select aria-label="Choose pack on mobile" disabled={!!capture||device.fileBusy} value={activeTrip?.id??''} onChange={event=>switchTrip(event.target.value)}>{data.trips.map(trip=><option key={trip.id} value={trip.id}>{trip.name}{trip.sample?' · example':''}</option>)}</select></label></div>}
      {device.pendingPhoto&&<div className="pending-photo-banner" role="region" aria-label="Pending item photo"><p>{device.photoMatches?'An encrypted item photo draft is waiting. Resume it to review; nothing enters your item library until you save.':'An encrypted photo draft belongs to a different workspace. Open that workspace to resume it.'}</p><div>{device.photoMatches&&<button className="button button-primary" disabled={device.fileBusy||!!capture} onClick={()=>void resumeItemPhoto()}>Resume item photo draft</button>}<button className="button button-secondary" disabled={device.fileBusy||!!capture} onClick={()=>void device.discardItemPhoto().catch(error=>setNotice(error instanceof Error?error.message:'Discard failed.'))}>Discard item photo draft</button></div>{device.photoNotice&&<p role="status">{device.photoNotice}</p>}</div>}
      {notice && <div className="notice-banner" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {!activeTrip && page !== 'settings' ? <EmptyState onNew={() => setCapture({ kind: 'trip' })} onSettings={() => setPage('settings')}/> : <>
        {page === 'workspace' && activeTrip && plan && <Workspace
          trip={activeTrip} data={data} containers={activeContainers} selectedContainer={selectedContainer} plan={plan} canvasView={canvasView} layer={layer} getPhoto={getPhoto} unit={data.unitSystem}
          onSeparationRules={rules=>updateTrip(trip=>({...trip,separationRules:rules}))}
          onWeather={weather=>updateTrip(trip=>({...trip,weather}))}
          onPrintSequence={() => setPage('sequence')}
          onReviewItem={item=>setCapture({kind:'item',item})} onReviewBag={bag=>setCapture({kind:'bag',bag})} onReviewMissing={()=>setPage('settings')}
          onView={setCanvasView} onLayer={setLayer} onSelectContainer={setSelectedContainerId} onMode={setMode} onAddItem={() => { setSearch(''); setPage('items'); }} onAddSuggestion={addSuggestedItem} onAddBag={() => setCapture({ kind: 'bag' })} onAddTrip={() => setCapture({ kind: 'trip' })} onRemoveEntry={removeEntry} onToggleComplete={toggleComplete} onToggleLock={toggleLock} onUnavailable={setUnavailable} onStartSteps={() => setPage('steps')} onEditTrip={() => setCapture({ kind: 'trip', trip: activeTrip })} onPriority={setEntryPriority} onAccess={setEntryAccess} onTraveller={setEntryTraveller} onAssignment={setEntryBagAssignment} onPackingForm={setEntryPackingForm} onSeparateCopy={splitPackingCopy} onQuantity={changeEntryQuantity}/>}
        {page === 'steps' && activeTrip && plan && <Suspense fallback={<div className="secondary-page" role="status">Opening packing steps…</div>}><PlanSteps getPhoto={getPhoto} key={activeTrip.id} trip={activeTrip} plan={plan} containers={activeContainers} items={data.libraryItems} onExit={() => setPage('workspace')} onComplete={toggleComplete} onUnavailable={(id) => updateTrip((trip) => markPackingItemUnavailable(trip, id))} onLock={lockPlacement} onDoesNotFit={rejectPlacement} onResetFailed={() => updateTrip((trip) => ({ ...trip, rejectedPlacements: [] }))} onSelectStep={(id) => updateTrip((trip) => ({ ...trip, packingCursor: id }))} onPrintSequence={() => setPage('sequence')}/></Suspense>}
        {page === 'sequence' && activeTrip && plan && <Suspense fallback={<div className="secondary-page" role="status">Opening packing sequence…</div>}><PackingSequence trip={activeTrip} plan={plan} containers={activeContainers} items={data.libraryItems} getPhoto={getPhoto} onExit={() => setPage('steps')}/></Suspense>}
        {page === 'items' && <LibraryPage items={libraryItems} data={data} activeTrip={activeTrip} search={search} setSearch={setSearch} getPhoto={getPhoto} unit={data.unitSystem} onAdd={() => setCapture({ kind: 'item' })} onEdit={(item) => setCapture({ kind: 'item', item })} onDelete={deleteLibraryItem} onAddEntry={addEntry}/>}
        {page === 'bags' && <BagsPage trip={activeTrip} bags={activeContainers} unit={data.unitSystem} onAdd={() => setCapture({ kind: 'bag' })} onEdit={(bag) => setCapture({ kind: 'bag', bag })} onRemove={removeBag}/>}
        {page === 'carrier-rules' && activeTrip && plan && <CarrierRulesPage trip={activeTrip} bags={activeContainers} summaries={plan.summaries} placements={plan.placements} items={data.libraryItems} unit={data.unitSystem} catalog={data.carrierCatalog} onCatalog={(carrierCatalog) => updateData((current) => ({ ...current, carrierCatalog }))} onReview={(draft) => setCapture({ kind: 'carrier-rule', draft })} onAdd={() => setCapture({ kind: 'carrier-rule' })} onEdit={(rule) => setCapture({ kind: 'carrier-rule', rule })} onDelete={deleteCarrierRule}/>}
        {page === 'settings' && <SettingsPage data={data} syncStatus={syncStatus} unit={data.unitSystem} onUnit={(unitSystem) => updateData((current) => ({ ...current, unitSystem }))} scanRetention={scanRetention} onScanRetention={(days)=>updateData(current=>({...current,settings:{...current.settings,automaticScanDeletionDays:days}}))} onPhotoRetention={(days) => updateData((current) => ({ ...current, settings: { ...current.settings, automaticPhotoDeletionDays: days } }))} onExport={exportBackup} onImport={importBackup} onDelete={deleteAllData} onOpenShared={(snapshot,baseline,witness) => updateData(current => openSharedPack(current,snapshot,newId(),baseline,witness))} onPublished={(tripId,snapshot,baseline) => updateData(current => recordSharedPublication(current,tripId,snapshot,baseline))}/>}
      </>}
    </div>

    <nav className="mobile-nav" aria-label="Mobile navigation"><button className={page === 'workspace' || page === 'steps' ? 'selected' : ''} onClick={() => setPage('workspace')}><ClipboardList size={19}/><span>Plan</span></button><button className={page === 'items' ? 'selected' : ''} onClick={() => setPage('items')}><Package size={19}/><span>Items</span></button><button className={page === 'bags' ? 'selected' : ''} onClick={() => setPage('bags')}><Backpack size={19}/><span>Bags</span></button><button className={page === 'carrier-rules' ? 'selected' : ''} onClick={() => setPage('carrier-rules')}><BookOpen size={19}/><span>Rules</span></button><button className={page === 'settings' ? 'selected' : ''} onClick={() => setPage('settings')}><Settings size={19}/><span>Settings</span></button></nav>

    {capture?.kind === 'item' && <Suspense fallback={<div className="modal-backdrop"><div className="modal" role="status">Opening item editor…</div></div>}><ItemCapture key={capture.item?.id ?? capture.suggestion?.id ?? 'new-item'} initial={capture.item} suggestedItem={capture.suggestion} unit={capture.resumed?.draft.unit??data.unitSystem} resumed={capture.resumed?.draft} resumedPhoto={capture.resumed?.photo} sourceTripId={activeTrip?.id} suggestion={capture.suggestion} scanSupported={scanCapabilities.supported} recognitionSupported={scanCapabilities.supported&&scanCapabilities.platform==='android'&&scanCapabilities.recognitionSupported===true} scanUnavailableReason={scanCapabilities.reason} existingPhotoUrl={editingPhotoUrl} onClose={()=>void closeItemEditor()} onPhotoStaged={()=>setCapture(null)} onSave={saveItem}/></Suspense>}
    {capture?.kind === 'bag' && <BagCapture key={capture.bag?.id ?? 'new-bag'} initial={capture.bag} unit={data.unitSystem} travellers={activeTrip?.travellers ?? []} scanSupported={scanCapabilities.supported} scanUnavailableReason={scanCapabilities.reason} onClose={() => setCapture(null)} onSave={saveBag}/>}
    {capture?.kind === 'trip' && <TripCapture initial={capture.trip} onClose={() => setCapture(null)} onSave={createTrip} onDelete={capture.trip && !capture.trip.sample ? () => void deleteTrip(capture.trip!.id) : undefined}/>}
    {capture?.kind === 'carrier-rule' && activeTrip && <CarrierRuleCapture key={capture.rule?.id ?? capture.draft?.fare ?? 'new-carrier-rule'} initial={capture.rule ?? capture.draft} bags={activeContainers} unit={data.unitSystem} onClose={() => setCapture(null)} onSave={saveCarrierRule}/>}
  </div>;
}

interface WorkspaceProps {
  onWeather:(weather:SavedWeather|undefined)=>void;
  onSeparationRules:(rules:SeparationRule[])=>void;
  onReviewItem:(item:LibraryItem)=>void; onReviewBag:(bag:Container)=>void; onReviewMissing:()=>void;
  onPrintSequence: () => void;
  trip: Trip; data: AppData; containers: Container[]; selectedContainer?: Container; plan: PackingPlan; canvasView: '3d'|'top'|'layers'; layer: number; getPhoto:(id:string)=>Promise<Blob|undefined>; unit: UnitSystem;
  onView: (view:'3d'|'top'|'layers') => void; onLayer: (layer:number) => void; onSelectContainer:(id:string)=>void; onMode:(mode:OptimizationMode)=>void; onAddItem:()=>void; onAddSuggestion:(suggestion:TripSuggestion,item?:LibraryItem)=>void; onAddBag:()=>void; onAddTrip:()=>void; onRemoveEntry:(id:string)=>void; onToggleComplete:(id:string,complete:boolean)=>void; onToggleLock:(placement:Placement)=>void; onUnavailable:(id:string)=>void; onStartSteps:()=>void; onEditTrip:()=>void; onPriority:(entryId:string,priority:ItemPriority)=>void; onAccess:(entryId:string,priority:number)=>void; onTraveller:(entryId:string,travellerId:string)=>void; onAssignment:(entryId:string,containerId:string,compartmentId?:string)=>void; onPackingForm:(entryId:string,packingFormId:string)=>void; onSeparateCopy:(entryId:string)=>void; onQuantity:(entryId:string,quantity:number)=>void;
}

function Workspace(props: WorkspaceProps) {
  const { trip, data, containers, selectedContainer, plan, canvasView, layer, getPhoto, unit } = props;
  const planReviewRef = useRef<HTMLElement>(null);
  const [planReviewRequested, setPlanReviewRequested] = useState(false);
  const itemById = useMemo(() => new Map(data.libraryItems.map((item) => [item.id, item])), [data.libraryItems]);
  const validEntries = useMemo(() => trip.entries.filter((entry) => itemById.has(entry.itemId)), [trip.entries, itemById]);
  const completed = useMemo(() => new Set(trip.completedInstanceIds), [trip.completedInstanceIds]);
  const placedIds = useMemo(() => new Set(plan.placements.map((placement) => placement.instanceId)), [plan.placements]);
  const allInstances = useMemo(() => validEntries.flatMap((entry) => instanceIds(entry)), [validEntries]);
  const stepsRemaining = plan.placements.filter((placement) => !completed.has(placement.instanceId)).length;
  const selectedSummary = plan.summaries.find((summary) => summary.containerId === selectedContainer?.id);
  const boxVolume = selectedSummary?.volumeCapacityMm3??0;
  const volumePercent = boxVolume && selectedSummary ? Math.min(100, selectedSummary.volumeUsedMm3 / boxVolume * 100) : 0;
  const itemFor = (entry: PackEntry) => {const item=itemById.get(entry.itemId)!;try{return packingItem(item,entry.packingFormId);}catch{return item;}};

  useEffect(() => {
    const section = planReviewRef.current;
    if (!section || planReviewRequested) return;
    if (typeof IntersectionObserver === 'undefined') {
      setPlanReviewRequested(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setPlanReviewRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: '700px 0px' });
    observer.observe(section);
    return () => observer.disconnect();
  }, [planReviewRequested]);

  return <main className="workspace-page">
    <div className="page-heading"><div><p className="eyebrow">PACKING PLAN</p><div className="title-line"><h1>{trip.name}</h1><button className="icon-button title-edit" title="Edit pack details" onClick={props.onEditTrip}><MoreHorizontal size={20}/></button></div><p className="page-subtitle">{trip.destination || 'Packing-only session'}{trip.startDate ? ` · ${new Date(`${trip.startDate}T00:00:00`).toLocaleDateString(undefined, { month:'short',day:'numeric' })}` : ''}{trip.endDate ? ` – ${new Date(`${trip.endDate}T00:00:00`).toLocaleDateString(undefined, { month:'short',day:'numeric' })}` : ''}<span className="dot-separator">·</span>{trip.travellers.length} {trip.travellers.length === 1 ? 'traveller' : 'travellers'}</p></div><button className="button button-secondary desktop-new-pack" onClick={props.onAddTrip}><Plus size={16}/> New pack</button></div>
    {trip.sample && <div className="sample-notice"><BookOpen size={16}/><span><strong>Example pack.</strong> These sample dimensions and weights are illustrative. Replace them with your own before you rely on a plan.</span></div>}
    {(!trip.packingOnly||trip.weather)&&<Suspense fallback={<p role="status">Opening weather tools…</p>}><WeatherLookup key={`${trip.id}:${trip.destination}:${trip.packingOnly}`} trip={trip} unit={unit} onSave={props.onWeather}/></Suspense>}
    {!trip.packingOnly && <Suspense fallback={<p role="status">Opening trip suggestions…</p>}><TripListAssistant trip={trip} library={data.libraryItems} onAdd={props.onAddSuggestion}/></Suspense>}
    <div className="plan-toolbar"><div className="mode-switch" aria-label="Packing approach">{(['balanced','maximum_capacity','easy_access','fragile_protection'] as OptimizationMode[]).map((mode) => <button key={mode} className={trip.mode === mode ? 'active' : ''} onClick={() => props.onMode(mode)} title={modeCopy[mode].detail}>{modeCopy[mode].title}</button>)}</div><button className="button button-primary start-pack-button" disabled={!plan.placements.length} onClick={props.onStartSteps}><PackageCheck size={17}/> Pack step by step <span>{stepsRemaining}</span></button></div>
    <div className="mode-explainer">{modeCopy[trip.mode].detail} <span>·</span> Pack plans use each item’s selected recorded form and dimensions.</div>
    <button className="button button-secondary workspace-sequence-open" onClick={props.onPrintSequence}>Printable sequence and bag contents</button>
    <div className="workspace-grid">
      <section className="list-panel">
        <div className="panel-heading"><div><span className="panel-kicker">THE CHECKLIST</span><h2>Items to pack <span className="heading-count">{allInstances.length}</span></h2></div><button className="text-button" onClick={props.onAddItem}><Plus size={16}/> Add item</button></div>
        {validEntries.length ? <div className="packing-list">{validEntries.map((entry) => {
          const item = itemFor(entry); const instances = instanceIds(entry); const itemDone = instances.filter((id) => completed.has(id)).length;
          const unavailable = instances.filter((id) => trip.unavailableInstanceIds.includes(id));
          const packable = instances.filter((id) => placedIds.has(id) && !unavailable.includes(id));
          const undo = itemDone > 0 && packable.every((id) => completed.has(id));
          return <article className={`packing-item ${itemDone === entry.quantity ? 'packed' : ''}`} key={entry.id}>
            <button className={`item-check ${undo ? 'checked' : ''}`} disabled={!undo && packable.length === 0} aria-label={undo ? `Mark ${item.name} unpacked` : `Mark ${item.name} packed`} onClick={() => (undo ? instances : packable).forEach((id) => props.onToggleComplete(id, !undo))}>{undo && <Check size={14}/>}</button>
            {item.photoId ? <LocalPhoto photoId={item.photoId} getPhoto={getPhoto} className="workspace-photo" alt="" fallback={<div className={`item-monogram ${item.category}`}><span>{item.name.slice(0,1).toUpperCase()}</span></div>}/> : <div className={`item-monogram ${item.category}`}><span>{item.name.slice(0,1).toUpperCase()}</span></div>}
            <div className="packing-item-copy"><div className="packing-item-title"><strong>{item.name}</strong>{entry.quantity > 1 && <span>×{entry.quantity}</span>}</div><div className="packing-item-meta"><span>{mmToDisplay(item.dimensions.length,unit)} × {mmToDisplay(item.dimensions.width,unit)} × {mmToDisplay(item.dimensions.height,unit)} {dimLabel(unit)}</span><span className={`evidence-pill ${item.dimensionEvidence.source}`} title={item.dimensionEvidence.note ?? `${evidenceLabel(item.dimensionEvidence)} confidence`}>{evidenceLabel(item.dimensionEvidence)}</span>{item.massGrams !== undefined&&<span>{item.massEvidence?.source==='estimated'?'~':''}{gramToDisplay(item.massGrams,unit)} {item.massEvidence ? sourceLabel(item.massEvidence.source).toLowerCase() : 'weight'}</span>}</div><div className="entry-quantity-control"><button type="button" aria-label={`Remove one unpacked copy of ${item.name}`} disabled={!canSeparatePackingCopy(trip,entry.id)} onClick={()=>props.onQuantity(entry.id,entry.quantity-1)}>−</button><span>{entry.quantity} {entry.quantity===1?'copy':'copies'}</span><button type="button" aria-label={`Add copy of ${item.name}`} disabled={entry.quantity>=99} onClick={()=>props.onQuantity(entry.id,entry.quantity+1)}>+</button></div><div className="entry-controls"><label title="A required item stays prominent when the plan cannot fit it"><input type="checkbox" checked={entry.required} onChange={(event)=>props.onPriority(entry.id,event.target.checked?'required':'preferred')}/>Required</label><label title="Prefer an accessible position nearer the top"><input type="checkbox" checked={entry.accessPriority>=4} onChange={(event)=>props.onAccess(entry.id,event.target.checked?5:2)}/>Reach first</label>{trip.travellers.length>1&&<select aria-label={`Who is ${item.name} for?`} value={entry.travellerId} onChange={(event)=>props.onTraveller(entry.id,event.target.value)}>{trip.travellers.map((person)=><option key={person.id} value={person.id}>{person.name}</option>)}</select>}</div><EntryBagAssignment entry={entry} name={item.name} bags={containers} onChange={(bagId,compartmentId)=>props.onAssignment(entry.id,bagId,compartmentId)}/>{entry.quantity>1&&!(packingFormsForSelection(itemById.get(entry.itemId)!).length||entry.packingFormId)&&<button type="button" className="text-button separate-packing-copy" disabled={!canSeparatePackingCopy(trip,entry.id)} onClick={()=>props.onSeparateCopy(entry.id)}>Separate one unpacked copy</button>}{(packingFormsForSelection(itemById.get(entry.itemId)!).length||entry.packingFormId)&&<div className="entry-packing-form"><label><span>Packing form for {item.name}</span><select aria-label={`Packing form for ${item.name}`} value={entry.packingFormId??''} onChange={event=>props.onPackingForm(entry.id,event.target.value)}><option value="">Original item</option>{entry.packingFormId&&!packingFormsForSelection(itemById.get(entry.itemId)!).some(form=>form.id===entry.packingFormId)&&<option value={entry.packingFormId}>Missing form · review selection</option>}{packingFormsForSelection(itemById.get(entry.itemId)!).map(form=><option key={form.id} value={form.id}>{form.name} ({form.kind})</option>)}</select></label><small>Uses this form for all {entry.quantity} in this entry. Changing it keeps packed positions saved and can pause this bag.</small>{entry.quantity>1&&<button type="button" className="text-button separate-packing-copy" disabled={!canSeparatePackingCopy(trip,entry.id)} onClick={()=>props.onSeparateCopy(entry.id)} title="Separate the last copy only while it has no packed, locked, unavailable or failed-placement record. Earlier copies keep their saved IDs.">Separate one unpacked copy</button>}</div>}{itemDone > 0 && itemDone < entry.quantity && <small>{itemDone} of {entry.quantity} packed</small>}{instances.some((id) => !placedIds.has(id) && !trip.unavailableInstanceIds.includes(id)) && <small className="fit-warning">Not placed in this plan</small>}</div>
            {unavailable.length > 0 && <div className="unavailable-item"><span>{unavailable.length} of {entry.quantity} unavailable for this pack.</span>{unavailable.map((id) => <button key={id} className="button button-secondary" onClick={() => props.onUnavailable(id)}>Restore {item.name}{entry.quantity > 1 ? ' · item ' + (instances.indexOf(id) + 1) : ''}</button>)}</div>}
            <button className="quiet-icon" title={`Remove ${item.name} from this pack`} onClick={() => props.onRemoveEntry(entry.id)}><Trash2 size={15}/></button>
          </article>;
        })}</div> : <div className="list-empty"><div className="empty-icon"><Package size={22}/></div><strong>Your list is ready for items</strong><span>Add belongings from your library or create your first item.</span><button className="button button-secondary" onClick={props.onAddItem}><Plus size={15}/> Add from my items</button></div>}
        <button className="add-from-library" onClick={props.onAddItem}><Plus size={16}/> Choose from your item library</button>
        <div className="checklist-footnote"><ShieldCheck size={15}/><span>Required items stay visible when they do not fit. Nothing is silently removed.</span></div>
      </section>

      <section className="visual-panel">
        <div className="panel-heading visual-heading"><div><span className="panel-kicker">YOUR BAG, IN PLAN</span><h2>{selectedContainer?.name ?? 'Add a bag'}</h2></div><button className="text-button" onClick={props.onAddBag}><Plus size={16}/> Add bag</button></div>
        {containers.length > 0 && <div className="bag-tabs" role="tablist" aria-label="Bags">{containers.map((bag) => <button role="tab" aria-selected={selectedContainer?.id === bag.id} className={selectedContainer?.id === bag.id ? 'active' : ''} key={bag.id} onClick={() => props.onSelectContainer(bag.id)}><Backpack size={14}/>{bag.name}</button>)}</div>}
        {selectedContainer ? <>
          <div className="visual-stage"><PackCanvas container={selectedContainer} plan={plan} items={data.libraryItems} selectedInstanceId={undefined} view={canvasView} layer={canvasView === 'layers' ? layer : undefined}/><div className="canvas-caption"><span>GEOMETRIC PREVIEW</span><span>{mmToDisplay(selectedContainer.inside.length,unit)} × {mmToDisplay(selectedContainer.inside.width,unit)} × {mmToDisplay(selectedContainer.inside.height,unit)} {dimLabel(unit)} inside</span></div></div>
          <div className="view-controls"><div className="view-tabs" role="tablist" aria-label="Model view">{(['3d','top','layers'] as const).map((view) => <button role="tab" aria-selected={canvasView === view} className={canvasView === view ? 'active' : ''} key={view} onClick={() => props.onView(view)}>{view === '3d' ? '3D' : view === 'top' ? 'Top view' : 'Layers'}</button>)}</div>{canvasView === 'layers' && <div className="layer-control"><span>Layer</span><input aria-label="Layer" type="range" min="1" max={Math.max(1, ...plan.placements.filter((placement) => placement.containerId === selectedContainer.id).map((placement) => placement.layer))} value={layer} onChange={(event) => props.onLayer(Number(event.target.value))}/><strong>{layer}</strong></div>}</div>
          <div className="bag-summary"><div><span>ITEMS IN THIS BAG</span><strong>{selectedSummary?.itemCount ?? 0}</strong></div><div><span>OCCUPIED VOLUME USED</span><strong>~{Math.round(volumePercent)}<small>%</small></strong></div><div><span>UPPER ITEM WEIGHT</span><strong>{selectedSummary ? gramToDisplay(selectedSummary.usedMassGrams,unit) : '—'}</strong></div><span className="summary-info" title="Volume uses adopted occupied cells or rectangular item bounds. Weight uses the upper saved item values where available; it does not include the bag unless tare is recorded."><CircleHelp size={15}/></span></div>
    <BagWeightNotes containers={containers} plan={plan} trip={trip} unit={unit}/>
          <p className="geometry-note">Estimated occupied cells or rectangular item bounds inside the recorded bag space. It does not simulate closure, soft sides, cushioning, compression or physical stability.</p>
          {plan.warnings.length > 0 && <div className="warning-list">{plan.warnings.map((warning) => <p key={warning}><AlertTriangle size={15}/>{warning}</p>)}</div>}
          {selectedContainer.massLimitGrams && <div className="weight-note"><Weight size={15}/><span>Recorded item weight is compared with {gramToDisplay(selectedContainer.massLimitGrams,unit)}. Bag tare {selectedContainer.tareGrams === undefined ? 'is not entered, so gross weight is not verified' : `of ${gramToDisplay(selectedContainer.tareGrams,unit)} is included`}.</span></div>}
        </> : <div className="bag-empty"><div className="bag-outline"><Backpack size={42}/></div><h3>Start with your bag</h3><p>Enter the usable inside dimensions and opening width. The plan will use them as a rectangular approximation.</p><button className="button button-primary" onClick={props.onAddBag}><Plus size={16}/> Add your first bag</button></div>}
      </section>
    </div>
    <PackingEvidenceReview key={trip.id} trip={trip} items={data.libraryItems} bags={data.containers} plan={plan} unit={unit} onReview={group=>{
      if(group.kind==='item'){const item=data.libraryItems.find(item=>item.id===group.recordId);if(item)props.onReviewItem(item);}
      else if(group.kind==='container'){const bag=data.containers.find(bag=>bag.id===group.recordId);if(bag)props.onReviewBag(bag);}
      else props.onReviewMissing();
    }}/>
    {selectedContainer&&<OpeningEvidenceNotes bag={selectedContainer}/>}
    <StackLoadNotes plan={plan} items={data.libraryItems} unit={unit} containerId={selectedContainer?.id}/>
    <SeparationRules trip={trip} items={data.libraryItems} unit={unit} onChange={props.onSeparationRules}/>
    <SeparationNotes trip={trip} items={data.libraryItems} bags={data.containers} plan={plan} unit={unit}/>
    <section ref={planReviewRef} className="plan-review"><div className="review-heading"><div><span className="panel-kicker">PLAN CHECK</span><h2>Fit and trade-offs</h2></div><span className="review-caption">Deterministic geometric placement · generated on this device</span></div>{planReviewRequested ? <Suspense fallback={<p className="candidate-uncertainty" role="status">Opening approach comparisons…</p>}><PlanReview trip={trip} items={data.libraryItems} bags={data.containers} plan={plan} unit={unit} modeCopy={modeCopy} onSelect={props.onMode}/></Suspense> : <p className="candidate-uncertainty" role="status" aria-live="polite">Approach comparisons will be prepared when you reach this section.</p>}
      {plan.excluded.filter((entry) => entry.reason !== 'Marked unavailable for this plan.').length > 0 && <div className="excluded-list"><strong>Needs a decision</strong>{plan.excluded.filter((entry) => entry.reason !== 'Marked unavailable for this plan.').map((entry) => <div key={entry.instanceId}><AlertTriangle size={15}/><span><strong>{entry.name}{entry.required ? ' · required' : ''}</strong><small>{entry.reason}</small></span>{trip.lockedPlacements.filter(saved => saved.instanceId === entry.instanceId).map(saved => <button className="button button-secondary" key={saved.instanceId} onClick={() => completed.has(saved.instanceId) ? props.onToggleComplete(saved.instanceId,false) : props.onToggleLock(saved)}>{completed.has(saved.instanceId) ? `Undo packed for ${entry.name}` : `Unlock ${entry.name}`}</button>)}<button className="text-button" onClick={() => props.onUnavailable(entry.instanceId)}>Remove from plan</button></div>)}</div>}
    </section>
    <div className="plan-trust-note"><Lock size={15}/><span>Locked placements are preserved during replanning. A geometric match is a suggestion, not a guarantee the bag will close.</span></div>
  </main>;
}

function CarrierRulesPage({ trip, bags, summaries, placements, items, unit, catalog, onCatalog, onReview, onAdd, onEdit, onDelete }: { trip:Trip; bags:Container[]; summaries:ContainerSummary[]; placements:Placement[]; items:LibraryItem[]; unit:UnitSystem; catalog?:CarrierCatalog; onCatalog:(catalog:CarrierCatalog)=>void; onReview:(draft:CarrierRule)=>void; onAdd:()=>void; onEdit:(rule:CarrierRule)=>void; onDelete:(rule:CarrierRule)=>void }) {
  return <main className="secondary-page carrier-rules-page"><div className="page-heading"><div><p className="eyebrow">TRIP SOURCES</p><h1>Carrier rules</h1><p className="page-subtitle">Keep the rule you checked for this booking beside its official source.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> Add source record</button></div>
    <div className="carrier-rules-disclaimer"><ShieldCheck size={18}/><span>General baggage pages can differ from a booked flight. Check the exact itinerary, fare, operating airline, and each bag in your booking. The comparisons below check only the limits and measurements you entered; estimated or missing values need confirmation.</span></div>
    <Suspense fallback={<div className="secondary-page" role="status">Opening carrier lookup…</div>}><CarrierLookup catalog={catalog} onCatalog={onCatalog} onReview={onReview}/></Suspense>
    {trip.carrierRules.length === 0 ? <div className="library-empty"><div className="empty-icon"><BookOpen size={22}/></div><h2>No carrier source saved</h2><p>Open the airline's official source or booking details, then save the exact allowance, review date, and the bags it applies to.</p><button className="button button-secondary" onClick={onAdd}><Plus size={15}/> Add a source record</button></div> : <div className="carrier-rule-list">{trip.carrierRules.map((rule) => {
      const updatedLimits = carrierRuleHasUpdatedLimits(rule, catalog);
      const stale = isCarrierRuleStale(rule) || updatedLimits;
      const applicableBags = bags.filter((bag) => rule.applicableBagIds.includes(bag.id));
      const assessment = assessCarrierRule(rule, bags, summaries, { placements, lockedPlacements: trip.lockedPlacements, items });
      const checkedDate = Date.parse(rule.retrievedAt);
      return <article className={`carrier-rule-card ${stale ? 'stale' : ''}`} key={rule.id}>
        <div className="carrier-rule-heading"><div><h2>{rule.carrier}</h2><p>{rule.route || 'Route not specified'} <span>·</span> {rule.fare || 'Fare not specified'}</p></div><span className={`rule-status ${stale ? 'needs-review' : rule.status}`}>{updatedLimits ? 'Updated source needs review' : stale ? 'Recheck source' : rule.status === 'verified' ? 'Checked by you' : rule.retrieval ? 'Booking needs confirmation' : 'Manual note'}</span></div>
        {updatedLimits && <p className="carrier-lookup-warning" role="status">A newer retrieved source has different numeric limits for this allowance. Your saved record and manual overrides are unchanged. Review and save the latest allowance above, then choose which record to keep for your booking.</p>}
        {rule.retrieval && <div className="carrier-provenance"><strong>{carrierRuleOverridden(rule) ? 'Manual override of retrieved limits' : 'Limits from retrieved official page'}</strong><span>Original retrieval: {new Date(rule.retrieval.catalog.retrievedAt).toLocaleString()}</span><span>Allowance: {rule.retrieval.catalog.allowances.find((entry) => entry.id === rule.retrieval!.allowanceId)?.title}</span><small>Refreshing the lookup does not replace this saved record. The bag count checks this record's selected set; passenger entitlements across records are not pooled.</small></div>}
        {rule.notes && <p className="carrier-rule-notes">{rule.notes}</p>}
        <div className="carrier-rule-meta"><span>{applicableBags.length ? `For: ${applicableBags.map((bag) => bag.name).join(', ')}` : 'No bag selected'}</span><span>Reviewed {Number.isFinite(checkedDate) ? new Date(checkedDate).toLocaleDateString() : 'date unavailable'}</span><span>Refresh after {rule.staleAfterDays} days</span></div>
        {(rule.limits || assessment.needsBagSelection) && <CarrierLimitResults assessment={assessment} unit={unit}/>}
        <div className="carrier-rule-actions">{secureCarrierSourceUrl(rule.sourceUrl) ? <a className="text-button" href={secureCarrierSourceUrl(rule.sourceUrl)} target="_blank" rel="noreferrer">Open official source <BookOpen size={14}/></a> : <span className="scan-availability">Source link needs correction</span>}<button className="button button-secondary" onClick={() => onEdit(rule)}>Edit record</button><button className="quiet-icon delete-icon" aria-label={`Remove ${rule.carrier} source record`} onClick={() => onDelete(rule)}><Trash2 size={16}/></button></div>
      </article>;
    })}</div>}
    <div className="privacy-callout"><Lock size={16}/><span>Source records and notes are stored with this trip on this device. The app does not sign in to airline accounts or retrieve booking details.</span></div>
  </main>;
}

function CarrierLimitResults({ assessment, unit }: { assessment:ReturnType<typeof assessCarrierRule>; unit:UnitSystem }) {
  if (assessment.error) return <div className="carrier-limit-results" role="alert"><strong>Cannot compare limits</strong><p>{assessment.error}</p></div>;
  if (assessment.needsBagSelection) return <div className="carrier-limit-results"><strong>Cannot compare limits yet</strong><p>Select the bags this source applies to, then add their outside measurements and empty weights.</p></div>;
  const statusLabel:Record<CarrierLimitCheck['status'],string>={within:'Within entered limit',over:'Over entered limit',unknown:'Cannot check',estimate_within:'Estimated within limit',estimate_over:'Estimate above limit',subtotal_over:'Saved subtotal above limit'};
  const formatValue=(value:number,check:CarrierLimitCheck)=>check.unit==='bags'?`${value} bag${value===1?'':'s'}`:check.unit==='g'?`${formatComparisonNumber(value/(unit==='metric'?1:28.3495))} ${unit==='metric'?'g':'oz'}`:`${formatComparisonNumber(value/(unit==='metric'?1:25.4))} ${dimLabel(unit)}`;
  const allChecks=[...assessment.bags.flatMap((bag)=>bag.checks),...(assessment.combinedWeight?[assessment.combinedWeight]:[]),...(assessment.bagCount?[assessment.bagCount]:[])];
  return <div className="carrier-limit-results"><div className="carrier-limit-heading"><strong>Recorded limits comparison</strong><span>Traveller-entered values</span></div>
    {assessment.bags.map((bag)=>bag.checks.length>0&&<section className="carrier-limit-bag" key={bag.bagId}><h3>{bag.bagName}</h3>{bag.checks.map((check)=><CarrierCheckRow key={check.key} check={check} statusLabel={statusLabel} formatValue={formatValue}/>)}</section>)}
    {assessment.combinedWeight&&<section className="carrier-limit-bag"><h3>Selected bags together</h3><CarrierCheckRow check={assessment.combinedWeight} statusLabel={statusLabel} formatValue={formatValue}/></section>}
    {assessment.bagCount&&<section className="carrier-limit-bag carrier-piece-count"><h3>Selected bag allowance</h3><CarrierCheckRow check={assessment.bagCount} statusLabel={statusLabel} formatValue={formatValue}/></section>}
    {!allChecks.length&&<p>Add numeric limits to compare this source with the packing plan.</p>}
    {allChecks.some((check)=>check.unit==='g')&&<p className="carrier-limit-caveat">Weight uses saved item weights plus the recorded empty bag weight. Estimated or missing weights are flagged; weigh the packed bags before travel.</p>}
    <p className="carrier-limit-caveat">A comparison checks your entered measurements against your saved source. It does not confirm the airline will accept a bag or that the source applies to your booking.</p>
  </div>;
}

function CarrierCheckRow({ check, statusLabel, formatValue }: { check:CarrierLimitCheck; statusLabel:Record<CarrierLimitCheck['status'],string>; formatValue:(value:number,check:CarrierLimitCheck)=>string }) {
  return <div className={`carrier-limit-check ${check.status}`}><div><strong>{check.label}</strong><span className={`carrier-check-status ${check.status}`}>{statusLabel[check.status]}</span></div><p>{check.detail}</p>{check.margin!==undefined&&check.limit!==undefined&&<small>{check.margin===0?'At entered limit':check.margin>0?`${formatValue(check.margin,check)} below limit`:`${formatValue(Math.abs(check.margin),check)} over limit`}</small>}</div>;
}

function CarrierRuleCapture({ initial, bags, unit, onClose, onSave }: { initial?:CarrierRule; bags:Container[]; unit:UnitSystem; onClose:()=>void; onSave:(rule:Omit<CarrierRule,'id'>)=>void }) {
  const today = carrierReviewDate();
  const initialDate = initial?.retrievedAt && Number.isFinite(Date.parse(initial.retrievedAt)) ? carrierReviewDate(initial.retrievedAt) : today;
  const [carrier,setCarrier]=useState(initial?.carrier ?? '');
  const [route,setRoute]=useState(initial?.route ?? '');
  const [fare,setFare]=useState(initial?.fare ?? '');
  const [sourceUrl,setSourceUrl]=useState(initial?.sourceUrl ?? '');
  const [reviewedAt,setReviewedAt]=useState(initialDate);
  const [staleAfterDays,setStaleAfterDays]=useState(String(initial?.staleAfterDays ?? 7));
  const [applicableBagIds,setApplicableBagIds]=useState<string[]>(initial?.applicableBagIds ?? []);
  const [notes,setNotes]=useState(initial?.notes ?? '');
  const [maxLength,setMaxLength]=useState(lengthInput(initial?.limits?.maxOuterDimensionsMm?.length,unit));
  const [maxWidth,setMaxWidth]=useState(lengthInput(initial?.limits?.maxOuterDimensionsMm?.width,unit));
  const [maxHeight,setMaxHeight]=useState(lengthInput(initial?.limits?.maxOuterDimensionsMm?.height,unit));
  const [maxLinearSum,setMaxLinearSum]=useState(lengthInput(initial?.limits?.maxOuterLinearSumMm,unit));
  const [maxWeight,setMaxWeight]=useState(massInput(initial?.limits?.maxWeightGrams,unit));
  const [maxBagCount,setMaxBagCount]=useState(initial?.limits?.maxBagCount?.toString() ?? '');
  const [weightScope,setWeightScope]=useState<NonNullable<CarrierLimits['weightScope']>>(initial?.limits?.weightScope ?? 'per_bag');
  const [checkedForBooking,setCheckedForBooking]=useState(initial?.status === 'verified');
  useEffect(() => {
    if (initial && (carrier !== initial.carrier || route !== initial.route || fare !== initial.fare || sourceUrl !== initial.sourceUrl
      || notes !== initial.notes || maxLength !== lengthInput(initial.limits?.maxOuterDimensionsMm?.length,unit)
      || maxWidth !== lengthInput(initial.limits?.maxOuterDimensionsMm?.width,unit)
      || maxHeight !== lengthInput(initial.limits?.maxOuterDimensionsMm?.height,unit)
      || maxLinearSum !== lengthInput(initial.limits?.maxOuterLinearSumMm,unit)
      || maxWeight !== massInput(initial.limits?.maxWeightGrams,unit)
      || maxBagCount !== (initial.limits?.maxBagCount?.toString() ?? '')
      || weightScope !== (initial.limits?.weightScope ?? 'per_bag')
      || applicableBagIds.join('|') !== initial.applicableBagIds.join('|'))) setCheckedForBooking(false);
  }, [initial,unit,carrier,route,fare,sourceUrl,notes,maxLength,maxWidth,maxHeight,maxLinearSum,maxWeight,maxBagCount,weightScope,applicableBagIds]);
  const [error,setError]=useState('');
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    const normalizedSource=secureCarrierSourceUrl(sourceUrl);
    if(!normalizedSource){setError('Enter a credential-free HTTPS link to the airline or booking source.');return;}
    const refreshDays=Number(staleAfterDays);
    if(!carrier.trim()){setError('Enter the airline or carrier name.');return;}
    if(!notes.trim()){setError('Add the allowance or source note you want to keep with this trip.');return;}
    let retrievedAt:string;
    try { retrievedAt=carrierReviewTimestamp(reviewedAt,initial?.retrievedAt); }
    catch(reviewError){setError(reviewError instanceof Error?reviewError.message:'Enter the date you last checked the source.');return;}
    if(!Number.isInteger(refreshDays)||refreshDays<1||refreshDays>365){setError('Choose a refresh window from 1 to 365 days.');return;}
    const validBagIds=new Set(bags.map((bag)=>bag.id));
    const bagIds=applicableBagIds.filter((id)=>validBagIds.has(id));
    const axisValues=[maxLength,maxWidth,maxHeight];
    const hasAxisValues=axisValues.some((value)=>value.trim()!=='');
    if(hasAxisValues&&axisValues.some((value)=>!Number.isFinite(Number(value))||Number(value)<=0)){setError(`Enter all three maximum outside dimensions in ${dimLabel(unit)}.`);return;}
    if(maxLinearSum&&(!Number.isFinite(Number(maxLinearSum))||Number(maxLinearSum)<=0)){setError(`Enter a positive combined-dimension limit in ${dimLabel(unit)}.`);return;}
    if(maxWeight&&(!Number.isFinite(Number(maxWeight))||Number(maxWeight)<=0)){setError(`Enter a positive weight limit in ${unit==='metric'?'grams':'ounces'}.`);return;}
    const hasCount=maxBagCount.trim()!=='';
    if(hasCount&&(!Number.isInteger(Number(maxBagCount))||Number(maxBagCount)<0||Number(maxBagCount)>100)){setError('Enter a whole number of bags from 0 to 100, or leave it blank when not recorded.');return;}
    const hasNumericLimits=hasAxisValues||!!maxLinearSum||!!maxWeight||hasCount;
    if(hasNumericLimits&&bagIds.length===0){setError('Choose at least one bag for these numeric limits.');return;}
    const limits:CarrierLimits|undefined=hasNumericLimits?{
      ...(hasAxisValues?{maxOuterDimensionsMm:{length:measurementFromInput(maxLength,unit==='metric'?1:25.4,initial?.limits?.maxOuterDimensionsMm?.length),width:measurementFromInput(maxWidth,unit==='metric'?1:25.4,initial?.limits?.maxOuterDimensionsMm?.width),height:measurementFromInput(maxHeight,unit==='metric'?1:25.4,initial?.limits?.maxOuterDimensionsMm?.height)}}:{}),
      ...(maxLinearSum?{maxOuterLinearSumMm:measurementFromInput(maxLinearSum,unit==='metric'?1:25.4,initial?.limits?.maxOuterLinearSumMm)}:{}),
      ...(maxWeight?{maxWeightGrams:measurementFromInput(maxWeight,unit==='metric'?1:28.3495,initial?.limits?.maxWeightGrams),weightScope}:{}),
      ...(hasCount?{maxBagCount:Number(maxBagCount)}:{}),
    }:undefined;
    onSave({carrier:carrier.trim(),route:route.trim()||'Not specified',fare:fare.trim()||'Not specified',sourceUrl:normalizedSource,retrievedAt,staleAfterDays:refreshDays,applicableBagIds:bagIds,notes:notes.trim(),status:checkedForBooking?'verified':'manual',...(limits?{limits}:{}),...(initial?.retrieval?{retrieval:initial.retrieval}:{})});
  };
  return <Modal title={initial?.retrieval?'Review retrieved allowance':initial?'Edit carrier source':'Save a carrier source'} eyebrow="TRIP SOURCE" onClose={onClose}><form className="simple-modal-form carrier-rule-form" onSubmit={submit}>
    <label className="field"><span>Airline or carrier</span><input autoFocus value={carrier} onChange={(event)=>setCarrier(event.target.value)} maxLength={80} placeholder="e.g. KLM"/></label>
    <div className="date-fields"><label className="field"><span>Route or itinerary <em>optional</em></span><input value={route} onChange={(event)=>setRoute(event.target.value)} maxLength={120} placeholder="e.g. AMS–LIS, including connections"/></label><label className="field"><span>Fare or cabin <em>optional</em></span><input value={fare} onChange={(event)=>setFare(event.target.value)} maxLength={100} placeholder="e.g. Economy Light"/></label></div>
    <label className="field"><span>Official source link</span><input type="url" value={sourceUrl} onChange={(event)=>setSourceUrl(event.target.value)} maxLength={500} placeholder="https://airline.example/baggage"/></label>
    <label className="field"><span>Allowance notes</span><textarea value={notes} onChange={(event)=>setNotes(event.target.value)} maxLength={1500} rows={4} placeholder="Record the allowance shown for this booking, including dimensions, weight and number of bags."/></label>
    <section className="carrier-limits-form" aria-label="Numeric baggage limits"><div className="field-heading"><span>Optional numeric limits</span></div><p>Copy only values shown by the source you checked. Enter them in your chosen units: {dimLabel(unit)} and {unit==='metric'?'g':'oz'}. A source listing 55 cm means 550 mm.</p>
      <label className="field"><span>Maximum number of selected bags <em>optional</em></span><input aria-label="Maximum number of bags" type="number" min="0" max="100" step="1" inputMode="numeric" value={maxBagCount} onChange={(event)=>setMaxBagCount(event.target.value)}/><small>This count applies to the bags selected in this record, including empty bags. For a per-passenger allowance, select that passenger's bags and save separate records for other passengers. Counts are not pooled across records.</small></label>
      <div className="field-block"><div className="field-heading"><span>Maximum outside size per bag · {dimLabel(unit)}</span></div><div className="dimension-fields">{([['length','Length',maxLength,setMaxLength],['width','Width',maxWidth,setMaxWidth],['height','Height',maxHeight,setMaxHeight]] as const).map(([axis,label,value,setter])=><label className="field" key={axis}><span>{label}</span><input aria-label={`Maximum outside ${label}`} type="number" min="0.1" step="any" inputMode="decimal" value={value} onChange={(event)=>setter(event.target.value)}/></label>)}</div></div>
      <label className="field"><span>Maximum combined outside dimensions per bag · {dimLabel(unit)} <em>optional</em></span><input aria-label="Maximum combined outside dimensions" type="number" min="0.1" step="any" inputMode="decimal" value={maxLinearSum} onChange={(event)=>setMaxLinearSum(event.target.value)}/></label>
      <div className="date-fields"><label className="field"><span>Weight limit · {unit==='metric'?'grams':'ounces'} <em>optional</em></span><input aria-label="Carrier weight limit" type="number" min="0.1" step="any" inputMode="decimal" value={maxWeight} onChange={(event)=>setMaxWeight(event.target.value)}/></label><label className="field"><span>Weight limit applies to</span><select value={weightScope} onChange={(event)=>setWeightScope(event.target.value as NonNullable<CarrierLimits['weightScope']>)}><option value="per_bag">Each selected bag</option><option value="combined">Selected bags together</option></select></label></div>
      <small>Outside measurements are checked separately from interior packing space. Measure each outside side including handles and wheels if the source counts them.</small>
    </section>
    <div className="date-fields"><label className="field"><span>{initial?.retrieval?'Last checked by you':'Last checked'}</span><input type="date" value={reviewedAt} onChange={(event)=>setReviewedAt(event.target.value)}/></label><label className="field"><span>Recheck after · days</span><input type="number" min="1" max="365" step="1" value={staleAfterDays} onChange={(event)=>setStaleAfterDays(event.target.value)}/></label></div>
    <div className="traveller-fields"><div className="field-heading"><span>Which bags does this source apply to?</span></div>{bags.length ? bags.map((bag)=><label className="check-row" key={bag.id}><input type="checkbox" checked={applicableBagIds.includes(bag.id)} onChange={(event)=>setApplicableBagIds((current)=>event.target.checked?[...current,bag.id]:current.filter((id)=>id!==bag.id))}/><span>{bag.name}</span></label>) : <small>Add a bag to this pack to attach the source to it.</small>}</div>
    <label className="check-row carrier-verified-check"><input type="checkbox" checked={checkedForBooking} onChange={(event)=>setCheckedForBooking(event.target.checked)}/><span>I checked the allowance for this exact booking, fare and operating airline.</span></label>
    <div className="capture-disclosure">{initial?.retrieval?<><strong>Retrieved source with editable limits.</strong> The original page was retrieved {new Date(initial.retrieval.catalog.retrievedAt).toLocaleString()}. Your edits are saved as a manual override and never change that timestamp. Select the bags for one passenger and this allowance; an excess count will be flagged. Check the booking and passenger allowance yourself. This app does not retrieve your booking or guarantee carriage.</>:<><strong>Manual source record.</strong> The app does not fetch this manually entered source or your booking. Comparisons check only the numeric values and bag measurements you entered; they cannot confirm booking applicability or carrier acceptance.</>}</div>
    {error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">Save source</button></div>
  </form></Modal>;
}

function LibraryPage({ items, data, activeTrip, search, setSearch, getPhoto, unit, onAdd, onEdit, onDelete, onAddEntry }: { items:LibraryItem[]; data:AppData; activeTrip?:Trip; search:string; setSearch:(value:string)=>void; getPhoto:(id:string)=>Promise<Blob|undefined>; unit:UnitSystem; onAdd:()=>void; onEdit:(item:LibraryItem)=>void; onDelete:(item:LibraryItem)=>void; onAddEntry:(item:LibraryItem)=>void }) {
  return <main className="secondary-page"><div className="page-heading"><div><p className="eyebrow">REUSABLE INVENTORY</p><h1>My items</h1><p className="page-subtitle">Keep a record of the things you pack often. Photos and measurements stay on this device.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> Add item</button></div>
    <div className="library-tools"><label className="search-box"><Search size={17}/><input placeholder="Search your items" value={search} onChange={(event) => setSearch(event.target.value)}/>{search && <button className="icon-button" onClick={() => setSearch('')}><X size={15}/></button>}</label><span>{data.libraryItems.length} saved {data.libraryItems.length === 1 ? 'item' : 'items'}</span></div>
    {!items.length ? <div className="library-empty"><div className="empty-icon"><Package size={22}/></div><h2>{search ? 'No matching items' : 'Your item library is empty'}</h2><p>{search ? 'Try another name or category.' : 'Add an item with dimensions to reuse it across your packing lists.'}</p>{!search && <button className="button button-primary" onClick={onAdd}><Plus size={16}/> Add your first item</button>}</div> : <div className="library-list">{items.map((item) => {
      const inPack = activeTrip?.entries.some((entry) => entry.itemId === item.id);
      const usedInAnyTrip = data.trips.some((trip) => trip.entries.some((entry) => entry.itemId === item.id));
      return <article className="library-item-card" key={item.id}><div className="library-item-visual">{item.photoId ? <LocalPhoto photoId={item.photoId} getPhoto={getPhoto} className="library-photo" alt="" fallback={<div className={`item-monogram large ${item.category}`}>{item.name.slice(0,1).toUpperCase()}</div>}/> : <div className={`item-monogram large ${item.category}`}>{item.name.slice(0,1).toUpperCase()}</div>}</div><div className="library-item-info"><div className="library-title-row"><h2>{item.name}</h2><span className={`evidence-pill ${item.dimensionEvidence.source}`} title={item.dimensionEvidence.note ?? `${evidenceLabel(item.dimensionEvidence)} confidence`}>{evidenceLabel(item.dimensionEvidence)} size</span></div><p>{item.category.replace('_',' ')}<span>·</span>{mmToDisplay(item.dimensions.length,unit)} × {mmToDisplay(item.dimensions.width,unit)} × {mmToDisplay(item.dimensions.height,unit)} {dimLabel(unit)}<span>·</span>{item.massGrams !== undefined ? `${item.massEvidence?.source==='estimated'?'~':''}${gramToDisplay(item.massGrams,unit)}${item.massEvidence ? ` · ${evidenceLabel(item.massEvidence)} weight` : ''}` : 'Weight unknown'}</p>{(item.dimensionEvidence.note || item.massEvidence?.note) && <small>{item.dimensionEvidence.note ?? item.massEvidence?.note}</small>}<div className="library-tags">{item.fragile && <span>Fragile · no stacking</span>}{item.maxTopLoadGrams !== undefined && <span>Above limit {gramToDisplay(item.maxTopLoadGrams,unit)}</span>}{item.keepUpright && <span title={uprightInstruction(item)}>{uprightTag(item)}</span>}<span>{item.flexibility.replace('_',' ')}</span>{packingFormsForSelection(item).length>0&&<span>{packingFormsForSelection(item).length} packing forms</span>}{usedInAnyTrip && <span>Used in a pack</span>}</div><HandlingPropertyNotes item={item}/></div><div className="library-item-actions"><button className="button button-secondary" onClick={() => onAddEntry(item)} disabled={!activeTrip || inPack}><Plus size={15}/>{inPack ? 'In this pack' : 'Add to pack'}</button><button className="quiet-icon" title={`Edit ${item.name}`} onClick={() => onEdit(item)}><Ruler size={16}/></button><button className="quiet-icon delete-icon" title={`Delete ${item.name}`} onClick={() => onDelete(item)}><Trash2 size={16}/></button></div></article>;
    })}</div>}
    <div className="privacy-callout"><ShieldCheck size={17}/><span><strong>Local by design.</strong> Reference photos are stored in this browser and included in backups you download.</span></div>
  </main>;
}

function BagsPage({ trip, bags, unit, onAdd, onEdit, onRemove }: { trip?:Trip; bags:Container[]; unit:UnitSystem; onAdd:()=>void; onEdit:(bag:Container)=>void; onRemove:(bag:Container)=>void }) {
  return <main className="secondary-page"><div className="page-heading"><div><p className="eyebrow">BAG INVENTORY</p><h1>My bags</h1><p className="page-subtitle">Add inside measurements for packing and outside measurements for carrier checks.</p></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> Add bag</button></div>
    {!bags.length ? <div className="library-empty"><div className="empty-icon"><Backpack size={22}/></div><h2>No bags in this pack</h2><p>The solver needs the usable inside dimensions and opening of at least one bag.</p><button className="button button-primary" onClick={onAdd}><Plus size={16}/> Add a bag</button></div> : <div className="bag-card-list">{bags.map((bag) => <article className="bag-card" key={bag.id}><div className="bag-card-icon"><Backpack size={23}/></div><div className="bag-card-main"><div className="library-title-row"><h2>{bag.name}</h2><span className={`evidence-pill ${bag.insideEvidence.source}`} title={bag.insideEvidence.note ?? `${evidenceLabel(bag.insideEvidence)} confidence`}>{evidenceLabel(bag.insideEvidence)} inside</span>{bag.outerDimensionsMm&&<span className={`evidence-pill ${bag.outerDimensionsEvidence?.source ?? 'estimated'}`} title={bag.outerDimensionsEvidence?.note ?? 'Outside size entered by the traveller'}>{bag.outerDimensionsEvidence ? evidenceLabel(bag.outerDimensionsEvidence) : 'Unverified'} outside</span>}</div><p>{bag.kind.replace('_',' ')}<span>·</span>{mmToDisplay(bag.inside.length,unit)} × {mmToDisplay(bag.inside.width,unit)} × {mmToDisplay(bag.inside.height,unit)} {dimLabel(unit)} inside</p><small>{bag.outerDimensionsMm ? `Outside: ${mmToDisplay(bag.outerDimensionsMm.length,unit)} × ${mmToDisplay(bag.outerDimensionsMm.width,unit)} × ${mmToDisplay(bag.outerDimensionsMm.height,unit)} ${dimLabel(unit)} (including handles/wheels)` : 'Outside dimensions not recorded'} · Opening: {mmToDisplay(bag.opening.length,unit)} × {mmToDisplay(bag.opening.width,unit)} {dimLabel(unit)}{bag.tareGrams !== undefined ? ` · empty weight ${gramToDisplay(bag.tareGrams,unit)}` : ' · empty weight not recorded'}{bag.massLimitGrams ? ` · limit ${gramToDisplay(bag.massLimitGrams,unit)}` : ''}</small><OpeningEvidenceNotes bag={bag}/><ContainerSpaceNotes bag={bag}/></div><div className="bag-card-actions"><button className="button button-secondary" onClick={() => onEdit(bag)}>Edit bag</button><button className="quiet-icon delete-icon" title={`Remove ${bag.name}`} onClick={() => onRemove(bag)}><Trash2 size={16}/></button></div></article>)}</div>}
    {trip && <div className="privacy-callout"><AlertTriangle size={17}/><span>Recorded dimensions are rectangular estimates. An explicitly adopted scan cavity also keeps its unavailable cells empty. Physically check the clear interior, narrowest opening and any unseen intrusions.</span></div>}
  </main>;
}

function SettingsPage({ data, unit, syncStatus, scanRetention,onScanRetention,onUnit, onPhotoRetention, onExport, onImport, onDelete, onOpenShared, onPublished }: { data:AppData; unit:UnitSystem; syncStatus:string; scanRetention:{supported:boolean;status:string}; onScanRetention:(days:ScanRetentionDays|null)=>void; onUnit:(unit:UnitSystem)=>void; onPhotoRetention:(days:number|null)=>void; onExport:()=>void; onImport:(file?:File)=>Promise<boolean>; onDelete:()=>void; onOpenShared:(snapshot:SharedPackSnapshot,baseline?:SharedPackBaseline,witness?:SharedCopyWitness)=>void; onPublished:(tripId:string,snapshot:SharedPackSnapshot,baseline:SharedPackBaseline)=>void }) {
  const device=useDeviceWorkspace();
  const [restoreBusy,setRestoreBusy]=useState(false),[restoreNotice,setRestoreNotice]=useState('');
  return <main className="secondary-page settings-page"><div className="page-heading"><div><p className="eyebrow">YOUR PREFERENCES</p><h1>Settings</h1><p className="page-subtitle">Control how this device stores and displays your packing data.</p></div></div>
    <DeviceWorkspaceSettings/>
    <Suspense fallback={<div role="status">Opening account tools…</div>}><AccountPanel data={data} onRestore={onImport} onOpenShared={onOpenShared} onPublished={onPublished}/></Suspense>
    <section className="settings-section"><div className="settings-section-title"><div className="settings-icon"><Ruler size={18}/></div><div><h2>Measurements</h2><p>Choose the units you use. Stored sizes are converted as needed.</p></div></div><label className="field compact-field"><span>Units</span><select aria-label="Units" value={unit} onChange={(event) => onUnit(event.target.value as UnitSystem)}><option value="metric">Metric · mm and grams</option><option value="imperial">Imperial · inches and ounces</option></select></label></section>
    <section className="settings-section"><div className="settings-section-title"><div className="settings-icon"><ShieldCheck size={18}/></div><div><h2>Local storage & photos</h2><p>Packing records are saved on this device. Optional account backups require a separate consented upload.</p></div></div><div className="settings-detail-row"><div><strong>Save status</strong><span>{syncStatus === 'saved' ? 'Saved to this device' : syncStatus === 'saving' ? 'Saving…' : 'There may be unsaved changes'}</span></div><span className="storage-indicator"><span className={syncStatus === 'error' ? 'status-dot error' : 'status-dot'}/>{syncStatus === 'error' ? 'Needs attention' : 'Local'}</span></div><label className="field compact-field"><span>Automatically delete photos after</span><select value={data.settings.automaticPhotoDeletionDays ?? ''} onChange={(event) => onPhotoRetention(event.target.value ? Number(event.target.value) : null)}><option value="">Keep until I remove them</option><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select></label><p className="settings-note">Automatic deletion removes reference photos. Native scan files can be removed from an item or bag editor, or by deleting all local data. JSON backups do not contain original scan files or source images. They retain explicitly adopted item shapes and bag cavities for offline planning.</p></section>
    <section className="settings-section"><ScanRetentionSettings key={data.settings.automaticScanDeletionDays??'off'} days={data.settings.automaticScanDeletionDays??null} supported={scanRetention.supported} status={scanRetention.status} saving={syncStatus!=='saved'} onApply={onScanRetention}/></section>
    <section className="settings-section"><div className="settings-section-title"><div className="settings-icon"><Download size={18}/></div><div><h2>Back up or restore</h2><p>Backups include trips, bags, item records, and the photos saved with those items.</p></div></div><div className="backup-actions"><button className="button button-secondary" disabled={device.fileBusy||(device.native&&!device.filesSupported)} onClick={onExport}><Download size={16}/>{device.native?'Save backup file':'Download backup'}</button>{device.native?<button className="button button-secondary" disabled={device.fileBusy||!device.filesSupported||!!device.pendingBackup} onClick={()=>void device.pickBackup()}><Upload size={16}/> Choose backup file</button>:<label className="button button-secondary import-button"><Upload size={16}/> Restore backup<input type="file" accept="application/json,.json" onChange={(event) => { onImport(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}/></label>}</div><p className="settings-note">Backup files are unencrypted and may contain personal item photos. Store them somewhere you trust. {device.native&&'The system picker can include cloud providers; choosing one can copy your backup there. Protected workspaces lock while a provider is open.'}</p>
      {device.native&&!device.filesSupported&&<p className="settings-note">Native backup files are unavailable in this installation. This flow requires the updated Android app.</p>}
      {device.pendingBackup&&<div className="backup-review"><p className="backup-review-description">{device.backupMatches?'The selected backup is ready for review. Confirming restore replaces this workspace’s records and photos and removes its existing original scan files. Other workspaces remain.':'This backup was selected in a different workspace. Open that workspace before reviewing it.'}</p>{device.backupMatches&&<button className="button button-primary" disabled={restoreBusy||device.fileBusy} onClick={()=>{setRestoreBusy(true);setRestoreNotice('');void device.reviewBackup().then(onImport).then(restored=>{if(restored)return device.discardBackup(true);}).catch(error=>setRestoreNotice(error instanceof Error?error.message:'Backup review failed.')).finally(()=>setRestoreBusy(false));}}>Review selected backup</button>}<button className="button button-secondary" disabled={restoreBusy||device.fileBusy} onClick={()=>void device.discardBackup().catch(error=>setRestoreNotice(error instanceof Error?error.message:'Discard failed.'))}>Discard selected backup</button></div>}
      {device.fileNotice&&<p role="status" className="settings-note account-notice">{device.fileNotice}</p>}{restoreNotice&&<p role="status" className="settings-note account-notice">{restoreNotice}</p>}
    </section>
    <section className="settings-section danger-section"><div className="settings-section-title"><div className="settings-icon"><Trash2 size={18}/></div><div><h2>Delete local data</h2><p>{device.session ? "Remove the packing records and photos in this protected workspace. Guest packs, other workspaces and server records remain." : "Remove guest trips, bags, items, photos and native scan files from this device. Protected workspaces and server records remain."}</p></div></div><button className="button button-danger" onClick={onDelete}><Trash2 size={16}/> Delete all local data</button></section>
    <div className="settings-foot"><Lock size={15}/> Photos and original scans stay on this device. Account backups and household packs upload only after explicit consent.</div>
  </main>;
}

function EmptyState({ onNew, onSettings }: { onNew:()=>void; onSettings:()=>void }) {
  return <main className="empty-home"><div className="empty-home-art"><div className="empty-case"><span/><span/><span/></div><div className="empty-tag">READY WHEN YOU ARE</div></div><p className="eyebrow">A LITTLE MORE ROOM TO THINK</p><h1>Make space for<br/>what matters.</h1><p>Your packing plans and item library stay on this device. Start with a bag, add a few things, and see a considered way to pack.</p><button className="button button-primary" onClick={onNew}><Plus size={17}/> Create a pack</button><button className="text-button" onClick={onSettings}>Restore a backup</button></main>;
}

function TripCapture({ initial, onClose, onSave, onDelete }: { initial?:Trip; onClose:()=>void; onSave:(name:string,destination:string,start:string,end:string,packingOnly:boolean,travellerNames:string[],activities:TripActivity[],laundryAvailable:boolean,existingId?:string)=>void; onDelete?:()=>void }) {
  const [name,setName] = useState(initial?.sample ? '' : initial?.name ?? '');
  const [destination,setDestination] = useState(initial?.sample ? '' : initial?.destination ?? '');
  const [start,setStart] = useState(initial?.sample ? '' : initial?.startDate ?? '');
  const [end,setEnd] = useState(initial?.sample ? '' : initial?.endDate ?? '');
  const [packingOnly,setPackingOnly] = useState(initial?.packingOnly ?? true);
  const [travellers,setTravellers] = useState<string[]>(initial?.travellers.map((traveller)=>traveller.name) ?? ['You']);
  const [activities,setActivities] = useState<TripActivity[]>(initial?.activities ?? []);
  const [laundryAvailable,setLaundryAvailable] = useState(initial?.laundryAvailable ?? false);
  const toggleActivity = (activity:TripActivity) => setActivities((current) => current.includes(activity) ? current.filter((value) => value !== activity) : [...current,activity]);
  const submit = (event:FormEvent) => {
    event.preventDefault();
    const tripName = name.trim() || (destination.trim() ? `${destination.trim()} pack` : 'Packing session');
    const tripDestination = destination.trim();
    onSave(tripName,tripDestination,start,end,packingOnly,travellers,activities,laundryAvailable,initial && !initial.sample ? initial.id : undefined);
  };
  const activityChoices: Array<[TripActivity,string]> = [['city','City walking'],['business','Business'],['beach','Beach'],['outdoors','Outdoor activities'],['formal_event','Formal event'],['sports','Sports or exercise']];
  return <Modal title={initial && !initial.sample ? 'Pack details' : 'Create a pack'} eyebrow={initial && !initial.sample ? 'PACK DETAILS' : 'NEW PACK'} onClose={onClose}>
    <form onSubmit={submit} className="simple-modal-form">
      <label className="field"><span>Pack name</span><input autoFocus value={name} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Weekend in Lisbon" maxLength={70}/></label>
      <label className="field"><span>Destination <em>optional</em></span><input value={destination} onChange={(event)=>setDestination(event.target.value)} placeholder="e.g. Lisbon, Portugal" maxLength={100}/></label>
      <div className="date-fields"><label className="field"><span>Start date</span><input type="date" value={start} onChange={(event)=>setStart(event.target.value)}/></label><label className="field"><span>End date</span><input type="date" min={start||undefined} value={end} onChange={(event)=>setEnd(event.target.value)}/></label></div>
      <div className="traveller-fields"><div className="field-heading"><span>Travellers · assign personal items and bags</span>{travellers.length<8&&<button type="button" className="text-button" onClick={()=>setTravellers((current)=>[...current,`Traveller ${current.length+1}`])}><Plus size={14}/> Add person</button>}</div>{travellers.map((traveller,index)=><div className="traveller-row" key={index}><label className="field"><span>{index===0?'First traveller':`Traveller ${index+1}`}</span><input value={traveller} onChange={(event)=>setTravellers((current)=>current.map((value,row)=>row===index?event.target.value:value))} maxLength={40}/></label>{index>0&&<button type="button" className="quiet-icon delete-icon" aria-label={`Remove traveller ${index+1}`} onClick={()=>setTravellers((current)=>current.filter((_,row)=>row!==index))}><X size={15}/></button>}</div>)}</div>
      <div className="choice-block"><span className="field-label">What do you need?</span><label className="radio-row"><input type="radio" checked={packingOnly} onChange={()=>setPackingOnly(true)}/><span><strong>Packing only</strong><small>Start with the items you already have in mind.</small></span></label><label className="radio-row"><input type="radio" checked={!packingOnly} onChange={()=>setPackingOnly(false)}/><span><strong>Trip-aware list</strong><small>Get an editable starter checklist from dates and activities.</small></span></label></div>
      {!packingOnly && <div className="trip-context-inputs"><div className="field-heading"><span>Activities · choose any that apply</span></div><div className="trip-activity-grid">{activityChoices.map(([value,label])=><label className="check-row" key={value}><input type="checkbox" checked={activities.includes(value)} onChange={()=>toggleActivity(value)}/><span>{label}</span></label>)}</div><label className="check-row laundry-check"><input type="checkbox" checked={laundryAvailable} onChange={(event)=>setLaundryAvailable(event.target.checked)}/><span>Laundry will be available</span></label><small>Starter suggestions use your entries. Optional weather lookup becomes available after saving; health and carrier decisions are not inferred. You can edit the list after creating the pack.</small></div>}
      <div className="modal-actions">{onDelete && <button className="button button-danger" type="button" onClick={onDelete}>Delete pack</button>}<span className="modal-action-spacer"/><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit">{initial && !initial.sample ? 'Save details' : 'Create pack'}</button></div>
    </form>
  </Modal>;
}

function BagCapture({ initial, unit, travellers, scanSupported, scanUnavailableReason, onClose, onSave }: { initial?:Container; unit:UnitSystem; travellers:Traveller[]; scanSupported:boolean; scanUnavailableReason?:string; onClose:()=>void; onSave:(bag:Omit<Container,'id'|'createdAt'>,draftSourceIds:string[])=>Promise<void> }) {
  const {scanObject,deleteScanCapture}=useDeviceWorkspace().capture;
  const [name,setName]=useState(initial?.name ?? '');
  const [kind,setKind]=useState<Container['kind']>(initial?.kind ?? 'cabin_case');
  const [length,setLength]=useState(lengthInput(initial?.inside.length,unit));
  const [width,setWidth]=useState(lengthInput(initial?.inside.width,unit));
  const [height,setHeight]=useState(lengthInput(initial?.inside.height,unit));
  const [openLength,setOpenLength]=useState(lengthInput(initial?.opening.length,unit));
  const [openWidth,setOpenWidth]=useState(lengthInput(initial?.opening.width,unit));
  const [openingEvidence,setOpeningEvidence]=useState<Evidence|undefined>(initial?.openingEvidence);
  const [outerLength,setOuterLength]=useState(lengthInput(initial?.outerDimensionsMm?.length,unit));
  const [outerWidth,setOuterWidth]=useState(lengthInput(initial?.outerDimensionsMm?.width,unit));
  const [outerHeight,setOuterHeight]=useState(lengthInput(initial?.outerDimensionsMm?.height,unit));
  const [outerSource,setOuterSource]=useState<Evidence['source']>(initial?.outerDimensionsEvidence?.source ?? 'user_confirmed');
  const [tare,setTare]=useState(massInput(initial?.tareGrams,unit));
  const [tareSource,setTareSource]=useState<Evidence['source']>(initial?.tareEvidence?.source ?? 'user_confirmed');
  const [limit,setLimit]=useState(massInput(initial?.massLimitGrams,unit));
  const [compartments,setCompartments]=useState<ContainerCompartment[]>(()=>structuredClone(initial?.compartments??[]));
  const reviewCompartmentsAgain=()=>setCompartments(current=>current.map(c=>({...c,supportEvidence:evidence('estimated','Inside frame changed; check the recorded compartment positions, openings and supporting bases again.')})));
  const [unavailableSpaces,setUnavailableSpaces]=useState<UnavailableSpace[]>(()=>structuredClone(initial?.unavailableSpaces??[]));
  const [lidClearance,setLidClearance]=useState(lengthInput(initial?.lidClearanceMm,unit));
  const [lidSource,setLidSource]=useState<Evidence['source']>(initial?.lidClearanceEvidence?.source??'estimated');
  const [insideEvidence,setInsideEvidence]=useState<Evidence>(initial?.insideEvidence ?? evidence('user_confirmed','Inside dimensions entered by the user; not instrument-verified. Opening evidence is reviewed separately.'));
  const [packingInterior,setPackingInterior]=useState<PackingInterior|undefined>(()=>initial?.packingInterior?structuredClone(initial.packingInterior):undefined);
  const interiorDraft=useMemo(()=>{try{return packingInterior?interiorGeometry(packingInterior):undefined;}catch{return undefined;}},[packingInterior]);
  const [scan,setScan]=useState(initial?.scan);
  const [calibrationBasis,setCalibrationBasis]=useState(initial?.scan ? initial.scan.dimensionsEstimateMm ?? initial.inside : undefined);
  const [scaleCalibration,setScaleCalibration]=useState(initial?.scaleCalibration);
  const [scanDimensionsEdited,setScanDimensionsEdited]=useState(false);
  const [scaleReference,setScaleReference]=useState(initial?.scaleCalibration ? mmToDisplay(initial.scaleCalibration.referenceLengthMm,unit) : '');
  const [travellerIds,setTravellerIds]=useState<string[]>(initial?.travellerIds ?? travellers.map((person)=>person.id));
  const [error,setError]=useState('');
  const [scanning,setScanning]=useState(false),[saving,setSaving]=useState(false),[cleaning,setCleaning]=useState(false);
  const operation=useRef(false),draftSources=useRef(new Set<string>());
  const busy=scanning||saving||cleaning;
  const captureInterior=async()=>{
    if(operation.current)return;operation.current=true;
    setScanning(true); setError('');
    try {
      const result=await scanObject('container_interior');
      if(result.record.id!==initial?.scan?.id)draftSources.current.add(result.record.id);
      let cleanupFailed=false;
      if(scan&&scan.id!==initial?.scan?.id)try{await deleteScanCapture(scan.id);draftSources.current.delete(scan.id);}catch{cleanupFailed=true;}
      setLength(mmToDisplay(result.dimensionsMm.length,unit)); setWidth(mmToDisplay(result.dimensionsMm.width,unit)); setHeight(mmToDisplay(result.dimensionsMm.height,unit));
      setInsideEvidence({source:'estimated',confidence:0.5,collectedAt:result.record.createdAt,note:'Uncalibrated 3D estimate from a guided scan. Check usable interior dimensions and the narrowest opening with a physical measurement.'});
      setPackingInterior(undefined);
      setOpeningEvidence(changedPropertyEvidence(openingEvidence));
      reviewCompartmentsAgain();
      setScan(result.record);
      setCalibrationBasis(result.dimensionsMm);
      setScaleCalibration(undefined);
      setScanDimensionsEdited(false);
      setScaleReference('');
      setError([...(cleanupFailed?['The new scan is ready, but the previous draft source could not be removed. Save or cancel will retry its cleanup.']:[]),...result.warnings].join(' '));
    } catch(scanError) { const message=scanError instanceof Error?scanError.message:'The scan could not be completed.';if(message!=='Scan cancelled.')setError(message); }
    finally { operation.current=false;setScanning(false); }
  };
  const closeEditor=async()=>{
    if(operation.current)return;operation.current=true;setCleaning(true);setError('');
    try{for(const id of [...draftSources.current]){await deleteScanCapture(id);draftSources.current.delete(id);}onClose();}
    catch{setError('The draft source captures could not all be removed. Your saved bag is unchanged. Save the draft or try cancelling again.');}
    finally{operation.current=false;setCleaning(false);}
  };
  const removeScan=async()=>{
    if(operation.current)return;operation.current=true;setCleaning(true);
    try{if(scan&&scan.id!==initial?.scan?.id){await deleteScanCapture(scan.id);draftSources.current.delete(scan.id);}setScan(undefined);setScaleReference('');}
    catch{setError('The new 3D source capture could not be removed. The draft is retained.');}
    finally{operation.current=false;setCleaning(false);}
  };
  const editInsideDimension=(axis:'length'|'width'|'height',setter:(value:string)=>void,value:string)=>{
    setter(value);
    const oldValue=axis==='length'?length:axis==='width'?width:height;
    if(value!==oldValue)reviewCompartmentsAgain();
    setPackingInterior(undefined);
    if(!scan&&!packingInterior)return;
    setScanDimensionsEdited(true);
    const nextValues={
      length:displayToMm(Number(axis==='length'?value:length),unit),
      width:displayToMm(Number(axis==='width'?value:width),unit),
      height:displayToMm(Number(axis==='height'?value:height),unit),
    };
    if(Object.values(nextValues).every((part)=>Number.isFinite(part)&&part>0))setCalibrationBasis(nextValues);
    setScaleCalibration(undefined);
    setInsideEvidence({source:'estimated',confidence:0.5,collectedAt:new Date().toISOString(),note:'Scan-based interior dimensions were edited by the traveller; confirm all displayed values and the narrowest opening before relying on fit.'});
  };
  const calibrateInteriorScale=()=>{
    if(!scan&&!packingInterior)return;
    const referenceLengthMm=displayToMm(Number(scaleReference),unit);
    try{
      const estimate=packingInterior?.cavity.boundsMm??calibrationBasis??scan?.dimensionsEstimateMm??{length:displayToMm(Number(length),unit),width:displayToMm(Number(width),unit),height:displayToMm(Number(height),unit)};
      const calibrated=calibrateLongestEdge(estimate,referenceLengthMm);
      const ratio=packingInterior?referenceLengthMm/Math.max(...Object.values(packingInterior.cavity.boundsMm)):undefined;
      const model=packingInterior?{...packingInterior,scale:ratio!,supportReview:ratio===packingInterior.scale?packingInterior.supportReview:undefined}:undefined;
      const dimensions=model?interiorGeometry(model).dimensions:calibrated.dimensionsMm;
      if(model)setPackingInterior(model);
      if(model)setOpeningEvidence(changedPropertyEvidence(openingEvidence));
      if(dimensions.length!==Number(length)*(unit==='metric'?1:25.4)||dimensions.width!==Number(width)*(unit==='metric'?1:25.4)||dimensions.height!==Number(height)*(unit==='metric'?1:25.4))reviewCompartmentsAgain();
      setLength(lengthInput(dimensions.length,unit));setWidth(lengthInput(dimensions.width,unit));setHeight(lengthInput(dimensions.height,unit));
      setScaleCalibration({method:'measured_longest_edge',referenceLengthMm,calibratedAt:new Date().toISOString()});
      setInsideEvidence({source:'estimated',confidence:0.65,collectedAt:new Date().toISOString(),note:`3D scan scale calibrated with a traveller-measured longest edge (${Math.round(referenceLengthMm)} mm). Rounded corners, intrusions, compartments and the opening remain unmeasured; confirm usable space physically.`});
      setScanDimensionsEdited(false);setError('');
    }catch(calibrationError){setError(calibrationError instanceof Error?calibrationError.message:'The scan scale could not be calibrated.');}
  };
  const adoptCavity=(geometry:ReconstructedInterior,travelUp:PackingInterior['travelUp'])=>{
    const basis=geometry.cavity.boundsMm;
    if(scanDimensionsEdited)throw Error('The scan dimensions were edited independently. Calibrate the original source scale before adopting a cavity.');
    const ratio=scaleCalibration?scaleCalibration.referenceLengthMm/Math.max(...Object.values(basis)):1;
    const model=adoptInterior(geometry.cavity,travelUp,ratio);
    const dimensions=interiorGeometry(model).dimensions;
    setPackingInterior(model);
    setOpeningEvidence(changedPropertyEvidence(openingEvidence));
    reviewCompartmentsAgain();
    setLength(lengthInput(dimensions.length,unit));setWidth(lengthInput(dimensions.width,unit));setHeight(lengthInput(dimensions.height,unit));
    setInsideEvidence({source:'estimated',confidence:0.5,collectedAt:model.adoptedAt,note:'Estimated connected scan cavity in the reviewed opening-up frame. The traveller reviewed the lowest floor, inside corner and travel-up end; physical completeness and fit remain unverified.'});
    setError('');
  };
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(operation.current)return;
    const dims=[length,width,height,openLength,openWidth].map(Number);
    const outerValues=[outerLength,outerWidth,outerHeight];
    const hasOuterValues=outerValues.some((value)=>value.trim()!=='');
    if(!name.trim()){setError('Name this bag.');return;}
    if(dims.some((value)=>!Number.isFinite(value)||value<=0)){setError('Enter all inside dimensions and opening dimensions.');return;}
    if(hasOuterValues&&outerValues.some((value)=>!Number.isFinite(Number(value))||Number(value)<=0)){setError(`Enter all three outside dimensions in ${dimLabel(unit)}, or leave them blank.`);return;}
    if(dims[3]>dims[0]||dims[4]>dims[1]){setError('Opening dimensions should not be larger than the bag interior.');return;}
    if(travellers.length>0&&travellerIds.length===0){setError('Choose at least one traveller for this bag.');return;}
    const scale=(value:string,original?:number)=>measurementFromInput(value,unit==='metric'?1:25.4,original);
    const weight=(value:string,original?:number)=>measurementFromInput(value,unit==='metric'?1:28.3495,original);
    const massError = bagMassRecordError({ tareGrams: tare.trim() === '' ? undefined : Number(tare), massLimitGrams: limit.trim() === '' ? undefined : Number(limit) });
    if(massError){setError(massError);return;}
    const preciseInside=interiorDraft?.dimensions??initial?.inside;
    const inside={length:scale(length,preciseInside?.length),width:scale(width,preciseInside?.width),height:scale(height,preciseInside?.height)};
    const lidClearanceMm=lidClearance.trim()===''?undefined:scale(lidClearance,initial?.lidClearanceMm);
    const lidClearanceEvidence=lidClearanceMm!==undefined?(lidClearanceMm===initial?.lidClearanceMm&&lidSource===initial?.lidClearanceEvidence?.source?initial.lidClearanceEvidence:{...evidence(lidSource,'Vertical space deliberately left below the lid; physically confirm closure.'),confidence:lidSource==='estimated'?.5:1}):undefined;
    const spaceError=containerSpaceError({inside,packingInterior,compartments:compartments.length?compartments:undefined,unavailableSpaces,lidClearanceMm,lidClearanceEvidence})??interiorSupportError(packingInterior);
    if(spaceError){setError(spaceError);return;}
    const outerDimensionsMm=hasOuterValues?{length:scale(outerLength,initial?.outerDimensionsMm?.length),width:scale(outerWidth,initial?.outerDimensionsMm?.width),height:scale(outerHeight,initial?.outerDimensionsMm?.height)}:undefined;
    if(outerDimensionsMm){
      const outsideSides=Object.values(outerDimensionsMm).sort((a,b)=>b-a);
      const insideSides=Object.values(inside).sort((a,b)=>b-a);
      if(outsideSides.some((side,index)=>side<insideSides[index])){setError('Outside measurements cannot be smaller than the usable inside space. Check the measurements and units.');return;}
    }
    const outerUnchanged=outerDimensionsMm&&initial?.outerDimensionsMm&&Object.keys(outerDimensionsMm).every((axis)=>outerDimensionsMm[axis as keyof typeof outerDimensionsMm]===initial.outerDimensionsMm![axis as keyof typeof outerDimensionsMm]);
    operation.current=true;setSaving(true);setError('');
    try{await onSave({
      name:name.trim(),kind,inside,...(compartments.length?{compartments}:{}),...(packingInterior?{packingInterior}:{}),
      ...(unavailableSpaces.length?{unavailableSpaces}:{}),...(lidClearanceMm!==undefined?{lidClearanceMm,lidClearanceEvidence}:{}),
      ...(outerDimensionsMm?{outerDimensionsMm,outerDimensionsEvidence:outerUnchanged&&initial?.outerDimensionsEvidence?.source===outerSource?initial.outerDimensionsEvidence:{...evidence(outerSource,'Outside dimensions entered by the traveller. Include handles and wheels when the carrier source counts them.'),confidence:outerSource==='estimated'?0.5:1}}:{}),
      opening:{length:scale(openLength,initial?.opening.length),width:scale(openWidth,initial?.opening.width)},openingEvidence,insideEvidence,
      ...(scan?{scan}:{}),...(scaleCalibration?{scaleCalibration}:{}),
      ...(tare?{tareGrams:weight(tare,initial?.tareGrams),tareEvidence:weight(tare,initial?.tareGrams)===initial?.tareGrams&&initial?.tareEvidence?.source===tareSource?initial.tareEvidence:{...evidence(tareSource,'Empty bag weight entered by the traveller.'),confidence:tareSource==='estimated'?0.5:1}}:{}),
      ...(limit?{massLimitGrams:weight(limit,initial?.massLimitGrams),massLimitEvidence:weight(limit,initial?.massLimitGrams)===initial?.massLimitGrams&&initial?.massLimitEvidence?initial.massLimitEvidence:evidence('user_confirmed','Weight limit entered by the user; verify the applicable rule.')}:{ }),travellerIds,
    },[...draftSources.current]);}
    catch(saveError){setError(saveError instanceof Error&& !['AbortError','QuotaExceededError','UnknownError'].includes(saveError.name)?saveError.message:'The bag could not be saved on this device. Your draft has not been saved; your previous bag is retained. Retry saving or cancel the draft.');}
    finally{operation.current=false;setSaving(false);}
  };
  return <Modal title={initial?'Edit bag':'Add a bag'} eyebrow="BAG INVENTORY" onClose={()=>void closeEditor()} busy={busy}><form className="simple-modal-form bag-form" onSubmit={event=>void submit(event)} aria-busy={busy}><fieldset className="bag-editor-fields" disabled={busy}>
    <label className="field"><span>Bag name</span><input autoFocus value={name} onChange={(event)=>setName(event.target.value)} placeholder="e.g. Blue cabin case" maxLength={70}/></label>
    <label className="field"><span>Type</span><select value={kind} onChange={(event)=>setKind(event.target.value as Container['kind'])}>{[['cabin_case','Cabin case'],['checked_case','Checked case'],['personal_item','Personal item'],['backpack','Backpack'],['duffel','Duffel'],['other','Other']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <div className="field-block"><div className="field-heading"><span>Usable inside dimensions · {dimLabel(unit)}</span><Ruler size={15}/></div>
      <button className="button button-secondary scan-size-button" type="button" onClick={captureInterior} disabled={!scanSupported||scanning}><ScanLine size={16}/>{scanning?'Scanning…':'Scan empty interior'}</button>
      {!scanSupported&&<small className="scan-availability">{scanUnavailableReason ?? 'Guided 3D scanning is not available on this device. You can enter or measure the size here.'}</small>}
      {(scan||packingInterior)&&<div className="scan-calibration"><p>Measure the longest edge of the original source envelope to set its uniform scale. For an adopted cavity, the displayed usable inside dimensions exclude observed boundary cells and may be smaller. Check all boundaries and the narrowest opening physically.</p><label className="field"><span>Measured longest source edge · {dimLabel(unit)}</span><input aria-label="Measured longest inside edge" type="number" inputMode="decimal" min="0.1" max={unit==='metric'?10000:393.7} step="any" value={scaleReference} onChange={event=>setScaleReference(event.target.value)} placeholder={unit==='metric'?'e.g. 500':'e.g. 19.7'}/></label><button className="button button-secondary" type="button" onClick={calibrateInteriorScale} disabled={!scaleReference}>Calibrate scan scale</button>{scaleCalibration&&!scanDimensionsEdited&&<small className="scan-availability">Uniform scale calibrated; remaining boundaries and physical fit are estimates.</small>}</div>}
      {scan&&<><Suspense fallback={<div role="status">Opening saved scan preview…</div>}><SavedScanPreview key={scan.id} record={scan} onAdoptInterior={adoptCavity}/></Suspense><button className="text-button" type="button" onClick={removeScan}>Remove saved 3D scan</button></>}
      {packingInterior&&<section className="adopted-interior" aria-label="Adopted estimated cavity"><h3>Estimated cavity in this draft</h3>{interiorDraft?<><p>{interiorDraft.freeCells.length.toLocaleString()} free cells · {(interiorDraft.surface.volumeMm3/1e6).toFixed(3)} estimated litres · uniform scale {packingInterior.scale.toFixed(4)}. The reviewed opening faces up for packing; the bag's {interiorTravelLabel(packingInterior)} end in that view faces up during travel.</p><p>Inside dimensions use the new corner at the smallest free side edges and lowest free floor. Recheck recorded restrictions in this frame. Editing a size independently switches this draft to rectangular space.</p><small>Source {packingInterior.cavity.id} · {packingInterior.cavity.sourcePointCount.toLocaleString()} original points. Original capture unchanged. Save applies this draft; cancel keeps the saved bag.</small><InteriorSupportReview key={packingInterior.cavity.id+':'+packingInterior.scale+':'+packingInterior.travelUp.axis+':'+packingInterior.travelUp.sign} model={packingInterior} onChange={setPackingInterior}/></>:<p className="form-error" role="alert">The saved cavity needs correction. Review the source again or explicitly switch this draft to recorded rectangular space. Cancel preserves the saved record and packed positions.</p>}<button className="button button-secondary" type="button" onClick={()=>{setPackingInterior(undefined);reviewCompartmentsAgain();}}>Use recorded rectangular space</button></section>}
      <div className="dimension-fields">{([['length','Length',length,setLength],['width','Width',width,setWidth],['height','Height',height,setHeight]] as const).map(([axis,label,value,setter])=><label className="field" key={axis}><span>{label}</span><input aria-label={`Inside ${label}`} type="number" inputMode="decimal" min="0.1" step="any" value={value} onChange={event=>editInsideDimension(axis,setter,event.target.value)}/></label>)}</div>
    </div>
    <div className="field-block"><div className="field-heading"><span>Narrowest opening · {dimLabel(unit)}</span></div><div className="dimension-fields">{[['Length',openLength,setOpenLength],['Width',openWidth,setOpenWidth]].map(([label,value,setter])=><label className="field" key={String(label)}><span>{String(label)}</span><input aria-label={`Opening ${String(label)}`} type="number" inputMode="decimal" min="0.1" step="any" value={String(value)} onChange={event=>{(setter as (value:string)=>void)(event.target.value);setOpeningEvidence(changedPropertyEvidence(openingEvidence));}}/></label>)}</div><PropertyEvidenceFields label="Opening" measurable evidence={openingEvidence} onChange={setOpeningEvidence}/></div>
    <CompartmentFields compartments={compartments} onChange={setCompartments} unit={unit}/>
    <UnavailableSpaceFields spaces={unavailableSpaces} onChange={setUnavailableSpaces} unit={unit}/>
    <div className="field-block lid-clearance-fields"><h3>Space below the lid</h3><p>Leave this vertical space free across the whole bag. Measure it below the opening in the packing view. This view may differ from the travel-up direction you reviewed. It does not establish closure or cushioning.</p><label className="field"><span>Lid clearance · {dimLabel(unit)} <em>optional</em></span><input aria-label="Lid clearance" type="number" min="0" step="any" inputMode="decimal" value={lidClearance} onChange={event=>setLidClearance(event.target.value)}/></label>{lidClearance.trim()!==''&&<label className="field"><span>Lid clearance source</span><select aria-label="Lid clearance source" value={lidSource} onChange={event=>setLidSource(event.target.value as Evidence['source'])}>{(['estimated','measured','user_confirmed'] as const).map(source=><option key={source} value={source}>{sourceLabel(source)}</option>)}{!['estimated','measured','user_confirmed'].includes(lidSource)&&<option value={lidSource}>{sourceLabel(lidSource)}</option>}</select></label>}</div>
    <div className="field-block carrier-outer-dimensions"><div className="field-heading"><span>Outside dimensions for carrier checks · {dimLabel(unit)} <em>optional</em></span></div><p>Measure the full outside as the bag will travel. Include handles and wheels when the carrier counts them.</p><div className="dimension-fields">{([['length','Length',outerLength,setOuterLength],['width','Width',outerWidth,setOuterWidth],['height','Height',outerHeight,setOuterHeight]] as const).map(([axis,label,value,setter])=><label className="field" key={axis}><span>{label}</span><input aria-label={`Outside ${label}`} type="number" inputMode="decimal" min="0.1" step="any" value={value} onChange={(event)=>setter(event.target.value)}/></label>)}</div><label className="field"><span>Outside size source</span><select value={outerSource} onChange={(event)=>setOuterSource(event.target.value as Evidence['source'])}>{(['measured','known','estimated','user_confirmed'] as const).map((source)=><option key={source} value={source}>{sourceLabel(source)}</option>)}{outerSource==='provider'&&<option value="provider">Provider record</option>}</select></label></div>
    <div className="mass-row"><label className="field"><span>Empty weight <em>optional · {unit==='metric'?'grams':'ounces'}</em></span><input aria-label="Empty bag weight" type="number" min="0" step="any" inputMode="decimal" value={tare} onChange={(event)=>setTare(event.target.value)}/></label><label className="field"><span>Weight limit <em>optional · {unit==='metric'?'grams':'ounces'}</em></span><input aria-label="Bag weight limit" type="number" min="0.1" step="any" inputMode="decimal" value={limit} onChange={(event)=>setLimit(event.target.value)}/></label></div>
    {tare&&<label className="field"><span>Empty weight source</span><select value={tareSource} onChange={(event)=>setTareSource(event.target.value as Evidence['source'])}>{(['measured','known','estimated','user_confirmed'] as const).map((source)=><option key={source} value={source}>{sourceLabel(source)}</option>)}{tareSource==='provider'&&<option value="provider">Provider record</option>}</select></label>}
    {travellers.length>1&&<div className="traveller-fields"><div className="field-heading"><span>Who can use this bag?</span></div>{travellers.map((person)=><label className="check-row" key={person.id}><input type="checkbox" checked={travellerIds.includes(person.id)} onChange={(event)=>setTravellerIds((current)=>event.target.checked?[...current,person.id]:current.filter((id)=>id!==person.id))}/><span>{person.name}</span></label>)}</div>}
    <div className="capture-disclosure"><strong>Confirm the usable interior.</strong> Review alone estimates an envelope; explicit cavity adoption changes the usable inside frame. Hidden intrusions, corners and compartments may reduce real space. Measure the narrowest opening and physically check fit.</div>{error&&<p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button button-secondary" type="button" onClick={closeEditor}>Cancel</button><button className="button button-primary" type="submit">{saving?'Saving bag…':cleaning?'Removing draft scans…':initial?'Save bag':'Add bag'}</button></div>
  </fieldset></form></Modal>;
}

function Modal({ title, eyebrow, onClose, children, busy=false }: { title:string; eyebrow:string; onClose:()=>void; children:ReactNode; busy?:boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(!busy&&event.target===event.currentTarget)onClose();}}><section className="modal simple-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}
