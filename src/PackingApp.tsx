import type { SeparationRule } from './types';
import type { SavedWeather } from './weather';
import { entryHasSeparation, separationRuleError, MAX_SEPARATION_RULES } from './separation-rule-records';
import { checklistInstanceState, type ChecklistInstanceState } from './checklist-state';
import { OpeningEvidenceNotes } from './components/HandlingPropertyNotes';
import { useRawScanRetention } from './scanning/useRawScanRetention';
import { recordRemovedScanSources,type ScanRetentionReply } from './scan-retention';
import { EntryBagAssignment } from './components/EntryBagAssignment';
import type {ItemEditorDraft} from './item-photo-draft';
import type { SharedCopyWitness, SharedPackSnapshot } from './shared-packs';
import type { SharedPackBaseline } from './shared-pack-baseline';
import {useDeviceWorkspace} from './components/DeviceWorkspace';
import { BagWeightNotes } from './components/BagWeightNotes';
import { uprightInstruction, uprightTag } from './upright';
import { StackLoadNotes } from './components/StackLoadNotes';
import { packingFormsForSelection,packingItem,separablePackingEntryIds,separatePackingCopy,changePackingQuantity } from './packing-forms';
import { ContainerSpaceNotes } from './components/ContainerSpaceNotes';
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, Backpack, BookOpen, Check, ChevronDown, CircleHelp,
  ClipboardList, Lock, MapPin, MoreHorizontal, Package, PackageCheck, Plus,
  Settings, ShieldCheck, Trash2, Weight, X,
} from 'lucide-react';
import type { ItemDraft } from './components/ItemCapture';
import type { InventoryFormatters } from './components/InventoryPages';
import { LocalPhoto } from './components/LocalPhoto';
import type { TripSuggestion } from './trip-assistant';
import {  markPackingItemUnavailable, rejectPackingPlacement, setPackingItemComplete } from './packing-progress';
import { measurementInput } from './measurement-input';
import {workspaceStorage} from './storage';
import {MAX_BACKUP_BYTES} from './backup-limits';
import { createEmptyData } from './empty-data';
import { PlannerWorkerClient, plannerContainersForWorker, plannerItemsForWorker, plannerTripForWorker, reusePlannerItemReferences, shouldUsePlannerWorker } from './optimizer-worker-client';
import { observeNearViewport } from './viewport-observer';
import { filterLibraryItems } from './library-search';
import type { AppData, CarrierRule, Container, Evidence, ItemPriority, LibraryItem, OptimizationMode, PackEntry, PackingPlan, Placement, Trip, TripActivity, UnitSystem } from './types';

type Page = 'workspace' | 'items' | 'bags' | 'carrier-rules' | 'settings' | 'steps' | 'sequence';
type CaptureState = { kind: 'item'; item?: LibraryItem; suggestion?: TripSuggestion; resumed?:{draft:ItemEditorDraft;photo?:Blob} } | { kind: 'bag'; bag?: Container } | { kind: 'trip'; trip?: Trip } | { kind: 'carrier-rule'; rule?: CarrierRule; draft?: CarrierRule } | null;

const ItemCapture = lazy(() => import('./components/ItemCapture').then((module) => ({ default: module.ItemCapture })));
const BagCapture = lazy(() => import('./components/BagCapture').then((module) => ({ default: module.BagCapture })));
const CarrierRuleCapture = lazy(() => import('./components/CarrierRuleCapture').then((module) => ({ default: module.CarrierRuleCapture })));
const TripCapture = lazy(() => import('./components/TripCapture').then((module) => ({ default: module.TripCapture })));
const SettingsPage = lazy(() => import('./components/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const CarrierRulesPage = lazy(() => import('./components/CarrierRulesPage').then((module) => ({ default: module.CarrierRulesPage })));
const PlanSteps = lazy(() => import('./components/PlanSteps').then((module) => ({ default: module.PlanSteps })));
const PackingSequence = lazy(() => import('./components/PackingSequence').then((module) => ({ default: module.PackingSequence })));
const PackingEvidenceReview = lazy(() => import('./components/PackingEvidenceReview').then((module) => ({ default: module.PackingEvidenceReview })));
const PlanReview = lazy(() => import('./components/PlanComparison').then((module) => ({ default: module.PlanReview })));
const WeatherLookup = lazy(() => import('./components/WeatherLookup').then((module) => ({ default: module.WeatherLookup })));
const TripListAssistant = lazy(() => import('./components/TripListAssistant').then((module) => ({ default: module.TripListAssistant })));
const PackCanvas = lazy(() => import('./components/PackCanvas').then((module) => ({ default: module.PackCanvas })));
const SeparationNotes = lazy(() => import('./components/SeparationNotes').then((module) => ({ default: module.SeparationNotes })));
const SeparationRules = lazy(() => import('./components/SeparationRules').then((module) => ({ default: module.SeparationRules })));
const LibraryPage = lazy(() => import('./components/InventoryPages').then((module) => ({ default: module.LibraryPage })));
const BagsPage = lazy(() => import('./components/InventoryPages').then((module) => ({ default: module.BagsPage })));

const newId = () => globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const reuseIdenticalReferences = <T,>(previous: T[], next: T[]) => previous.length === next.length && previous.every((value, index) => value === next[index]) ? previous : next;
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
const inventoryFormatters: InventoryFormatters = { mmToDisplay, gramToDisplay, dimLabel, sourceLabel, evidenceLabel, uprightInstruction, uprightTag };
const modeCopy: Record<OptimizationMode, { title: string; detail: string }> = {
  balanced: { title: 'Balanced', detail: 'Space, weight & careful placement' },
  maximum_capacity: { title: 'Maximum capacity', detail: 'Prioritize fitting more items' },
  easy_access: { title: 'Easy access', detail: 'Frequently needed items nearer the top' },
  fragile_protection: { title: 'Fragile protection', detail: 'No load on fragile items and full occupied base support' },
};

export function PackingApp() {
  const device=useDeviceWorkspace();
  const {clearScanCaptures,deleteScanCapture}=device.capture;
  const {clearLocalData,deletePhoto,exportPhotos,getPhoto,importPhoto,loadAppData,prunePhotos,removeUnreferencedPhotos,saveAppData,savePhoto}=useMemo(()=>workspaceStorage(device.session),[device.session]);
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
  const [plan, setPlan] = useState<PackingPlan>();
  const [planError, setPlanError] = useState('');
  const [notice, setNotice] = useState('');
  const planRequest = useRef(0);
  const plannerWorker = useRef<PlannerWorkerClient | null>(null);
  if (!plannerWorker.current) plannerWorker.current = new PlannerWorkerClient(
    () => new Worker(new URL('./optimizer.worker.ts', import.meta.url), { type: 'module', name: 'packing-plan' }),
  );
  useEffect(() => () => plannerWorker.current?.dispose(), []);
  const requestPlanComparison = useCallback((trip: Trip, items: LibraryItem[], containers: Container[], modes: OptimizationMode[]) => {
    const requestId = ++planRequest.current;
    const promise = plannerWorker.current!.calculate({ requestId, trip: plannerTripForWorker(trip), items: plannerItemsForWorker(trip, items), containers: plannerContainersForWorker(trip, containers), modes }).then(response => {
      if (response.error) throw new Error(response.error);
      if (!response.plans || response.plans.length !== modes.length) throw new Error('Plan comparisons could not be prepared.');
      return response.plans;
    });
    return { requestId, promise, cancel: () => plannerWorker.current?.cancel(requestId) };
  }, []);

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
  const librarySearchCache = useMemo(() => new WeakMap<LibraryItem, string>(), [data?.libraryItems, search.length > 0]);
  const libraryItems = useMemo(() => data ? filterLibraryItems(data.libraryItems, search, librarySearchCache) : [], [data?.libraryItems, librarySearchCache, search]);
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
  const previousPlanItems = useRef<LibraryItem[]>([]);
  const planItems = useMemo(() => {
    const referenced = new Set(activeTrip?.entries.map((entry) => entry.itemId) ?? []);
    const next = data?.libraryItems.filter((item) => referenced.has(item.id)) ?? [];
    const stable = reusePlannerItemReferences(previousPlanItems.current, next);
    previousPlanItems.current = stable;
    return stable;
  }, [data?.libraryItems, activeTrip?.entries]);
  const previousPlanContainers = useRef<Container[]>([]);
  const planContainers = useMemo(() => {
    const stable = reuseIdenticalReferences(previousPlanContainers.current, activeContainers);
    previousPlanContainers.current = stable;
    return stable;
  }, [activeContainers]);
  // Keep planner work off the UI thread so large plans do not freeze interaction.
  useEffect(() => {
    let active = true;
    setPlan(undefined);
    setPlanError('');
    if (!data || !activeTrip) return () => { active = false; };
    const requestId = ++planRequest.current;
    const buildOnMainThread = () => import('./optimizer').then(({ buildPlan }) => {
      if (active) setPlan(buildPlan(activeTrip, planItems, planContainers));
    });
    const instanceCount = activeTrip.entries.reduce((count, entry) => count + Math.max(1, entry.quantity), 0);
    const hasComplexGeometry = planItems.some(item => item.packingShape)
      || planContainers.some(container => container.packingInterior || container.compartments?.length);
    const needsWorker = shouldUsePlannerWorker(instanceCount, hasComplexGeometry);
    if (!needsWorker) {
      void buildOnMainThread().catch((error: unknown) => {
        if (active) setPlanError(error instanceof Error ? error.message : 'The packing plan could not be prepared.');
      });
      return () => { active = false; };
    }
    void plannerWorker.current!.calculate({ requestId, trip: plannerTripForWorker(activeTrip), items: planItems, containers: planContainers })
      .then((result) => {
        if (!active) return;
        if (result.error) setPlanError(result.error);
        else if (result.plan) setPlan(result.plan);
      })
      .catch(() => {
        if (active) void buildOnMainThread().catch((error: unknown) => {
          if (active) setPlanError(error instanceof Error ? error.message : 'The packing plan could not be prepared.');
        });
      });
    return () => { active = false; plannerWorker.current?.cancel(requestId); };
  }, [data !== undefined, planItems, planContainers, activeTrip?.id, activeTrip?.entries, activeTrip?.containerIds, activeTrip?.mode, activeTrip?.lockedPlacements, activeTrip?.unavailableInstanceIds, activeTrip?.rejectedPlacements, activeTrip?.separationRules]);
  useEffect(() => {
    if (data?.settings.automaticPhotoDeletionDays) prunePhotos(data.settings.automaticPhotoDeletionDays).catch(() => undefined);
  }, [data?.settings.automaticPhotoDeletionDays]);

  const confirmRemovedSources=useCallback((reply:ScanRetentionReply)=>setData(current=>current?recordRemovedScanSources(current,reply):current),[]);
  const scanRetention=useRawScanRetention({data,savedData,capture:device.capture,deferred:!!capture||!!device.pendingPhoto||!!device.pendingBackup||device.fileBusy,checkAvailability:page==='settings'||data?.settings.automaticScanDeletionDays!=null,onRemoved:confirmRemovedSources});

  const updateData = useCallback((updater: (current: AppData) => AppData) => setData((current) => current ? updater(current) : current), []);
  const updateTrip = useCallback((updater: (trip: Trip) => Trip) => updateData((current) => ({
    ...current, trips: current.trips.map((trip) => trip.id === current.activeTripId ? { ...updater(trip), updatedAt: new Date().toISOString() } : trip),
  })), [updateData]);
  const switchTrip = (id: string) => { updateData((current) => ({ ...current, activeTripId: id })); setSelectedContainerId(''); setPage('workspace'); };
  const addEntry = useCallback((item: LibraryItem) => {
    if (!activeTrip) return;
    const existing = activeTrip.entries.find((entry) => entry.itemId === item.id);
    if (existing) updateTrip((trip) => ({ ...trip, entries: trip.entries.map((entry) => entry.id === existing.id ? { ...entry, quantity: entry.quantity + 1 } : entry) }));
    else updateTrip((trip) => ({ ...trip, entries: [...trip.entries, { id: newId(), itemId: item.id, travellerId: trip.travellers[0]?.id ?? '', quantity: 1, priority: 'preferred', accessPriority: 2, required: false }] }));
    setNotice(`${item.name} added to ${activeTrip.name}.`);
    setPage('workspace');
  }, [activeTrip, updateTrip]);
  const openNewLibraryItem = useCallback(() => setCapture({ kind: 'item' }), []);
  const editLibraryItem = useCallback((item: LibraryItem) => setCapture({ kind: 'item', item }), []);
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
      await saveAppData(next);stagedPhoto=undefined;setData(next);setSavedData(next);setSyncStatus('saved');setSyncError('');
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

  const deleteLibraryItem = useCallback(async (item: LibraryItem) => {
    if(data?.trips.some(trip=>trip.entries.some(entry=>entry.itemId===item.id && entryHasSeparation(trip,entry.id)))){setNotice('Edit or remove the linked separation rules before removing this item from the library.');return;}
    const linked = data?.trips.some((trip) => trip.entries.some((entry) => entry.itemId === item.id));
    if (linked && !window.confirm(`Remove ${item.name} from every packing list and delete it from your library?`)) return;
    if (!window.confirm(`Delete ${item.name} from your item library? This cannot be undone.`)) return;
    if (item.photoId) await deletePhoto(item.photoId);
    if (item.scan) await deleteScanCapture(item.scan.id).catch(() => setNotice('The item record was removed, but its 3D source capture could not be removed from this device.'));
    updateData((current) => ({ ...current, libraryItems: current.libraryItems.filter((record) => record.id !== item.id), trips: current.trips.map((trip) => ({ ...trip, entries: trip.entries.filter((entry) => entry.itemId !== item.id), lockedPlacements: trip.lockedPlacements.filter((placement) => placement.itemId !== item.id) })) }));
  }, [data?.trips, deletePhoto, deleteScanCapture, setNotice, updateData]);
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
      const {assembleBackupJson,prepareBackupJson}=await import('./backup');
      const parts=prepareBackupJson(data,new Date().toISOString());
      const photoBudget=MAX_BACKUP_BYTES-parts.bytesWithoutPhotos;
      if(photoBudget<2)throw new Error('This backup is over 80 MB. Remove unneeded photos before exporting.');
      const photos=await exportPhotos(photoBudget);
      const text=assembleBackupJson(parts,photos);
      device.checkActive();
      if(device.native){await device.saveBackup(text);return;}
      const blob=new Blob([text],{type:'application/json'});
      if(blob.size>MAX_BACKUP_BYTES)throw new Error('This backup is over 80 MB. Remove unneeded photos before exporting.');
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`packing-scanning-${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice('Backup downloaded. Keep it somewhere private; it may include your item photos.');
    }catch(error){setNotice(error instanceof Error?error.message:'The backup could not be prepared.');}
  };
  const importBackup = async (file?: File): Promise<boolean> => {
    if (!file || !data) return false;
    if (file.size > MAX_BACKUP_BYTES) { setNotice('This backup is over 80 MB. Choose a smaller backup file.'); return false; }
    const stagedPhotoIds: string[] = [];
    let committed = false;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const { isPackingBackup } = await import('./backup');
      if (!isPackingBackup(parsed)) throw new Error('This file is not a supported Packing Scanning backup.');
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
      setSavedData(restored);setSyncStatus('saved');setSyncError('');
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
    const empty = createEmptyData();
    await saveAppData(empty);
    setData(empty);setSavedData(empty);setSyncStatus('saved');setSyncError('');setEditingPhotoUrl(undefined);setNotice(scanCleanupFailed ? 'Packing data was deleted, but some native scan files could not be removed from this device.' : 'All local packing data and saved scans have been deleted.'); setPage('workspace');
  };
  const openSharedPackFromSettings = (snapshot: SharedPackSnapshot, baseline?: SharedPackBaseline, witness?: SharedCopyWitness) => {
    void import('./shared-packs').then(({ openSharedPack }) => updateData(current => openSharedPack(current, snapshot, newId(), baseline, witness))).catch(() => setNotice('The shared pack could not be opened. Reopen Settings and try again.'));
  };
  const recordSharedPublicationFromSettings = (tripId: string, snapshot: SharedPackSnapshot, baseline: SharedPackBaseline) => {
    void import('./shared-pack-combination').then(({ recordSharedPublication }) => updateData(current => recordSharedPublication(current, tripId, snapshot, baseline))).catch(() => setNotice('The household pack could not be updated. Reopen Settings and try again.'));
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
        {activeTrip && !plan && page !== 'items' && page !== 'bags' && page !== 'settings' && <div className="secondary-page" role="status">{planError || 'Preparing your packing plan…'}</div>}
        {page === 'workspace' && activeTrip && plan && <Workspace
          trip={activeTrip} data={data} containers={activeContainers} selectedContainer={selectedContainer} plan={plan} canvasView={canvasView} layer={layer} getPhoto={getPhoto} unit={data.unitSystem}
          requestPlanComparison={requestPlanComparison}
          onSeparationRules={rules=>updateTrip(trip=>({...trip,separationRules:rules}))}
          onWeather={weather=>updateTrip(trip=>({...trip,weather}))}
          onPrintSequence={() => setPage('sequence')}
          onReviewItem={item=>setCapture({kind:'item',item})} onReviewBag={bag=>setCapture({kind:'bag',bag})} onReviewMissing={()=>setPage('settings')}
          onView={setCanvasView} onLayer={setLayer} onSelectContainer={setSelectedContainerId} onMode={setMode} onAddItem={() => { setSearch(''); setPage('items'); }} onAddSuggestion={addSuggestedItem} onAddBag={() => setCapture({ kind: 'bag' })} onAddTrip={() => setCapture({ kind: 'trip' })} onRemoveEntry={removeEntry} onToggleComplete={toggleComplete} onToggleLock={toggleLock} onUnavailable={setUnavailable} onStartSteps={() => setPage('steps')} onEditTrip={() => setCapture({ kind: 'trip', trip: activeTrip })} onPriority={setEntryPriority} onAccess={setEntryAccess} onTraveller={setEntryTraveller} onAssignment={setEntryBagAssignment} onPackingForm={setEntryPackingForm} onSeparateCopy={splitPackingCopy} onQuantity={changeEntryQuantity}/>}
        {page === 'steps' && activeTrip && plan && <Suspense fallback={<div className="secondary-page" role="status">Opening packing steps…</div>}><PlanSteps getPhoto={getPhoto} key={activeTrip.id} trip={activeTrip} plan={plan} containers={activeContainers} items={data.libraryItems} onExit={() => setPage('workspace')} onComplete={toggleComplete} onUnavailable={(id) => updateTrip((trip) => markPackingItemUnavailable(trip, id))} onLock={lockPlacement} onDoesNotFit={rejectPlacement} onResetFailed={() => updateTrip((trip) => ({ ...trip, rejectedPlacements: [] }))} onSelectStep={(id) => updateTrip((trip) => ({ ...trip, packingCursor: id }))} onPrintSequence={() => setPage('sequence')}/></Suspense>}
        {page === 'sequence' && activeTrip && plan && <Suspense fallback={<div className="secondary-page" role="status">Opening packing sequence…</div>}><PackingSequence trip={activeTrip} plan={plan} containers={activeContainers} items={data.libraryItems} getPhoto={getPhoto} onExit={() => setPage('steps')}/></Suspense>}
        {page === 'items' && <Suspense fallback={<div className="secondary-page" role="status">Opening items…</div>}><LibraryPage items={libraryItems} itemCount={data.libraryItems.length} trips={data.trips} activeTrip={activeTrip} search={search} setSearch={setSearch} getPhoto={getPhoto} unit={data.unitSystem} onAdd={openNewLibraryItem} onEdit={editLibraryItem} onDelete={deleteLibraryItem} onAddEntry={addEntry} formatters={inventoryFormatters}/></Suspense>}
        {page === 'bags' && <Suspense fallback={<div className="secondary-page" role="status">Opening bags…</div>}><BagsPage trip={activeTrip} bags={activeContainers} unit={data.unitSystem} onAdd={() => setCapture({ kind: 'bag' })} onEdit={(bag) => setCapture({ kind: 'bag', bag })} onRemove={removeBag} formatters={inventoryFormatters}/></Suspense>}
        {page === 'carrier-rules' && activeTrip && plan && <Suspense fallback={<div className="secondary-page" role="status">Opening carrier rules…</div>}><CarrierRulesPage trip={activeTrip} bags={activeContainers} summaries={plan.summaries} placements={plan.placements} items={data.libraryItems} unit={data.unitSystem} catalog={data.carrierCatalog} onCatalog={(carrierCatalog) => updateData((current) => ({ ...current, carrierCatalog }))} onReview={(draft) => setCapture({ kind: 'carrier-rule', draft })} onAdd={() => setCapture({ kind: 'carrier-rule' })} onEdit={(rule) => setCapture({ kind: 'carrier-rule', rule })} onDelete={deleteCarrierRule}/></Suspense>}
        {page === 'settings' && <Suspense fallback={<div className="secondary-page" role="status">Opening settings…</div>}><SettingsPage data={data} syncStatus={syncStatus} unit={data.unitSystem} onUnit={(unitSystem) => updateData((current) => ({ ...current, unitSystem }))} scanRetention={scanRetention} onScanRetention={(days)=>updateData(current=>({...current,settings:{...current.settings,automaticScanDeletionDays:days}}))} onPhotoRetention={(days) => updateData((current) => ({ ...current, settings: { ...current.settings, automaticPhotoDeletionDays: days } }))} onExport={exportBackup} onImport={importBackup} onDelete={deleteAllData} onOpenShared={openSharedPackFromSettings} onPublished={recordSharedPublicationFromSettings}/></Suspense>}
      </>}
    </div>

    <nav className="mobile-nav" aria-label="Mobile navigation"><button className={page === 'workspace' || page === 'steps' ? 'selected' : ''} onClick={() => setPage('workspace')}><ClipboardList size={19}/><span>Plan</span></button><button className={page === 'items' ? 'selected' : ''} onClick={() => setPage('items')}><Package size={19}/><span>Items</span></button><button className={page === 'bags' ? 'selected' : ''} onClick={() => setPage('bags')}><Backpack size={19}/><span>Bags</span></button><button className={page === 'carrier-rules' ? 'selected' : ''} onClick={() => setPage('carrier-rules')}><BookOpen size={19}/><span>Rules</span></button><button className={page === 'settings' ? 'selected' : ''} onClick={() => setPage('settings')}><Settings size={19}/><span>Settings</span></button></nav>

    {capture?.kind === 'item' && <Suspense fallback={<div className="modal-backdrop"><div className="modal" role="status">Opening item editor…</div></div>}><ItemCapture key={capture.item?.id ?? capture.suggestion?.id ?? 'new-item'} initial={capture.item} suggestedItem={capture.suggestion} unit={capture.resumed?.draft.unit??data.unitSystem} resumed={capture.resumed?.draft} resumedPhoto={capture.resumed?.photo} sourceTripId={activeTrip?.id} suggestion={capture.suggestion} existingPhotoUrl={editingPhotoUrl} onClose={()=>void closeItemEditor()} onPhotoStaged={()=>setCapture(null)} onSave={saveItem}/></Suspense>}
    {capture?.kind === 'bag' && <Suspense fallback={<div role="status">Opening bag editor…</div>}><BagCapture key={capture.bag?.id ?? 'new-bag'} initial={capture.bag} unit={data.unitSystem} travellers={activeTrip?.travellers ?? []} onClose={() => setCapture(null)} onSave={saveBag} helpers={{evidence,mmToDisplay,displayToMm,lengthInput,massInput,dimLabel,sourceLabel}} Modal={Modal}/></Suspense>}
    {capture?.kind === 'trip' && <Suspense fallback={<div className="modal-backdrop"><div className="modal" role="status">Opening pack editor…</div></div>}><TripCapture initial={capture.trip} onClose={() => setCapture(null)} onSave={createTrip} onDelete={capture.trip && !capture.trip.sample ? () => void deleteTrip(capture.trip!.id) : undefined} Modal={Modal}/></Suspense>}
    {capture?.kind === 'carrier-rule' && activeTrip && <Suspense fallback={<div className="modal-backdrop"><div className="modal" role="status">Opening carrier record…</div></div>}><CarrierRuleCapture key={capture.rule?.id ?? capture.draft?.fare ?? 'new-carrier-rule'} initial={capture.rule ?? capture.draft} bags={activeContainers} unit={data.unitSystem} onClose={() => setCapture(null)} onSave={saveCarrierRule} helpers={{lengthInput,massInput,dimLabel}} Modal={Modal}/></Suspense>}
  </div>;
}

interface WorkspaceProps {
  requestPlanComparison:(trip:Trip,items:LibraryItem[],containers:Container[],modes:OptimizationMode[])=>{requestId:number;promise:Promise<PackingPlan[]>;cancel:()=>void};
  onWeather:(weather:SavedWeather|undefined)=>void;
  onSeparationRules:(rules:SeparationRule[])=>void;
  onReviewItem:(item:LibraryItem)=>void; onReviewBag:(bag:Container)=>void; onReviewMissing:()=>void;
  onPrintSequence: () => void;
  trip: Trip; data: AppData; containers: Container[]; selectedContainer?: Container; plan: PackingPlan; canvasView: '3d'|'top'|'layers'; layer: number; getPhoto:(id:string)=>Promise<Blob|undefined>; unit: UnitSystem;
  onView: (view:'3d'|'top'|'layers') => void; onLayer: (layer:number) => void; onSelectContainer:(id:string)=>void; onMode:(mode:OptimizationMode)=>void; onAddItem:()=>void; onAddSuggestion:(suggestion:TripSuggestion,item?:LibraryItem)=>void; onAddBag:()=>void; onAddTrip:()=>void; onRemoveEntry:(id:string)=>void; onToggleComplete:(id:string,complete:boolean)=>void; onToggleLock:(placement:Placement)=>void; onUnavailable:(id:string)=>void; onStartSteps:()=>void; onEditTrip:()=>void; onPriority:(entryId:string,priority:ItemPriority)=>void; onAccess:(entryId:string,priority:number)=>void; onTraveller:(entryId:string,travellerId:string)=>void; onAssignment:(entryId:string,containerId:string,compartmentId?:string)=>void; onPackingForm:(entryId:string,packingFormId:string)=>void; onSeparateCopy:(entryId:string)=>void; onQuantity:(entryId:string,quantity:number)=>void;
}

type ChecklistRowActions = Pick<WorkspaceProps, 'onToggleComplete'|'onQuantity'|'onPriority'|'onAccess'|'onTraveller'|'onAssignment'|'onPackingForm'|'onSeparateCopy'|'onUnavailable'|'onRemoveEntry'>;

function Workspace(props: WorkspaceProps) {
  const { trip, data, containers, selectedContainer, plan, canvasView, layer, getPhoto, unit } = props;
  // Stable row actions let unchanged checklist entries skip React reconciliation.
  const latestProps = useRef(props);
  latestProps.current = props;
  const checklistActions = useMemo<ChecklistRowActions>(() => ({
    onToggleComplete:(id,complete)=>latestProps.current.onToggleComplete(id,complete),
    onQuantity:(id,quantity)=>latestProps.current.onQuantity(id,quantity),
    onPriority:(id,priority)=>latestProps.current.onPriority(id,priority),
    onAccess:(id,priority)=>latestProps.current.onAccess(id,priority),
    onTraveller:(id,travellerId)=>latestProps.current.onTraveller(id,travellerId),
    onAssignment:(id,containerId,compartmentId)=>latestProps.current.onAssignment(id,containerId,compartmentId),
    onPackingForm:(id,formId)=>latestProps.current.onPackingForm(id,formId),
    onSeparateCopy:id=>latestProps.current.onSeparateCopy(id),
    onUnavailable:id=>latestProps.current.onUnavailable(id),
    onRemoveEntry:id=>latestProps.current.onRemoveEntry(id),
  }), []);
  const changeSeparationRules = useMemo(() => (rules: SeparationRule[]) => latestProps.current.onSeparationRules(rules), []);
  const planReviewRef = useRef<HTMLElement>(null);
  const separationRulesRef = useRef<HTMLDivElement>(null);
  const visualStageRef = useRef<HTMLDivElement>(null);
  const [separationRulesRequested, setSeparationRulesRequested] = useState(false);
  const [planReviewRequested, setPlanReviewRequested] = useState(false);
  const [canvasRequested, setCanvasRequested] = useState(false);
  const [evidenceReviewOpen, setEvidenceReviewOpen] = useState(false);
  const [evidenceReviewCount, setEvidenceReviewCount] = useState<number>();
  const referencedItemIds = useMemo(() => new Set(trip.entries.map(entry => entry.itemId)), [trip.entries]);
  const itemById = useMemo(() => {
    const byId = new Map<string, LibraryItem>();
    for (const item of data.libraryItems) if (referencedItemIds.has(item.id)) byId.set(item.id, item);
    return byId;
  }, [data.libraryItems, referencedItemIds]);
  const referencedItems = useMemo(() => [...itemById.values()], [itemById]);
  const validEntries = useMemo(() => trip.entries.filter((entry) => itemById.has(entry.itemId)), [trip.entries, itemById]);
  const entryItems = useMemo(() => {
    const items = new Map<string, LibraryItem>();
    for (const entry of validEntries) {
      const item = itemById.get(entry.itemId)!;
      try { items.set(entry.id, packingItem(item, entry.packingFormId)); }
      catch { items.set(entry.id, item); }
    }
    return items;
  }, [validEntries, itemById]);
  const packingFormsByItem = useMemo(() => {
    const forms = new Map<string, ReturnType<typeof packingFormsForSelection>>();
    for (const [id, item] of itemById) forms.set(id, packingFormsForSelection(item));
    return forms;
  }, [itemById]);
  const completed = useMemo(() => new Set(trip.completedInstanceIds), [trip.completedInstanceIds]);
  const unavailableIds = useMemo(() => new Set(trip.unavailableInstanceIds), [trip.unavailableInstanceIds]);
  const separableEntries = useMemo(() => separablePackingEntryIds(trip), [trip.entries, trip.completedInstanceIds, trip.unavailableInstanceIds, trip.lockedPlacements, trip.rejectedPlacements]);
  const placedIds = useMemo(() => new Set(plan.placements.map((placement) => placement.instanceId)), [plan.placements]);
  const unresolved = useMemo(() => plan.excluded.filter((entry) => entry.reason !== 'Marked unavailable for this plan.'), [plan.excluded]);
  const lockedByInstance = useMemo(() => {
    const byInstance = new Map<string, Placement[]>();
    for (const placement of trip.lockedPlacements) {
      const saved = byInstance.get(placement.instanceId);
      if (saved) saved.push(placement);
      else byInstance.set(placement.instanceId, [placement]);
    }
    return byInstance;
  }, [trip.lockedPlacements]);
  const selectedLayerMax = useMemo(() => {
    let highest = 1;
    if (selectedContainer) for (const placement of plan.placements) {
      if (placement.containerId === selectedContainer.id && placement.layer > highest) highest = placement.layer;
    }
    return highest;
  }, [plan.placements, selectedContainer?.id]);
  const totalInstances = useMemo(() => validEntries.reduce((sum, entry) => sum + Math.max(1, entry.quantity), 0), [validEntries]);
  const stepsRemaining = plan.placements.reduce((remaining, placement) => remaining + Number(!completed.has(placement.instanceId)), 0);
  const selectedSummary = plan.summaries.find((summary) => summary.containerId === selectedContainer?.id);
  const boxVolume = selectedSummary?.volumeCapacityMm3??0;
  const volumePercent = boxVolume && selectedSummary ? Math.min(100, selectedSummary.volumeUsedMm3 / boxVolume * 100) : 0;
  const canvasPadding = selectedContainer ? Math.max(selectedContainer.inside.length, selectedContainer.inside.width) * 0.06 : 0;
  const canvasPlaceholder = selectedContainer && <div className="packing-diagram-with-notes"><div className="packing-diagram-deferred" aria-hidden="true" style={{ aspectRatio: `${selectedContainer.inside.length + canvasPadding * 2} / ${selectedContainer.inside.width + canvasPadding * 2}` }}/><ContainerSpaceNotes bag={selectedContainer}/></div>;

  useEffect(() => {
    const section = separationRulesRef.current;
    if (!section || separationRulesRequested) return;
    return observeNearViewport(section, isNearViewport => {
      if (isNearViewport) setSeparationRulesRequested(true);
    });
  }, [separationRulesRequested]);

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

  useEffect(() => {
    const stage = visualStageRef.current;
    if (!stage || canvasRequested) return;
    if (typeof IntersectionObserver === 'undefined') {
      setCanvasRequested(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setCanvasRequested(true);
        observer.disconnect();
      }
    }, { rootMargin: '200px 0px' });
    observer.observe(stage);
    return () => observer.disconnect();
  }, [canvasRequested, selectedContainer?.id]);

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
        <div className="panel-heading"><div><span className="panel-kicker">THE CHECKLIST</span><h2>Items to pack <span className="heading-count">{totalInstances}</span></h2></div><button className="text-button" onClick={props.onAddItem}><Plus size={16}/> Add item</button></div>
        {validEntries.length ? <div className="packing-list">{validEntries.map((entry) => {
          const item = entryItems.get(entry.id) ?? itemById.get(entry.itemId)!;
          const packingForms = packingFormsByItem.get(entry.itemId) ?? [];
          const { itemDone, notPlaced, unavailable, packable, undo } = checklistInstanceState(entry.id, entry.quantity, completed, unavailableIds, placedIds);
          return <PackingChecklistEntry key={entry.id} entry={entry} item={item} packingForms={packingForms} state={{itemDone,notPlaced,unavailable,packable,undo}} canSeparate={separableEntries.has(entry.id)} containers={containers} travellers={trip.travellers} getPhoto={getPhoto} unit={unit} actions={checklistActions}/>;
        })}</div> : <div className="list-empty"><div className="empty-icon"><Package size={22}/></div><strong>Your list is ready for items</strong><span>Add belongings from your library or create your first item.</span><button className="button button-secondary" onClick={props.onAddItem}><Plus size={15}/> Add from my items</button></div>}
        <button className="add-from-library" onClick={props.onAddItem}><Plus size={16}/> Choose from your item library</button>
        <div className="checklist-footnote"><ShieldCheck size={15}/><span>Required items stay visible when they do not fit. Nothing is silently removed.</span></div>
      </section>

      <section className="visual-panel">
        <div className="panel-heading visual-heading"><div><span className="panel-kicker">YOUR BAG, IN PLAN</span><h2>{selectedContainer?.name ?? 'Add a bag'}</h2></div><button className="text-button" onClick={props.onAddBag}><Plus size={16}/> Add bag</button></div>
        {containers.length > 0 && <div className="bag-tabs" role="tablist" aria-label="Bags">{containers.map((bag) => <button role="tab" aria-selected={selectedContainer?.id === bag.id} className={selectedContainer?.id === bag.id ? 'active' : ''} key={bag.id} onClick={() => props.onSelectContainer(bag.id)}><Backpack size={14}/>{bag.name}</button>)}</div>}
        {selectedContainer ? <>
          <div ref={visualStageRef} className="visual-stage">{canvasRequested ? <Suspense fallback={canvasPlaceholder}><PackCanvas container={selectedContainer} plan={plan} items={data.libraryItems} selectedInstanceId={undefined} view={canvasView} layer={canvasView === 'layers' ? layer : undefined}/></Suspense> : canvasPlaceholder}<div className="canvas-caption"><span>GEOMETRIC PREVIEW</span><span>{mmToDisplay(selectedContainer.inside.length,unit)} × {mmToDisplay(selectedContainer.inside.width,unit)} × {mmToDisplay(selectedContainer.inside.height,unit)} {dimLabel(unit)} inside</span></div></div>
          <div className="view-controls"><div className="view-tabs" role="tablist" aria-label="Model view">{(['3d','top','layers'] as const).map((view) => <button role="tab" aria-selected={canvasView === view} className={canvasView === view ? 'active' : ''} key={view} onClick={() => props.onView(view)}>{view === '3d' ? '3D' : view === 'top' ? 'Top view' : 'Layers'}</button>)}</div>{canvasView === 'layers' && <div className="layer-control"><span>Layer</span><input aria-label="Layer" type="range" min="1" max={selectedLayerMax} value={layer} onChange={(event) => props.onLayer(Number(event.target.value))}/><strong>{layer}</strong></div>}</div>
          <div className="bag-summary"><div><span>ITEMS IN THIS BAG</span><strong>{selectedSummary?.itemCount ?? 0}</strong></div><div><span>OCCUPIED VOLUME USED</span><strong>~{Math.round(volumePercent)}<small>%</small></strong></div><div><span>UPPER ITEM WEIGHT</span><strong>{selectedSummary ? gramToDisplay(selectedSummary.usedMassGrams,unit) : '—'}</strong></div><span className="summary-info" title="Volume uses adopted occupied cells or rectangular item bounds. Weight uses the upper saved item values where available; it does not include the bag unless tare is recorded."><CircleHelp size={15}/></span></div>
    <BagWeightNotes containers={containers} plan={plan} trip={trip} unit={unit}/>
          <p className="geometry-note">Estimated occupied cells or rectangular item bounds inside the recorded bag space. It does not simulate closure, soft sides, cushioning, compression or physical stability.</p>
          {plan.warnings.length > 0 && <div className="warning-list">{plan.warnings.map((warning) => <p key={warning}><AlertTriangle size={15}/>{warning}</p>)}</div>}
          {selectedContainer.massLimitGrams && <div className="weight-note"><Weight size={15}/><span>Recorded item weight is compared with {gramToDisplay(selectedContainer.massLimitGrams,unit)}. Bag tare {selectedContainer.tareGrams === undefined ? 'is not entered, so gross weight is not verified' : `of ${gramToDisplay(selectedContainer.tareGrams,unit)} is included`}.</span></div>}
        </> : <div className="bag-empty"><div className="bag-outline"><Backpack size={42}/></div><h3>Start with your bag</h3><p>Enter the usable inside dimensions and opening width. The plan will use them as a rectangular approximation.</p><button className="button button-primary" onClick={props.onAddBag}><Plus size={16}/> Add your first bag</button></div>}
      </section>
    </div>
    <details className="packing-evidence-review" onToggle={event=>{
      const open=event.currentTarget.open;
      setEvidenceReviewOpen(open);
      if(!open)setEvidenceReviewCount(undefined);
    }}>
      <summary><span>Review packing evidence</span><span>{evidenceReviewCount===undefined?'Open to calculate':`${evidenceReviewCount} ${evidenceReviewCount===1?'property':'properties'} to check`}</span></summary>
      {evidenceReviewOpen&&<Suspense fallback={<p role="status">Opening evidence review…</p>}><PackingEvidenceReview key={trip.id} contentOnly onCount={setEvidenceReviewCount} trip={trip} items={data.libraryItems} bags={data.containers} plan={plan} unit={unit} onReview={group=>{
      if(group.kind==='item'){const item=data.libraryItems.find(item=>item.id===group.recordId);if(item)props.onReviewItem(item);}
      else if(group.kind==='container'){const bag=data.containers.find(bag=>bag.id===group.recordId);if(bag)props.onReviewBag(bag);}
      else props.onReviewMissing();
      }}/></Suspense>}
    </details>
    {selectedContainer&&<OpeningEvidenceNotes bag={selectedContainer}/>}
    <StackLoadNotes plan={plan} items={data.libraryItems} unit={unit} containerId={selectedContainer?.id}/>
    <div ref={separationRulesRef}>{separationRulesRequested
      ? <Suspense fallback={<p className="candidate-uncertainty" role="status">Opening separation rules…</p>}><SeparationRules trip={trip} items={data.libraryItems} unit={unit} onChange={changeSeparationRules}/></Suspense>
      : <div className="separation-rules-deferred" aria-hidden="true"/>}</div>
    {Array.isArray(trip.separationRules)&&trip.separationRules.length>0&&<Suspense fallback={<p className="candidate-uncertainty" role="status">Loading separation review…</p>}><SeparationNotes trip={trip} items={data.libraryItems} bags={data.containers} plan={plan} unit={unit}/></Suspense>}
    <section ref={planReviewRef} className="plan-review"><div className="review-heading"><div><span className="panel-kicker">PLAN CHECK</span><h2>Fit and trade-offs</h2></div><span className="review-caption">Deterministic geometric placement · generated on this device</span></div>{planReviewRequested ? <Suspense fallback={<p className="candidate-uncertainty" role="status">Opening approach comparisons…</p>}><PlanReview trip={trip} items={referencedItems} bags={containers} plan={plan} unit={unit} modeCopy={modeCopy} onSelect={props.onMode} requestPlanComparison={props.requestPlanComparison}/></Suspense> : <p className="candidate-uncertainty" role="status" aria-live="polite">Approach comparisons will be prepared when you reach this section.</p>}
      {unresolved.length > 0 && <div className="excluded-list"><strong>Needs a decision</strong>{unresolved.map((entry) => <div key={entry.instanceId}><AlertTriangle size={15}/><span><strong>{entry.name}{entry.required ? ' · required' : ''}</strong><small>{entry.reason}</small></span>{(lockedByInstance.get(entry.instanceId) ?? []).map(saved => <button className="button button-secondary" key={saved.instanceId} onClick={() => completed.has(saved.instanceId) ? props.onToggleComplete(saved.instanceId,false) : props.onToggleLock(saved)}>{completed.has(entry.instanceId) ? `Undo packed for ${entry.name}` : `Unlock ${entry.name}`}</button>)}<button className="text-button" onClick={() => props.onUnavailable(entry.instanceId)}>Remove from plan</button></div>)}</div>}
    </section>
    <div className="plan-trust-note"><Lock size={15}/><span>Locked placements are preserved during replanning. A geometric match is a suggestion, not a guarantee the bag will close.</span></div>
  </main>;
}

interface PackingChecklistEntryProps {
  entry:PackEntry; item:LibraryItem; packingForms:ReturnType<typeof packingFormsForSelection>; state:ChecklistInstanceState; canSeparate:boolean;
  containers:Container[]; travellers:Trip['travellers']; getPhoto:(id:string)=>Promise<Blob|undefined>; unit:UnitSystem; actions:ChecklistRowActions;
}

function sameStringArray(left:string[],right:string[]){return left===right||(left.length===right.length&&left.every((value,index)=>value===right[index]));}
function sameUnavailable(left:ChecklistInstanceState['unavailable'],right:ChecklistInstanceState['unavailable']){
  return left===right||(left.length===right.length&&left.every((value,index)=>value.id===right[index].id&&value.index===right[index].index));
}

const PackingChecklistEntry=memo(function PackingChecklistEntry({entry,item,packingForms,state,canSeparate,containers,travellers,getPhoto,unit,actions}:PackingChecklistEntryProps){
  const {itemDone,notPlaced,unavailable,packable,undo}=state;
  return <article className={`packing-item ${itemDone===entry.quantity?'packed':''}`}>
    <button className={`item-check ${undo?'checked':''}`} disabled={!undo&&packable.length===0} aria-label={undo?`Mark ${item.name} unpacked`:`Mark ${item.name} packed`} onClick={()=> (undo?instanceIds(entry):packable).forEach(id=>actions.onToggleComplete(id,!undo))}>{undo&&<Check size={14}/>}</button>
    {item.photoId?<LocalPhoto photoId={item.photoId} getPhoto={getPhoto} className="workspace-photo" alt="" fallback={<div className={`item-monogram ${item.category}`}><span>{item.name.slice(0,1).toUpperCase()}</span></div>}/>:<div className={`item-monogram ${item.category}`}><span>{item.name.slice(0,1).toUpperCase()}</span></div>}
    <div className="packing-item-copy">
      <div className="packing-item-title"><strong>{item.name}</strong>{entry.quantity>1&&<span>×{entry.quantity}</span>}</div>
      <div className="packing-item-meta"><span>{mmToDisplay(item.dimensions.length,unit)} × {mmToDisplay(item.dimensions.width,unit)} × {mmToDisplay(item.dimensions.height,unit)} {dimLabel(unit)}</span><span className={`evidence-pill ${item.dimensionEvidence.source}`} title={item.dimensionEvidence.note??`${evidenceLabel(item.dimensionEvidence)} confidence`}>{evidenceLabel(item.dimensionEvidence)}</span>{item.massGrams!==undefined&&<span>{item.massEvidence?.source==='estimated'?'~':''}{gramToDisplay(item.massGrams,unit)} {item.massEvidence?sourceLabel(item.massEvidence.source).toLowerCase():'weight'}</span>}</div>
      <div className="entry-quantity-control"><button type="button" aria-label={`Remove one unpacked copy of ${item.name}`} disabled={!canSeparate} onClick={()=>actions.onQuantity(entry.id,entry.quantity-1)}>−</button><span>{entry.quantity} {entry.quantity===1?'copy':'copies'}</span><button type="button" aria-label={`Add copy of ${item.name}`} disabled={entry.quantity>=99} onClick={()=>actions.onQuantity(entry.id,entry.quantity+1)}>+</button></div>
      <div className="entry-controls"><label title="A required item stays prominent when the plan cannot fit it"><input type="checkbox" checked={entry.required} onChange={event=>actions.onPriority(entry.id,event.target.checked?'required':'preferred')}/>Required</label><label title="Prefer an accessible position nearer the top"><input type="checkbox" checked={entry.accessPriority>=4} onChange={event=>actions.onAccess(entry.id,event.target.checked?5:2)}/>Reach first</label>{travellers.length>1&&<select aria-label={`Who is ${item.name} for?`} value={entry.travellerId} onChange={event=>actions.onTraveller(entry.id,event.target.value)}>{travellers.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select>}</div>
      <EntryBagAssignment entry={entry} name={item.name} bags={containers} onChange={(bagId,compartmentId)=>actions.onAssignment(entry.id,bagId,compartmentId)}/>
      {entry.quantity>1&&!(packingForms.length||entry.packingFormId)&&<button type="button" className="text-button separate-packing-copy" disabled={!canSeparate} onClick={()=>actions.onSeparateCopy(entry.id)}>Separate one unpacked copy</button>}
      {(packingForms.length||entry.packingFormId)&&<div className="entry-packing-form"><label><span>Packing form for {item.name}</span><select aria-label={`Packing form for ${item.name}`} value={entry.packingFormId??''} onChange={event=>actions.onPackingForm(entry.id,event.target.value)}><option value="">Original item</option>{entry.packingFormId&&!packingForms.some(form=>form.id===entry.packingFormId)&&<option value={entry.packingFormId}>Missing form · review selection</option>}{packingForms.map(form=><option key={form.id} value={form.id}>{form.name} ({form.kind})</option>)}</select></label><small>Uses this form for all {entry.quantity} in this entry. Changing it keeps packed positions saved and can pause this bag.</small>{entry.quantity>1&&<button type="button" className="text-button separate-packing-copy" disabled={!canSeparate} onClick={()=>actions.onSeparateCopy(entry.id)} title="Separate the last copy only while it has no packed, locked, unavailable or failed-placement record. Earlier copies keep their saved IDs.">Separate one unpacked copy</button>}</div>}
      {itemDone>0&&itemDone<entry.quantity&&<small>{itemDone} of {entry.quantity} packed</small>}{notPlaced&&<small className="fit-warning">Not placed in this plan</small>}
    </div>
    {unavailable.length>0&&<div className="unavailable-item"><span>{unavailable.length} of {entry.quantity} unavailable for this pack.</span>{unavailable.map(({id,index})=><button key={id} className="button button-secondary" onClick={()=>actions.onUnavailable(id)}>Restore {item.name}{entry.quantity>1?' · item '+(index+1):''}</button>)}</div>}
    <button className="quiet-icon" title={`Remove ${item.name} from this pack`} onClick={()=>actions.onRemoveEntry(entry.id)}><Trash2 size={15}/></button>
  </article>;
},(previous,next)=>previous.entry===next.entry&&previous.item===next.item&&previous.packingForms===next.packingForms&&previous.canSeparate===next.canSeparate&&previous.containers===next.containers&&previous.travellers===next.travellers&&previous.getPhoto===next.getPhoto&&previous.unit===next.unit&&previous.actions===next.actions&&previous.state.itemDone===next.state.itemDone&&previous.state.notPlaced===next.state.notPlaced&&previous.state.undo===next.state.undo&&sameStringArray(previous.state.packable,next.state.packable)&&sameUnavailable(previous.state.unavailable,next.state.unavailable));

function EmptyState({ onNew, onSettings }: { onNew:()=>void; onSettings:()=>void }) {
  return <main className="empty-home"><div className="empty-home-art"><div className="empty-case"><span/><span/><span/></div><div className="empty-tag">READY WHEN YOU ARE</div></div><p className="eyebrow">A LITTLE MORE ROOM TO THINK</p><h1>Make space for<br/>what matters.</h1><p>Your packing plans and item library stay on this device. Start with a bag, add a few things, and see a considered way to pack.</p><button className="button button-primary" onClick={onNew}><Plus size={17}/> Create a pack</button><button className="text-button" onClick={onSettings}>Restore a backup</button></main>;
}

function Modal({ title, eyebrow, onClose, children, busy=false }: { title:string; eyebrow:string; onClose:()=>void; children:ReactNode; busy?:boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event)=>{if(!busy&&event.target===event.currentTarget)onClose();}}><section className="modal simple-modal" role="dialog" aria-modal="true"><header className="modal-header"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="icon-button" aria-label="Close" disabled={busy} onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}
