"""Hosted exact-source binding and owned bitmap controls for an application UI helper."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

root=Path.cwd();out=Path(os.environ['RUNNER_TEMP'])/'packing-photo-geometry';out.mkdir(exist_ok=True)
def snapshot():
    records={}
    for item in subprocess.check_output(['git','ls-files','--stage','-z']).split(b'\0'):
        if not item:continue
        meta,name=item.split(b'\t',1);mode,blob,stage=meta.decode().split();name=name.decode()
        raw=os.readlink(root/name).encode() if mode=='120000' else (root/name).read_bytes()
        actual=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
        records[name]={'blob':actual,'sha256':hashlib.sha256(raw).hexdigest(),'index_blob':blob}
    return records
stage=sys.argv[1]
if stage=='before':
    records=snapshot();assert all(v['blob']==v['index_blob'] for v in records.values())
    lock=json.loads((root/'package-lock.json').read_text())
    assert all(not p or 'version'not in r or re.fullmatch(r'\d+\.\d+\.\d+',r['version']) for p,r in lock['packages'].items())
    xcode=subprocess.check_output(['xcodebuild','-version'],text=True)
    swift=subprocess.check_output(['xcrun','swiftc','--version'],text=True)
    assert xcode.splitlines()[0]=='Xcode 27.1', 'Expected final Xcode27.1'
    assert re.search(r'Apple Swift version 6\.4(?:\.\d+)?\s',swift), 'Expected Swift6.4 release compiler'
    runtimes=json.loads(subprocess.check_output(['xcrun','simctl','list','runtimes','--json']))
    available=[r for r in runtimes['runtimes'] if r.get('isAvailable') and r['name'].startswith('iOS ')]
    assert available and max(tuple(map(int,r['version'].split('.'))) for r in available)==(27,1), 'Expected installed current stable iOS27.1 runtime'
    tools={'xcode':xcode,'swift':swift,'node':subprocess.check_output(['node','--version'],text=True).strip(),'npm':subprocess.check_output(['npm','--version'],text=True).strip(),'python':sys.version,'available_iOS_runtimes':available}
    assert tools['node']=='v26.13.0' and tools['npm']=='12.2.1'
    (out/'source-before.json').write_text(json.dumps(records,indent=2)+'\n');(out/'actual-toolchain.json').write_text(json.dumps(tools,indent=2)+'\n')
    print(json.dumps({'source_files_bound':len(records),'stable_lock_records':len(lock['packages'])-1,'xcode':xcode.splitlines()[0],'node':tools['node']}))
elif stage=='geometry':
    candidate=(root/'ios/App/AppUITests/PackingPhotoUITests.swift').read_text()
    helper=candidate.split('private func referencePhotoContentRect',1)[1].split('\n}\n\nfinal class',1)[0]
    helper='private func referencePhotoContentRect'+helper+'\n}\n'
    probe=(root/'.github/qualification/photo-geometry-probe.swift').read_text()
    combined=probe.replace('import CoreGraphics\n','import CoreGraphics\n\n'+helper+'\n',1)
    path=out/'actual-geometry-probe.swift';path.write_text(combined)
    subprocess.check_call(['xcrun','swiftc','-parse-as-library',str(path),'-o',str(out/'geometry-probe')])
    subprocess.check_call([str(out/'geometry-probe'),str(out/'geometry-result.json')])
    (out/'sampled-helper-source.json').write_text(json.dumps({'helper_sha256':hashlib.sha256(helper.encode()).hexdigest(),'probe_sha256':hashlib.sha256(combined.encode()).hexdigest()},indent=2)+'\n')
elif stage=='after':
    after=snapshot();(out/'source-after.json').write_text(json.dumps(after,indent=2)+'\n')
    before_path=out/'source-before.json'
    if before_path.exists():
        before=json.loads(before_path.read_text());changed=[p for p,v in before.items() if after.get(p)!=v]
        (out/'source-change-review.json').write_text(json.dumps({'tracked_payload_changes_during_checks':changed,'all_tracked_payloads_unchanged':not changed},indent=2)+'\n')
        print(json.dumps({'tracked_payload_changes_during_checks':changed}))
        assert not changed, 'Tracked inputs changed during native checks; inspect exact generated changes'
else:raise SystemExit('Unknown phase')
