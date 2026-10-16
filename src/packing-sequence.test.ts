import { describe, expect, it } from 'vitest';
import { createInitialData } from './seed';
import { buildPlan } from './optimizer';
import { createPackingStepRelationIndex, nextUnpackedStep, orderPackingSteps, packingStepPreview, packingStepRelation, resumePackingStep } from './packing-sequence';
import type { PackingShape } from './types';

const solidShape = (): PackingShape => {
  const date='2026-10-01T00:00:00Z',grid={x:12,y:10,z:6},occupiedCells:number[]=[],directions=[[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]];
  const inside=(x:number,y:number,z:number)=>x>=0&&x<grid.x&&y>=0&&y<grid.y&&z>=0&&z<grid.z;
  let observedCellCount=0,surfaceFaceCount=0;
  for(let z=0;z<grid.z;z++)for(let y=0;y<grid.y;y++)for(let x=0;x<grid.x;x++)if(inside(x,y,z)){
    occupiedCells.push(x+grid.x*(y+grid.y*z));
    const exposed=directions.filter(([dx,dy,dz])=>!inside(x+dx!,y+dy!,z+dz!)).length;
    surfaceFaceCount+=exposed;if(exposed)observedCellCount++;
  }
  const dimensionsMm={length:120,width:100,height:60};
  return {adoptedAt:date,sourceEnvelopeMm:dimensionsMm,fittedDimensionsMm:dimensionsMm,solid:{id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:3000,method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid,dimensionsMm,occupiedCells,observedCellCount,enclosedCellCount:occupiedCells.length-observedCellCount,surfaceFaceCount,warnings:[]}};
};

describe('packing sequence', () => {
  const data = structuredClone(createInitialData());
  const plan = buildPlan(data.trips[0], data.libraryItems, data.containers);
  const ordered = orderPackingSteps(plan.placements, data.containers);
  it('orders physical support heights ahead of old layer labels without modifying saved coordinates', () => {
    const bottom = { ...ordered[0], z: 0, layer: 8 }, top = { ...ordered[1], z: 50, layer: 1 };
    const source = [top, bottom];
    expect(orderPackingSteps(source, data.containers)).toEqual([bottom, top]);
    expect(source).toEqual([top, bottom]);
  });
  it('resumes an explicit saved step, including packed steps, and handles removed cursors', () => {
    expect(resumePackingStep(ordered, ordered[1].instanceId, [ordered[1].instanceId])).toBe(1);
    expect(resumePackingStep(ordered, 'removed-item', [ordered[0].instanceId])).toBe(1);
    expect(resumePackingStep([], undefined, [])).toBe(0);
    expect(resumePackingStep(ordered, undefined, ordered.map((step) => step.instanceId))).toBe(0);
  });
  it('advances from the new plan order when a previously last item becomes an earlier packed lock', () => {
    const [a,b,c]=ordered,newOrder=[c,a,b];
    expect(nextUnpackedStep(newOrder,c.instanceId,[c.instanceId])).toBe(1);
    expect(newOrder[nextUnpackedStep(newOrder,c.instanceId,[c.instanceId,a.instanceId])].instanceId).toBe(b.instanceId);
  });
  it('returns to a skipped unpacked item and finishes only when none remains', () => {
    const [a,b,c]=ordered,steps=[a,b,c];
    expect(nextUnpackedStep(steps,c.instanceId,[a.instanceId,c.instanceId])).toBe(1);
    expect(nextUnpackedStep(steps,'removed',[a.instanceId])).toBe(1);
    expect(nextUnpackedStep(steps,c.instanceId,steps.map(p=>p.instanceId))).toBe(-1);
    expect(nextUnpackedStep([],c.instanceId,[])).toBe(-1);
  });
  it('shows current and earlier planned positions plus actual confirmations, never other bags or future unpacked items', () => {
    const other = { ...ordered[1], containerId: 'another-bag', instanceId: 'other' };
    const source = [...ordered, other];
    expect(packingStepPreview(source, 0, [])).toEqual([ordered[0]]);
    expect(packingStepPreview(source, 0, [ordered[2].instanceId, other.instanceId])).toEqual([ordered[0], ordered[2]]);
    const completed=[ordered[2].instanceId,other.instanceId];expect(packingStepPreview(source,0,completed,new Set(completed))).toEqual([ordered[0],ordered[2]]);
    expect(packingStepPreview(source, 99, [])).toEqual([]);
  });
  it('describes only geometrically overlapping support in the same bag', () => {
    const support = { ...ordered[0], x: 0, y: 0, z: 0, height: 25, length: 100, width: 100 };
    const current = { ...ordered[1], x: 0, y: 0, z: 25, length: 50, width: 50 };
    const relation = packingStepRelation(current, [support, current], data.libraryItems);
    const index = createPackingStepRelationIndex([support,current],data.libraryItems);
    expect(packingStepRelation(current,[support,current],data.libraryItems,undefined,index)).toBe(relation);
    expect(relation).toContain(data.libraryItems.find((item) => item.id === support.itemId)!.name);
    expect(relation).toContain('planned position');
    expect(packingStepRelation(current, [{ ...support, x: 500 }], data.libraryItems)).toContain('25 mm above');
    expect(packingStepRelation(current, [{ ...support, containerId: 'other' }], data.libraryItems)).toContain('25 mm above');
  });
  it('keeps shaped supports in the indexed relation candidates', () => {
    const shape=solidShape(),support={...ordered[0],instanceId:'shaped#1',entryId:'shaped',itemId:'shaped',x:0,y:0,z:0,length:120,width:100,height:60};
    const item={...data.libraryItems[0],id:'shaped',name:'Shaped support',dimensions:shape.fittedDimensionsMm,packingShape:shape};
    const current={...ordered[1],instanceId:'upper#1',entryId:'upper',itemId:'upper',x:50,y:0,z:60,length:20,width:20,height:10};
    const placements=[support,current],items=[...data.libraryItems,item],index=createPackingStepRelationIndex(placements,items);
    const expected=packingStepRelation(current,placements,items),indexed=packingStepRelation(current,placements,items,undefined,index);
    expect(indexed).toBe(expected);
    expect(indexed).toContain('Shaped support');
  });
});
