import { interiorTravelLabel } from './packing-interior.ts';
import type { Container, LibraryItem, PackingShape, UprightDirection } from './types.ts';

export const uprightFaces = [
  {letter:'A',axis:'length',sign:1,label:'length end'},
  {letter:'B',axis:'length',sign:-1,label:'opposite length end'},
  {letter:'C',axis:'width',sign:1,label:'width end'},
  {letter:'D',axis:'width',sign:-1,label:'opposite width end'},
  {letter:'E',axis:'height',sign:1,label:'height end'},
  {letter:'F',axis:'height',sign:-1,label:'opposite height end'},
] as const;

export function uprightRecordError(shape:PackingShape):string|undefined {
  const record=shape.upright;
  if(record===undefined)return;
  if(!record||!shape.solid||!uprightFaces.some(face=>face.axis===record.axis&&face.sign===record.sign)
    ||record.captureId!==shape.solid.id||record.sourceHash!==shape.solid.sourceHash
    ||!record.evidence||record.evidence.source!=='user_confirmed'
    ||!Number.isFinite(record.evidence.confidence)||record.evidence.confidence<0||record.evidence.confidence>1
    ||typeof record.evidence.collectedAt!=='string'||!Number.isFinite(Date.parse(record.evidence.collectedAt))) {
    return 'The upright direction record is invalid or belongs to another source. Review the top face again. Saved packed positions remain unchanged.';
  }
}

export function confirmedUpright(shape:PackingShape,face:Pick<UprightDirection,'axis'|'sign'>,at=new Date().toISOString()):UprightDirection {
  const record:UprightDirection={...face,captureId:shape.solid.id,sourceHash:shape.solid.sourceHash,
    evidence:{source:'user_confirmed',confidence:1,collectedAt:at,note:'Traveller selected the source end that must face upward. This is a handling confirmation, not sensor verification or proof of physical fit.'}};
  if(uprightRecordError({...shape,upright:record}))throw Error('Choose a valid top face for this source.');
  return record;
}

export function uprightInstruction(item:Pick<LibraryItem,'keepUpright'|'packingShape'>,bag?:Pick<Container,'packingInterior'>):string {
  if(!item.keepUpright)return '';
  const target=bag?.packingInterior?" The item's top must point towards the bag's "+interiorTravelLabel(bag.packingInterior)+" end in this packing view; that end was reviewed as facing up during travel.":'';
  const shape=item.packingShape;
  if(!shape)return 'Keep the recorded height upright. Confirm the real top before packing.'+target;
  if(!shape.upright)return 'Upright direction has not been reviewed. The plan uses the recorded height as the item top; check the real top before packing.'+target;
  if(uprightRecordError(shape))return 'The upright direction needs correction before relying on this plan.';
  const face=uprightFaces.find(face=>face.axis===shape.upright!.axis&&face.sign===shape.upright!.sign)!;
  return `Keep face ${face.letter} (${face.label}) facing up. Traveller-confirmed direction; confirm the real item matches the reviewed shape.`+target;
}

export function uprightTag(item:Pick<LibraryItem,'keepUpright'|'packingShape'>):string {
  if(!item.packingShape)return 'Keep upright';
  if(!item.packingShape.upright||uprightRecordError(item.packingShape))return 'Upright direction needs review';
  const face=uprightFaces.find(face=>face.axis===item.packingShape!.upright!.axis&&face.sign===item.packingShape!.upright!.sign)!;
  return `Keep upright · face ${face.letter}`;
}
