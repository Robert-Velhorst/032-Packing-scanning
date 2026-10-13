import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useDeviceWorkspace } from './DeviceWorkspace';
import type { ReconstructedInterior } from '../scanning/interior-cavity';
import type { SavedGeometryPreview } from '../scanning/saved-geometry';
import type { PackingInterior, ScanRecord } from '../types';
import { uprightFaces } from '../upright';

const axes=['length','width','height'] as const;
const coordinates=['x','y','z'] as const;
type Face=typeof uprightFaces[number];
const direction=(face:Face):PackingInterior['travelUp']=>({axis:axes.indexOf(face.axis) as 0|1|2,sign:face.sign});

export function InteriorScanReview({record,source,onAdopt}:{record:ScanRecord;source:SavedGeometryPreview;onAdopt:(geometry:ReconstructedInterior,travelUp:PackingInterior['travelUp'])=>void}) {
  const {reconstructSavedInterior}=useDeviceWorkspace().capture;
  const [opening,setOpening]=useState<Face>();
  const [seed,setSeed]=useState([50,50,50]);
  const [reviewed,setReviewed]=useState(false),[floorReviewed,setFloorReviewed]=useState(false);
  const [travel,setTravel]=useState<Face>();
  const [result,setResult]=useState<ReconstructedInterior>();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const active=useRef(true),request=useRef(0);
  useEffect(()=>{active.current=true;return()=>{active.current=false;request.current++;};},[]);
  const invalidate=()=>{request.current++;setResult(undefined);setReviewed(false);setFloorReviewed(false);setTravel(undefined);setBusy(false);setError('');};
  const seedMm=Object.fromEntries(coordinates.map((coordinate,i)=>[coordinate,source.envelope.dimensionsMm[axes[i]]*seed[i]/100])) as {x:number;y:number;z:number};
  const capUnderneath=!!travel&&!!result&&axes.indexOf(travel.axis)===result.cavity.opening.axis&&travel.sign===-result.cavity.opening.sign;
  const reconstruct=async()=>{
    if(!opening||!reviewed||busy)return;
    const token=++request.current;setBusy(true);setError('');setResult(undefined);setFloorReviewed(false);setTravel(undefined);
    try {
      const end=direction(opening);
      const value=await reconstructSavedInterior(record,source,{openingAxis:end.axis,openingSign:end.sign,seedMm});
      if(active.current&&token===request.current){setResult(value);setFloorReviewed(false);setTravel(undefined);}
    }catch(reason){if(active.current&&token===request.current)setError(reason instanceof Error?reason.message:'This interior could not be reconstructed.');}
    finally{if(active.current&&token===request.current)setBusy(false);}
  };
  return <section className="interior-review" aria-label="Review estimated bag cavity">
    <h3>Review an estimated interior</h3>
    <p>Choose the source end through which you pack, then place the blue point in empty space. Source axes are sorted envelope sides, not the bag's travel orientation. Missing walls or an unseen floor prevent reconstruction; recorded sizes stay unchanged.</p>
    <fieldset><legend>Opening end in the original source</legend><div className="interior-face-choices">{uprightFaces.map(face=><button type="button" key={face.letter} aria-pressed={opening?.letter===face.letter} onClick={()=>{invalidate();setOpening(face);}}>Opening {face.letter}<small>{face.label}</small></button>)}</div></fieldset>
    <p>The slices pass through the blue point. Dots show only sampled observations near each slice; an area without dots does not prove it is empty. Select a point in a slice or use the sliders.</p>
    <SeedSlices source={source} seed={seed} result={result} onChange={next=>{invalidate();setSeed(next);}}/>
    <div className="interior-seed-fields">{axes.map((axis,i)=><label className="field" key={axis}><span>Seed {axis} · {seedMm[coordinates[i]].toFixed(2)} mm</span><input aria-label={`Seed ${axis}`} type="range" min="1" max="99" step="1" value={seed[i]} onChange={event=>{invalidate();setSeed(seed.map((value,j)=>i===j?Number(event.target.value):value));}}/></label>)}</div>
    <label className="interior-confirm"><input type="checkbox" checked={reviewed} onChange={event=>{setReviewed(event.target.checked);if(!event.target.checked){request.current++;setResult(undefined);setBusy(false);}}}/><span>I reviewed the opening end and this point lies in empty interior.</span></label>
    <button className="button button-secondary" type="button" disabled={!opening||!reviewed||busy} onClick={()=>void reconstruct()}>{busy?'Reading full interior source…':'Reconstruct estimated cavity'}</button>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {result&&<div className="interior-candidate">
      <p><strong>{result.cavity.freeCells.length.toLocaleString()} free cells</strong> · {(result.cavity.estimatedVolumeMm3/1e6).toFixed(3)} estimated litres. Blue cells show the selected connected component in these slices. Observed walls and other components remain unavailable.</p>
      <p>{result.cavity.sourcePointCount.toLocaleString()} saved source points · {result.cavity.surfaceFaceCount.toLocaleString()} boundary faces. A closed boundary is a geometry check, not proof of physical completeness. The chosen opening is capped for that check; it is not a physical lid.</p>
      {result.cavity.warnings.map(warning=><p className="scan-geometry-caution" key={warning}>{warning}</p>)}
      <fieldset><legend>Source end that faces up during travel</legend><div className="interior-face-choices">{uprightFaces.map(face=><button key={face.letter} type="button" aria-pressed={travel?.letter===face.letter} onClick={()=>{setTravel(face);setFloorReviewed(false);}}>Travel up {face.letter}<small>{face.label}</small></button>)}</div></fieldset>
      <p>The packing view rotates the opening upward and starts at the lowest free floor and smallest free side edges. All reconstructed free cells are retained. This changes the inside dimensions and their corner. Upright items follow the travel end you choose here.</p>
      {capUnderneath&&<p className="scan-geometry-caution" role="status">This travel direction puts the reconstructed opening underneath. Its boundary cap is not an observed supporting lid. Choose another travel-up end or record a physically checked rectangular interior.</p>}
      <label className="interior-confirm"><input type="checkbox" checked={floorReviewed} onChange={event=>setFloorReviewed(event.target.checked)}/><span>I checked the lowest floor, the new inside corner and my recorded restrictions. I also checked the closed travel base and support strength, and my recorded stacking limits apply in both positions. I will check the narrowest opening and physical fit.</span></label>
      <button className="button button-secondary" type="button" disabled={!reviewed||!travel||!floorReviewed||busy||capUnderneath} onClick={()=>{try{onAdopt(result,direction(travel!));setError('');}catch(reason){setError(reason instanceof Error?reason.message:'The cavity could not be adopted.');}}}>Use estimated cavity and its inside dimensions</button>
      <small>Adoption changes this editor draft. Save the bag to apply it; cancel keeps the saved bag. The original scan stays unchanged.</small>
    </div>}
  </section>;
}

const planes=[[0,1,2],[0,2,1],[1,2,0]] as const;
const SeedSlices=memo(function SeedSlices({source,seed,result,onChange}:{source:SavedGeometryPreview;seed:number[];result?:ReconstructedInterior;onChange:(seed:number[])=>void}) {
  const sizes=axes.map(axis=>source.envelope.dimensionsMm[axis]);
  const layers=useMemo(()=>planes.map(([a,b,c])=>{
    const near:number[][]=[],slice=seed[c]*sizes[c]/100;
    const tolerance=result?result.cavity.cellSizeMm[axes[c]]/2:Math.max(5,Math.max(...sizes)/46)/2;
    for(let i=0;i<source.pointsMm.length;i+=4)if(Math.abs(source.pointsMm[i+c]-slice)<=tolerance)near.push([source.pointsMm[i+a],source.pointsMm[i+b]]);
    const cells:number[][]=[];
    if(result){const {grid,cellSizeMm}=result.cavity,gridSides=[grid.x,grid.y,grid.z],cellSides=axes.map(axis=>cellSizeMm[axis]),layer=Math.min(gridSides[c]-1,Math.floor(slice/cellSides[c]));
      for(const cell of result.cavity.freeCells){const xyz=[cell%grid.x,Math.floor(cell/grid.x)%grid.y,Math.floor(cell/(grid.x*grid.y))];if(xyz[c]===layer)cells.push([xyz[a]*cellSides[a],xyz[b]*cellSides[b],cellSides[a],cellSides[b]]);}}
    return {near,cells};
  }),[source,seed,result]);
  return <div className="interior-slices">{planes.map(([a,b,c],i)=>{
    const [w,h]=[sizes[a],sizes[b]],margin=Math.max(w,h)*.06;
    return <figure key={i}><figcaption>{axes[a]} × {axes[b]} · slice at {axes[c]} {(seed[c]*sizes[c]/100).toFixed(1)} mm. {uprightFaces[a*2].letter} is right; {uprightFaces[b*2].letter} is down; opposite ends are left and up.</figcaption>
      <svg role="img" aria-label={`Interior ${axes[a]} by ${axes[b]} seed slice`} viewBox={`${-margin} ${-margin} ${w+2*margin} ${h+2*margin}`} onClick={event=>{
        const matrix=event.currentTarget.getScreenCTM();if(!matrix)return;const point=new DOMPoint(event.clientX,event.clientY).matrixTransform(matrix.inverse());
        const next=[...seed];next[a]=Math.max(1,Math.min(99,Math.round(point.x/w*100)));next[b]=Math.max(1,Math.min(99,Math.round(point.y/h*100)));onChange(next);
      }}><rect width={w} height={h} fill="#f4f6f5" stroke="#65746b" strokeWidth={margin/8}/>{layers[i].cells.map(([x,y,cw,ch],j)=><rect key={j} x={x} y={y} width={cw} height={ch} fill="#79b9d5" opacity=".65"/>)}{layers[i].near.map(([x,y],j)=><circle key={j} cx={x} cy={y} r={margin/9} fill="#23573f" opacity=".65"/>)}<path d={`M ${w*seed[a]/100-margin/2} ${h*seed[b]/100} h ${margin} M ${w*seed[a]/100} ${h*seed[b]/100-margin/2} v ${margin}`} stroke="#075b9c" strokeWidth={margin/7}/></svg>
    </figure>;
  })}</div>;
});
