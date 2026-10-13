"""Offline model execution proof, separate from Android camera acceptance.
Run in an isolated Python environment with ai-edge-litert, numpy, Pillow.
Fixtures must already be downloaded from the recorded public source URLs.
"""
from pathlib import Path
import hashlib
import json
import sys
import numpy as np
from PIL import Image
from ai_edge_litert.interpreter import Interpreter

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / 'android/app/src/main/assets/recognition/efficientdet-lite0.tflite'
HASH = '2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b'
ALLOWED = {26, 27, 30, 31, 32, *range(33, 44), 46, 47, 48, 49, 50, 72, 73, 74, 75, 76, 83, 86, 87, 88, 89}

def candidates(boxes, classes, scores, count):
    selected = []
    for i in range(int(count)):
        top, left, bottom, right = boxes[i]
        label, score = int(classes[i]), float(scores[i])
        area = (min(1, bottom) - max(0, top)) * (min(1, right) - max(0, left))
        if label in ALLOWED and score >= .55 and top <= .5 <= bottom and left <= .5 <= right and area >= .03:
            selected.append({'classId': label, 'score': score})
    selected.sort(key=lambda c: (-c['score'], c['classId']))
    unique = []
    for c in selected:
        if c['classId'] not in [x['classId'] for x in unique]: unique.append(c)
    return unique[:3]

def main():
    assert MODEL.stat().st_size == 4563519 and hashlib.sha256(MODEL.read_bytes()).hexdigest() == HASH
    interpreter = Interpreter(model_path=str(MODEL), num_threads=2)
    interpreter.allocate_tensors()
    inputs, outputs = interpreter.get_input_details(), interpreter.get_output_details()
    assert len(inputs) == 1 and inputs[0]['dtype'] == np.uint8 and inputs[0]['shape'].tolist() == [1, 320, 320, 3]
    assert [d['shape'].tolist() for d in outputs] == [[1, 25, 4], [1, 25], [1, 25], [1]]
    assert all(d['dtype'] == np.float32 for d in outputs)
    fixtures = [
        ('tennis', '000000000431.jpg', 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/model_maker/python/vision/object_detector/testdata/coco_data/images/000000000431.jpg', [42]),
        ('cat', 'cat.png', 'https://raw.githubusercontent.com/tensorflow/examples/master/lite/examples/object_detection/android/app/src/androidTest/assets/cat1.png', []),
        ('blank', None, None, []),
    ]
    results = []
    for name, filename, url, expected in fixtures:
        source = None
        if filename:
            file = ROOT / '.local-tools/vision' / filename
            source = hashlib.sha256(file.read_bytes()).hexdigest()
            image = Image.open(file).convert('RGB')
            w, h = image.size
            side = min(w, h) * .85
            image = image.crop(((w-side)/2, (h-side)/2, (w+side)/2, (h+side)/2)).resize((320, 320), Image.Resampling.NEAREST)
            pixels = np.array(image, dtype=np.uint8)[None]
        else: pixels = np.full((1, 320, 320, 3), 128, dtype=np.uint8)
        pixel_hash = hashlib.sha256(pixels.tobytes()).hexdigest()
        interpreter.set_tensor(inputs[0]['index'], pixels)
        interpreter.invoke()
        boxes, classes, scores, count = [interpreter.get_tensor(d['index']) for d in outputs]
        proposals = candidates(boxes[0], classes[0], scores[0], count[0])
        assert [c['classId'] for c in proposals] == expected, (name, proposals)
        results.append({'name': name, 'sourceUrl': url, 'sourceSha256': source, 'rgbInputSha256': pixel_hash,
                        'candidates': proposals, 'boxes': boxes[0].tolist(), 'classes': classes[0].tolist(), 'scores': scores[0].tolist(), 'count': float(count[0])})
        pixels.fill(0)
    report = {'modelSha256': HASH, 'runtime': 'Python LiteRT 2.2.0 CPU on Windows; Android runtime/camera not executed', 'fixtures': results}
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / '.local-tools/vision/model-verification.json'
    target.write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'modelSha256': HASH, 'fixtures': [{'name': f['name'], 'candidates': f['candidates']} for f in results]}))

if __name__ == '__main__': main()
