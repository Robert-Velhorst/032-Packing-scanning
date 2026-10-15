import { lazy, Suspense, useState } from 'react';
import { confirmedUpright, uprightFaces } from '../upright';
import type { PackingShape, UprightDirection } from '../types';

type Face = typeof uprightFaces[number];
const initialFace=(shape:PackingShape)=>uprightFaces.find(face=>face.axis===shape.upright?.axis&&face.sign===shape.upright.sign)??uprightFaces[4];
const ShapeDirectionView=lazy(()=>import('./ShapeDirectionView').then(module=>({default:module.ShapeDirectionView})));

export function UprightReview({shape,keepUpright,onChange}:{shape:PackingShape;keepUpright:boolean;onChange:(record:UprightDirection|undefined)=>void}) {
  const [face,setFace]=useState<Face>(()=>initialFace(shape));
  const [open,setOpen]=useState(keepUpright&&!shape.upright);
  const [uprightView,setUprightView]=useState(false);
  const confirmed=shape.upright?.axis===face.axis&&shape.upright.sign===face.sign;
  const stored=initialFace(shape);
  function choose(next:Face){setFace(next);if(shape.upright&&(next.axis!==shape.upright.axis||next.sign!==shape.upright.sign))onChange(undefined);}
  return <div className="upright-review" aria-label="Upright direction review">
    <h4>Which end must face up?</h4>
    <p role="status">{shape.upright?`Face ${stored.letter} (${stored.label}) · traveller confirmed ${new Date(shape.upright.evidence.collectedAt).toLocaleString()}.`:'Top direction has not been reviewed. The scan axes do not identify the real top.'}{!keepUpright&&' Keep upright is off, so the plan may rotate this item.'}</p>
    <button className="button button-secondary" type="button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Close direction review':'Review top direction'}</button>
    {open&&<>
      <p>Match a letter to the real end that must face upward during travel. Rotate the estimated shape or use the source-face diagrams. This does not verify stability, scan completeness or fit. Recheck the recorded stacking limit when changing the top face.</p>
      <div className="surface-view-switch" aria-label="Direction preview frame"><button type="button" aria-pressed={!uprightView} onClick={()=>setUprightView(false)}>Recorded shape</button><button type="button" aria-pressed={uprightView} onClick={()=>setUprightView(true)}>Selected end facing up</button></div>
      <Suspense fallback={<p role="status">Opening direction preview…</p>}><ShapeDirectionView shape={shape} face={face} upright={uprightView}/></Suspense>
      <div className="upright-face-options" role="group" aria-label="Choose the end that must face up">{uprightFaces.map(option=><button type="button" key={option.letter} aria-label={`Choose ${option.letter}: ${option.label} to face up`} aria-pressed={face.letter===option.letter} onClick={()=>choose(option)}><strong>{option.letter}</strong><span>{option.label}</span></button>)}</div>
      <p>The selected end is <strong>{face.letter} · {face.label}</strong>. Confirm it matches the real item's top; selecting a letter alone does not save a review.</p>
      <button className="button button-primary" type="button" onClick={()=>onChange(confirmedUpright(shape,face))}>Confirm {face.letter} must face up</button>
      {confirmed&&<p className="reconstruction-summary">Direction confirmed in this draft. Save changes to keep it on this device.</p>}
      {shape.upright&&<button className="button button-secondary" type="button" onClick={()=>onChange(undefined)}>Clear upright review</button>}
    </>}
  </div>;
}
