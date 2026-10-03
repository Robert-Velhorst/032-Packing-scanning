import {recognitionLabels,type ItemRecognition} from '../scanning/recognition';

export function RecognitionReview({result,onChoose,onDismiss}:{result:ItemRecognition;onChoose:(name:string,category:typeof recognitionLabels[number]['category'])=>void;onDismiss:()=>void}){
  return <section className="recognition-review" aria-label="Review item suggestions">
    <h3>Review item suggestions</h3>
    <p>{result.status==='unavailable'?'Item recognition was unavailable. Your size estimate remains available; enter the name yourself.':result.candidates.length?'A local model suggested these labels for the object at the centre of the view. Check that the label matches your item.':'No supported item label met the suggestion threshold. Enter the name yourself.'}</p>
    {result.candidates.map(c=>{const label=recognitionLabels[c.classId];return <div className="recognition-choice" key={c.classId}><span><strong>{label.name}</strong><small>Model score {c.score.toFixed(2)} · not a measure of accuracy</small></span><button type="button" className="button button-secondary" onClick={()=>onChoose(label.name,label.category)}>Use {label.name} name and category</button></div>;})}
    <p>Accepting a label replaces this draft’s name and category. It does not change size, weight, flexibility, fragility or packing constraints. Photos and predictions are not stored by recognition.</p>
    <details><summary>Supported labels and limits</summary><p>Backpack, umbrella, handbag, tie, suitcase, frisbee, skis, snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, cup, fork, knife, spoon, bowl, laptop, computer mouse, remote control, keyboard, mobile phone, book, scissors, teddy bear, hair dryer and toothbrush. Generic labels can be wrong or refer to another object in the view. Clothing, medicines, document types, brands and product dimensions are not identified.</p><p>EfficientDet-Lite0 v1 · on-device CPU inference · one central camera view · no upload. A high score does not establish identity, safety or physical fit.</p></details>
    <button type="button" className="text-button" onClick={onDismiss}>Dismiss suggestions</button>
  </section>;
}
