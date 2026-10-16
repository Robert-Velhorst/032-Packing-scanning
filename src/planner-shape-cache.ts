import type { Evidence, LibraryItem, PackingShape } from './types';

const sameDimensions=(left:{length:number;width:number;height:number},right:{length:number;width:number;height:number})=>
  left.length===right.length&&left.width===right.width&&left.height===right.height;
const sameEvidence=(left:Evidence,right:Evidence)=>
  left===right||!!left&&!!right&&left.source===right.source&&left.confidence===right.confidence&&left.collectedAt===right.collectedAt&&left.note===right.note;
function sameShape(left:PackingShape,right:PackingShape):boolean {
  if(left===right)return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object'||!left.solid||!right.solid||!left.sourceEnvelopeMm||!right.sourceEnvelopeMm||!left.fittedDimensionsMm||!right.fittedDimensionsMm)return false;
  const a=left.solid,b=right.solid;
  if(!a||!b||left.adoptedAt!==right.adoptedAt||!sameDimensions(left.sourceEnvelopeMm,right.sourceEnvelopeMm)
    ||!sameDimensions(left.fittedDimensionsMm,right.fittedDimensionsMm))return false;
  const au=left.upright,bu=right.upright;
  if(au!==bu&&(!au||!bu||au.axis!==bu.axis||au.sign!==bu.sign||au.captureId!==bu.captureId||au.sourceHash!==bu.sourceHash||!sameEvidence(au.evidence,bu.evidence)))return false;
  if(!a.grid||!b.grid||!a.dimensionsMm||!b.dimensionsMm||a.id!==b.id||a.target!==b.target||a.format!==b.format||a.units!==b.units||a.sourceHash!==b.sourceHash
    ||a.sourcePointCount!==b.sourcePointCount||a.method!==b.method||a.resolutionMm!==b.resolutionMm
    ||a.grid.x!==b.grid.x||a.grid.y!==b.grid.y||a.grid.z!==b.grid.z||!sameDimensions(a.dimensionsMm,b.dimensionsMm)
    ||a.observedCellCount!==b.observedCellCount||a.enclosedCellCount!==b.enclosedCellCount||a.surfaceFaceCount!==b.surfaceFaceCount
    ||!Array.isArray(a.occupiedCells)||!Array.isArray(b.occupiedCells)||a.occupiedCells.length!==b.occupiedCells.length
    ||!Array.isArray(a.warnings)||!Array.isArray(b.warnings)||a.warnings.length!==b.warnings.length)return false;
  for(let index=0;index<a.occupiedCells.length;index++)if(a.occupiedCells[index]!==b.occupiedCells[index])return false;
  for(let index=0;index<a.warnings.length;index++)if(a.warnings[index]!==b.warnings[index])return false;
  return true;
}

/** Reuse only structurally equivalent adopted geometry; keep cache size tied to the current plan. */
export function reconcilePackingShapes(items:LibraryItem[],previous:Map<string,PackingShape>):Map<string,PackingShape> {
  const current=new Map<string,PackingShape>();
  for(const item of items){
    const shape=item.packingShape;if(!shape)continue;
    const prior=previous.get(item.id),reusable=prior&&sameShape(prior,shape)?prior:shape;
    item.packingShape=reusable;
    current.set(item.id,reusable);
  }
  return current;
}
