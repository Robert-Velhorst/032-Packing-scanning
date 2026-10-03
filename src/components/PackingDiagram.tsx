import { packingItemForPlacement } from '../packing-forms';
import type { Container, LibraryItem, Placement } from '../types';
import { placementBoxes } from '../packing-geometry';
import { containerBlockedBoxes, containerSpaceError } from '../container-space';
import { ContainerSpaceNotes } from './ContainerSpaceNotes';

/** SVG fallback and print diagram share the real planned coordinates with the 3D view. */
export function PackingDiagram({ bag, placements, currentId, numbers, notes=true,items=[] }: { bag: Container; placements: Placement[]; currentId: string; numbers: Record<string, string>; notes?:boolean;items?:LibraryItem[] }) {
  const padding = Math.max(bag.inside.length, bag.inside.width) * 0.06;
  const label = 'Top view of ' + bag.name + '. Numbered occupied projections show planned item positions; the current step has a stronger outline. Amber outlines project recorded unavailable areas; their height is listed below. Blue outlines labelled C1, C2 and so on show recorded usable compartments; names are listed below.';
  const lookup=new Map(items.map(item=>[item.id,item]));
  const visibleOrder = [...placements].sort((a,b) => Number(a.instanceId === currentId) - Number(b.instanceId === currentId));
  return <div className="packing-diagram-with-notes"><svg className="packing-diagram" role="img" aria-label={label} viewBox={`${-padding} ${-padding} ${bag.inside.length + padding * 2} ${bag.inside.width + padding * 2}`}>
    <title>{label}</title>
    <rect x="0" y="0" width={bag.inside.length} height={bag.inside.width} fill="#f5f7f5" stroke="#35483d" strokeWidth="2"/>
    {visibleOrder.map((step) => {const item=packingItemForPlacement(lookup.get(step.itemId),step),boxes=placementBoxes(step,item),anchor=[...boxes].sort((a,b)=>b.length*b.width-a.length*a.width)[0];return <g key={step.instanceId} data-current={step.instanceId === currentId ? "true" : "false"} data-geometry={item?.packingShape?'occupied-cells':'rectangular'}>
      <path d={boxes.map(b=>`M${b.x} ${b.y}h${b.length}v${b.width}h${-b.length}Z`).join(' ')} fill={step.instanceId === currentId ? '#dcefe3' : '#e7eaeb'} stroke="#35483d" strokeWidth={step.instanceId === currentId ? 3 : 1}/>
      <text x={anchor.x+anchor.length/2} y={anchor.y+anchor.width/2} textAnchor="middle" dominantBaseline="central" fill="#172a20" stroke="#fff" strokeWidth="2" paintOrder="stroke" fontSize={Math.max(12, Math.min(step.length, step.width, bag.inside.length * 0.05))} fontWeight="700">{numbers[step.instanceId]}</text>
    </g>;})}
    {!containerSpaceError(bag)&&containerBlockedBoxes(bag).map((space,i)=><rect className="diagram-unavailable-space" key={i} x={space.x} y={space.y} width={space.length} height={space.width} fill="#d7a24d" fillOpacity=".18" stroke="#9b641d" strokeWidth="2" strokeDasharray="6 4"><title>{'name' in space?String(space.name):'Estimated cavity unavailable region'}: {space.z}–{space.z+space.height} mm above the floor; keep free.</title></rect>)}
    {!containerSpaceError(bag)&&bag.compartments?.map((c,index)=><g key={c.id} data-compartment={c.id}><rect x={c.x} y={c.y} width={c.length} height={c.width} fill="none" stroke="#185c8b" strokeWidth="3" strokeDasharray="10 4"><title>{c.name}: usable compartment; floor {c.z} mm, opening {c.opening.length} × {c.opening.width} mm.</title></rect><text x={c.x+4} y={c.y+Math.max(12,bag.inside.width*.045)} fill="#124b72" stroke="#fff" strokeWidth="2" paintOrder="stroke" fontSize={Math.max(12,bag.inside.width*.045)} fontWeight="700">C{index+1}</text></g>)}
    <circle cx="0" cy="0" r={padding * 0.2} fill="#172a20"/>
  </svg>{notes&&<ContainerSpaceNotes bag={bag}/>}</div>;
}
