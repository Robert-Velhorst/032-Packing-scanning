import type { Container } from '../types';
import { containerSpaceError } from '../container-space';
import { interiorGeometry, interiorSupportError, interiorTravelLabel } from '../packing-interior';

export function ContainerSpaceNotes({bag}:{bag:Container}) {
  const error=containerSpaceError(bag);
  if(error)return <p className="container-space-notes" role="alert">Bag space records need correction: {error}</p>;
  const spaces=bag.unavailableSpaces??[],lid=bag.lidClearanceMm??0;
  const model=bag.packingInterior;
  if(!spaces.length&&!lid&&!model&&!bag.compartments)return null;
  const show=(value:number)=>Number(value.toFixed(2));
  return <aside className={`container-space-notes${!spaces.length&&!lid&&!model?' compartment-only':''}`} aria-label={`Space records in ${bag.name}`}>{(spaces.length>0||lid>0||model)&&<strong>Keep free · amber areas</strong>}
    {model&&<><p>Adopted estimated scan cavity · {(interiorGeometry(model).surface.volumeMm3/1e6).toFixed(3)} litres before recorded restrictions. The reviewed opening faces up in this packing view; the {interiorTravelLabel(model)} end faces up during travel. All heights of unavailable cells are projected in the top diagram.</p><p>The corner is at the smallest free side edges and lowest free floor. Static support and recorded stacking limits are checked separately with the opening up and with the reviewed travel end up. The closed base and applicable limits need traveller review; support strength and physical completeness remain unverified. Rotation between these positions, impacts, balance and securing are not simulated. Source {model.cavity.id} · {model.cavity.sourcePointCount.toLocaleString()} original points.</p>{interiorSupportError(model)&&<p role="status">{interiorSupportError(model)}</p>}</>}
    {lid>0&&<p>{show(lid)} mm below the lid across the whole bag · {bag.lidClearanceEvidence?.source.replace('_',' ')}.</p>}
    {spaces.map(space=><p key={space.id}><strong>{space.name}:</strong> {show(space.length)} × {show(space.width)} × {show(space.height)} mm, starting {show(space.x)} mm from left, {show(space.y)} mm from front, {show(space.z)} mm above floor · {space.evidence.source.replace('_',' ')}.</p>)}
    {bag.compartments&&<section className="compartment-notes"><strong>Usable compartments · blue outlines</strong><p>Only the recorded areas are used. Names match the checklist and steps; all positions use the bag’s inside corner.</p>{bag.compartments.map((c,index)=><p key={c.id}><strong>C{index+1} · {c.name}:</strong> {show(c.length)} × {show(c.width)} × {show(c.height)} mm, starting {show(c.x)} / {show(c.y)} / {show(c.z)} mm from the bag corner. Top opening {show(c.opening.length)} × {show(c.opening.width)} mm · {c.evidence.source.replace('_',' ')}.{c.massLimitGrams!==undefined&&` Contents limit ${show(c.massLimitGrams)} g · ${c.massLimitEvidence?.source.replace('_',' ')}.`}{c.allowedCategories&&` Eligible categories: ${c.allowedCategories.join(', ')}.`} Access and supporting bases reviewed {new Date(c.supportEvidence.collectedAt).toLocaleDateString()}.</p>)}<small>Independent access and closed bases are traveller-reviewed assumptions. Automatic pocket detection, strength and physical fit remain unverified.</small></section>}
    {(spaces.length>0||lid>0||model)&&<small>Unavailable regions are kept free. Their tops are not assumed to support weight. Check boundaries, the opening and closure physically.</small>}
  </aside>;
}
