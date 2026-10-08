import type {ItemCategory} from '../types.ts';

export const recognitionModel = 'efficientdet_lite0_metadata_v1';
export const recognitionHash = '2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b';
export const recognitionLabels: Readonly<Record<number, {name:string;category:ItemCategory}>> = {
  26:{name:'Backpack',category:'accessories'},27:{name:'Umbrella',category:'accessories'},30:{name:'Handbag',category:'accessories'},31:{name:'Tie',category:'clothing'},32:{name:'Suitcase',category:'accessories'},
  33:{name:'Frisbee',category:'accessories'},34:{name:'Skis',category:'accessories'},35:{name:'Snowboard',category:'accessories'},36:{name:'Sports ball',category:'accessories'},37:{name:'Kite',category:'accessories'},38:{name:'Baseball bat',category:'accessories'},39:{name:'Baseball glove',category:'accessories'},40:{name:'Skateboard',category:'accessories'},41:{name:'Surfboard',category:'accessories'},42:{name:'Tennis racket',category:'accessories'},
  43:{name:'Bottle',category:'accessories'},46:{name:'Cup',category:'accessories'},47:{name:'Fork',category:'accessories'},48:{name:'Knife',category:'accessories'},49:{name:'Spoon',category:'accessories'},50:{name:'Bowl',category:'accessories'},
  72:{name:'Laptop',category:'electronics'},73:{name:'Computer mouse',category:'electronics'},74:{name:'Remote control',category:'electronics'},75:{name:'Keyboard',category:'electronics'},76:{name:'Mobile phone',category:'electronics'},
  83:{name:'Book',category:'other'},86:{name:'Scissors',category:'accessories'},87:{name:'Teddy bear',category:'other'},88:{name:'Hair dryer',category:'electronics'},89:{name:'Toothbrush',category:'toiletries'},
};
export interface RecognitionCandidate {classId:number;score:number;}
export interface ItemRecognition {version:1;model:typeof recognitionModel;modelSha256:typeof recognitionHash;source:'camera_center_square';status:'complete'|'unavailable';candidates:RecognitionCandidate[];}

/** Optional suggestions never become measurement or handling evidence. No arbitrary native labels. */
export function parseItemRecognition(value:unknown):ItemRecognition {
  const unavailable:ItemRecognition={version:1,model:recognitionModel,modelSha256:recognitionHash,source:'camera_center_square',status:'unavailable',candidates:[]};
  if(!value||typeof value!=='object'||Array.isArray(value))return unavailable;
  const r=value as Record<string,unknown>;
  if(Object.keys(r).some(k=>!['version','model','modelSha256','source','status','candidates'].includes(k))||r.version!==1||r.model!==recognitionModel||r.modelSha256!==recognitionHash||r.source!=='camera_center_square'||!['complete','unavailable'].includes(String(r.status))||!Array.isArray(r.candidates)||r.candidates.length>3)return unavailable;
  const ids=new Set<number>();let previous=1;
  for(const c of r.candidates){
    if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).length!==2||!Number.isInteger(c.classId)||!recognitionLabels[c.classId]||typeof c.score!=='number'||!Number.isFinite(c.score)||c.score<0.55||c.score>previous||c.score>1||ids.has(c.classId))return unavailable;
    previous=c.score;ids.add(c.classId);
  }
  if(r.status==='unavailable'&&r.candidates.length)return unavailable;
  return {...unavailable,status:r.status as ItemRecognition['status'],candidates:r.candidates.map(c=>({classId:c.classId,score:c.score}))};
}
