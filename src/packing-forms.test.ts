import {describe,it,expect} from 'vitest';
import {buildPlan} from './optimizer';
import {createInitialData} from './seed';
import {packingFormsError,packingFormKey,packingItem,packingItemForPlacement,packingFormInstruction,canSeparatePackingCopy,separatePackingCopy,changePackingQuantity} from './packing-forms';
import {isValidRejectedPlacement,samePlacementGeometry} from './packing-progress';
import {placementBoxes,shapeKey} from './packing-geometry';
import {measurementFromInput,measurementInput} from './measurement-input';
import type {PackingForm,PackingShape} from './types';

const at='2026-10-01T02:00:00Z',evidence={source:'measured' as const,confidence:1,collectedAt:at};
const modes=['balanced','maximum_capacity','easy_access','fragile_protection'] as const;
function form(patch:Partial<PackingForm>={}):PackingForm{return {id:'folded',name:'Folded sweater',kind:'folded',dimensions:{length:80,width:70,height:20},dimensionEvidence:evidence,preparation:'Fold sleeves inward, then fold once. Keep the whole item within the measured envelope.',reviewedAt:at,maxTopLoadGrams:0,topLoadEvidence:evidence,...patch};}
function fixture(){
 const data=createInitialData(),bag=data.containers[0],item=data.libraryItems[0],trip=data.trips[0];
 bag.id='bag';bag.inside={length:100,width:90,height:30};bag.opening={length:100,width:90};bag.massLimitGrams=500;delete bag.tareGrams;delete bag.packingInterior;delete bag.unavailableSpaces;delete bag.lidClearanceMm;delete bag.lidClearanceEvidence;
 item.id='sweater';item.name='Sweater';item.dimensions={length:200,width:180,height:30};item.flexibility='foldable';item.fragile=false;item.keepUpright=true;item.massGrams=100;item.massRangeGrams={min:90,max:120};delete item.packingShape;delete item.scan;delete item.maxTopLoadGrams;delete item.topLoadEvidence;item.packingForms=[form()];
 trip.containerIds=[bag.id];trip.entries=[{id:'entry',itemId:item.id,travellerId:trip.travellers[0].id,quantity:1,required:true,priority:'required',accessPriority:2}];trip.lockedPlacements=[];trip.completedInstanceIds=[];trip.unavailableInstanceIds=[];trip.rejectedPlacements=[];
 return {bag,item,trip};
}
describe('recorded packing forms',()=>{
 it('uses only the form explicitly selected for this entry in every mode, with unchanged weight and original data',()=>{
  const {bag,item,trip}=fixture(),before=structuredClone(item);
  for(const mode of modes){expect(buildPlan(trip,[item],[bag],mode).placements).toHaveLength(0);trip.entries[0].packingFormId='folded';const plan=buildPlan(trip,[item],[bag],mode);
   expect(plan.placements).toHaveLength(1);expect(plan.placements[0]).toMatchObject({packingFormId:'folded',packingFormKey:packingFormKey(item.packingForms![0]),height:20});expect(plan.summaries[0]).toMatchObject({usedMassGrams:120,volumeUsedMm3:112000});expect(item).toEqual(before);trip.entries[0].packingFormId=undefined;
  }
 });
 it('selects different forms of the same library item for separate entries without altering the library',()=>{
  const {bag,item,trip}=fixture();item.packingForms!.push(form({id:'rolled',name:'Rolled sweater',kind:'rolled',dimensions:{length:40,width:40,height:20}}));trip.entries[0].packingFormId='folded';trip.entries.push({...trip.entries[0],id:'second',packingFormId:'rolled'});bag.inside={length:200,width:150,height:50};bag.opening={length:200,width:150};
  const plan=buildPlan(trip,[item],[bag]);expect(plan.placements).toHaveLength(2);expect(plan.placements.map(p=>p.packingFormId).sort()).toEqual(['folded','rolled']);expect(plan.summaries[0].usedMassGrams).toBe(240);
 });
 it('keeps required exclusions explicit for missing or incompatible forms rather than falling back to original dimensions',()=>{
  const {bag,item,trip}=fixture();trip.entries[0].packingFormId='gone';const missing=buildPlan(trip,[item],[bag]);expect(missing.placements).toEqual([]);expect(missing.excluded[0]).toMatchObject({required:true});expect(missing.excluded[0].reason).toContain('selected packing form is missing');
  trip.entries[0].packingFormId='folded';item.flexibility='rigid';expect(buildPlan(trip,[item],[bag]).excluded[0].reason).toContain('Rigid items');
 });
 it('rejects guessed compression, unreviewed preparation, duplicate IDs, excessive envelopes and malformed strength evidence',()=>{
  const {item}=fixture();expect(packingFormsError(item)).toBeUndefined();
  const bad=[{reviewedAt:''},{preparation:''},{preparation:'\u0001'.repeat(300)},{kind:'squeezed'},{dimensions:{length:NaN,width:70,height:20}},{dimensions:{length:10001,width:70,height:20}},{dimensionEvidence:{...evidence,source:'estimated'}},{maxTopLoadGrams:-1},{topLoadEvidence:undefined},{dimensionEvidence:{...evidence,collectedAt:42}}];
  for(const patch of bad)expect(packingFormsError({...item,packingForms:[{...form(),...patch} as PackingForm]})).toBeDefined();
  expect(packingFormsError({...item,packingForms:[form(),form()]})).toBeDefined();expect(packingFormsError({...item,packingForms:Array.from({length:9},(_,i)=>form({id:String(i)}))})).toBeDefined();
 });
 it('resolves a prepared form to a full envelope while preserving the complete adopted source shape',()=>{
  const {item}=fixture();const cells=Array.from({length:64},(_,i)=>i),solid={id:'00000000-0000-4000-8000-000000000001',target:'item' as const,format:'voxel_solid_v1' as const,units:'millimetres' as const,sourceHash:'a'.repeat(64),sourcePointCount:3000,method:'observed_voxel_shell_fill_v1' as const,resolutionMm:10,grid:{x:4,y:4,z:4},dimensionsMm:{length:40,width:40,height:40},occupiedCells:cells,observedCellCount:56,enclosedCellCount:8,surfaceFaceCount:96,warnings:[]};
  const shape:PackingShape={solid,sourceEnvelopeMm:solid.dimensionsMm,fittedDimensionsMm:solid.dimensionsMm,adoptedAt:at};item.dimensions=solid.dimensionsMm;item.packingShape=shape;const before=structuredClone(item),resolved=packingItem(item,'folded');
  expect(resolved.packingShape).toBeUndefined();expect(resolved.dimensions).toEqual(form().dimensions);expect(item).toEqual(before);expect(shapeKey(item.packingShape)).toBeDefined();
  const placement={instanceId:'e#1',entryId:'e',itemId:item.id,containerId:'bag',x:0,y:0,z:0,length:80,width:70,height:20,rotation:0,layer:1,packingFormId:'folded',packingFormKey:packingFormKey(form())};
  expect(placementBoxes(placement,packingItemForPlacement(item,placement))).toEqual([placement]);expect(packingItemForPlacement(item,{...placement,packingFormKey:'old'})).toBeUndefined();
 });
 it('preserves fragility and upright care and uses independent form-specific load limits, never the original-form limit',()=>{
  const {bag,item,trip}=fixture();bag.inside.height=40;trip.entries[0].packingFormId='folded';trip.entries[0].quantity=2;item.maxTopLoadGrams=900;item.topLoadEvidence=evidence;
  for(const mode of modes)expect(buildPlan(trip,[item],[bag],mode).placements).toHaveLength(1);
  item.packingForms=[form({maxTopLoadGrams:120})];expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(2);expect(packingItem(item,'folded').keepUpright).toBe(true);
  item.fragile=true;expect(packingItem(item,'folded').fragile).toBe(true);expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
 });
 it('still enforces opening clearance, bag weights, unknown masses and bag assignment for selected forms',()=>{
  const {bag,item,trip}=fixture();trip.entries[0].packingFormId='folded';bag.opening.length=60;bag.opening.width=60;expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);
  bag.opening={length:100,width:90};bag.massLimitGrams=119;expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);bag.massLimitGrams=120;expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
  trip.entries[0].containerId='missing';expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);
 });
 it('keeps packed records and completion when selected preparation, dimensions or form choice change',()=>{
  const {bag,item,trip}=fixture();trip.entries[0].packingFormId='folded';trip.lockedPlacements=buildPlan(trip,[item],[bag]).placements;trip.completedInstanceIds=['entry#1'];const before=structuredClone(trip);
  expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
  for(const patch of [{dimensions:{length:79,width:70,height:20}},{preparation:'Roll and secure instead.'},{reviewedAt:'2026-10-01T03:00:00Z'}]){
   const changed={...item,packingForms:[form(patch)]};expect(buildPlan(trip,[changed],[bag]).placements).toHaveLength(0);expect(trip).toEqual(before);
  }
  trip.entries[0].packingFormId=undefined;const choice=structuredClone(trip);expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(0);expect(trip).toEqual(choice);
 });
 it('does not conflate failed placements or same-size locks across original and prepared forms',()=>{
  const {bag,item,trip}=fixture();item.dimensions=form().dimensions;trip.entries[0].packingFormId='folded';const placed=buildPlan(trip,[item],[bag]).placements[0],original={...placed,packingFormId:undefined,packingFormKey:undefined};
  expect(samePlacementGeometry(placed,original)).toBe(false);expect(isValidRejectedPlacement(placed)).toBe(true);expect(isValidRejectedPlacement({...placed,packingFormKey:undefined})).toBe(false);expect(isValidRejectedPlacement({...placed,packingFormId:undefined})).toBe(false);
  trip.rejectedPlacements=[placed];trip.entries[0].packingFormId=undefined;expect(buildPlan(trip,[item],[bag]).placements).toHaveLength(1);
 });
 it('retains exact untouched dimensions, provenance and form identity through units and JSON round trips',()=>{
  const {item}=fixture();const f=form({dimensions:{length:80.12345678,width:70.987654321,height:20.222222222}});item.packingForms=[f];const copied=JSON.parse(JSON.stringify(item));
  for(const axis of ['length','width','height'] as const)expect(measurementFromInput(measurementInput(f.dimensions[axis],25.4),25.4,f.dimensions[axis])).toBe(f.dimensions[axis]);
  expect(packingFormsError(copied)).toBeUndefined();expect(packingFormKey(copied.packingForms[0])).toBe(packingFormKey(f));expect(packingFormInstruction(f)).toContain('original scan is unchanged');
 });
 it('never reduces mass or permits a missing upper mass merely because the envelope shrank',()=>{
  const {bag,item,trip}=fixture();trip.entries[0].packingFormId='folded';delete item.massRangeGrams;delete item.massGrams;expect(packingItem(item,'folded').massGrams).toBeUndefined();expect(buildPlan(trip,[item],[bag]).summaries[0].unweighedCount).toBe(1);
 });
 it('keeps legacy original-form plans deterministic when no forms are recorded',()=>{
  const {bag,item,trip}=fixture();item.dimensions={length:50,width:40,height:20};delete item.packingForms;const first=buildPlan(trip,[item],[bag]);expect(first.placements).toHaveLength(1);expect(first.placements[0].packingFormId).toBeUndefined();expect(buildPlan(trip,[item],[bag]).placements).toEqual(first.placements);
 });
 it('lets untouched copies use different forms without renumbering existing packed copies',()=>{
  const {trip,bag,item}=fixture();trip.entries[0].quantity=2;trip.entries[0].packingFormId='folded';trip.lockedPlacements=buildPlan(trip,[item],[bag]).placements;trip.completedInstanceIds=trip.lockedPlacements.map(p=>p.instanceId);trip.packingCursor='entry#2';const before=structuredClone(trip);
  expect(canSeparatePackingCopy(trip,'entry')).toBe(true);const split=separatePackingCopy(trip,'entry','new-entry');expect(split.entries.map(e=>e.quantity)).toEqual([1,1]);expect(split.lockedPlacements).toEqual(before.lockedPlacements);expect(split.completedInstanceIds).toEqual(before.completedInstanceIds);expect(split.packingCursor).toBe('new-entry#1');expect(trip).toEqual(before);expect(split.entries[1]).toMatchObject({itemId:item.id,packingFormId:'folded',required:true});
  for(const patch of [{completedInstanceIds:['entry#2']},{unavailableInstanceIds:['entry#2']},{rejectedPlacements:[{...before.lockedPlacements[0],instanceId:'entry#2'}]},{lockedPlacements:[{...before.lockedPlacements[0],instanceId:'entry#2'}]}]){
   const marked={...trip,...patch};expect(canSeparatePackingCopy(marked,'entry')).toBe(false);expect(separatePackingCopy(marked,'entry','new-entry')).toBe(marked);
  }
  expect(()=>separatePackingCopy(trip,'entry','entry')).toThrow('distinct');
 });
 it('changes quantity deliberately without removing packed, failed or unavailable copy records',()=>{
  const {trip}=fixture();const two=changePackingQuantity(trip,'entry',2);expect(two.entries[0].quantity).toBe(2);expect(trip.entries[0].quantity).toBe(1);expect(changePackingQuantity(two,'entry',1).entries[0].quantity).toBe(1);
  const packed={...two,completedInstanceIds:['entry#2']};expect(changePackingQuantity(packed,'entry',1)).toBe(packed);expect(changePackingQuantity(trip,'entry',0)).toBe(trip);expect(changePackingQuantity(trip,'entry',5)).toBe(trip);
  const many={...trip,entries:[{...trip.entries[0],quantity:99}]};expect(changePackingQuantity(many,'entry',100)).toBe(many);
 });
});
