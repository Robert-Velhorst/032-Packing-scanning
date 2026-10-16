import { describe, expect, it } from 'vitest';
import type { LibraryItem, PackingShape } from './types';
import { reconcilePackingShapes } from './planner-shape-cache';

const dimensions={length:120,width:100,height:60};
function shape():PackingShape {
  return {adoptedAt:'2026-10-01T00:00:00Z',sourceEnvelopeMm:dimensions,fittedDimensionsMm:dimensions,solid:{
    id:'00000000-0000-4000-8000-000000000001',target:'item',format:'voxel_solid_v1',units:'millimetres',sourceHash:'a'.repeat(64),sourcePointCount:3000,
    method:'observed_voxel_shell_fill_v1',resolutionMm:10,grid:{x:12,y:10,z:6},dimensionsMm:dimensions,occupiedCells:[0,1,2],observedCellCount:3,enclosedCellCount:0,surfaceFaceCount:6,warnings:['fixture'],
  }};
}
const item=(id:string,packingShape?:PackingShape)=>({id,packingShape} as LibraryItem);

describe('planner worker shape cache',()=>{
  it('reuses only deeply identical shape records from the previous plan',()=>{
    const canonical=shape(),first=[item('arch',canonical)],cache=reconcilePackingShapes(first,new Map());
    const clone=structuredClone(canonical),second=[item('arch',clone)],next=reconcilePackingShapes(second,cache);
    expect(second[0].packingShape).toBe(canonical);expect(next.get('arch')).toBe(canonical);

    const changedCells=structuredClone(canonical);changedCells.solid.occupiedCells[1]=7;
    const changed=[item('arch',changedCells)],changedCache=reconcilePackingShapes(changed,next);
    expect(changed[0].packingShape).toBe(changedCells);expect(changedCache.get('arch')).toBe(changedCells);
  });

  it('drops shapes absent from the current plan and distinguishes upright reviews',()=>{
    const canonical=shape(),cache=reconcilePackingShapes([item('arch',canonical),item('second',shape())],new Map());
    expect([...cache.keys()]).toEqual(['arch','second']);
    const reviewed=structuredClone(canonical);reviewed.upright={axis:'height',sign:1,captureId:'capture',sourceHash:'b'.repeat(64),evidence:{source:'user_confirmed',confidence:1,collectedAt:'2026-10-02T00:00:00Z'}};
    const current=[item('arch',reviewed)],next=reconcilePackingShapes(current,cache);
    expect(current[0].packingShape).toBe(reviewed);expect([...next.keys()]).toEqual(['arch']);
  });
});
