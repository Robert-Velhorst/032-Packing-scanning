"""Hosted read-only xcresult decoding of a retained synthetic UI run; no tests or app launch."""
import hashlib,json,os,stat,subprocess,zipfile
from pathlib import Path,PurePosixPath
out=Path(os.environ['RUNNER_TEMP'])/'packing-saved-ui-inspection';out.mkdir(exist_ok=False)
archive=out/'input.zip';raw=subprocess.check_output(['gh','api','repos/Robert-Velhorst/032-Packing-scanning/actions/artifacts/12869476345/zip'])
assert hashlib.sha256(raw).hexdigest()=='b3a2265f56d2cd6d6721573e0f7fc5770431c21fa2b6feb5addbd1df53a12213'
archive.write_bytes(raw);stage=out/'input';stage.mkdir()
with zipfile.ZipFile(archive) as z:
    assert sum(r.file_size for r in z.infolist())<512*1024*1024
    for row in z.infolist():
        path=PurePosixPath(row.filename)
        assert not path.is_absolute() and '..'not in path.parts and not stat.S_ISLNK(row.external_attr>>16)
    z.extractall(stage)
bundles=[p for p in stage.rglob('*.xcresult') if p.is_dir()];assert len(bundles)==1
bundle=bundles[0];exports=out/'exports';exports.mkdir()
def snapshot():return {str(p.relative_to(stage)):hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.rglob('*') if p.is_file()}
before=snapshot();commands=[]
def execute(name,args):
    p=subprocess.run(['xcrun','xcresulttool']+args,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    (out/(name+'.json')).write_bytes(p.stdout);(out/(name+'.log')).write_bytes(p.stderr)
    commands.append({'name':name,'argv':args,'returncode':p.returncode,'stdout_bytes':len(p.stdout),'stderr_bytes':len(p.stderr)})
    try:return json.loads(p.stdout) if p.returncode==0 else None
    except ValueError:return None
execute('summary',['get','test-results','summary','--path',str(bundle)])
execute('tests',['get','test-results','tests','--path',str(bundle)])
execute('attachments',['export','attachments','--path',str(bundle),'--output-path',str(exports)])
# A format compatibility reader is used only on the saved result; no SDK/application runtime is changed.
record=execute('legacy-root',['get','object','--legacy','--path',str(bundle),'--format','json'])
def refs(value,key):
    found=set()
    if isinstance(value,dict):
        if key in value and isinstance(value[key],dict):
            item=value[key].get('id',{}).get('_value')
            if isinstance(item,str):found.add(item)
        for child in value.values():found.update(refs(child,key))
    elif isinstance(value,list):
        for child in value:found.update(refs(child,key))
    return found
def attachment_records(value):
    found=[]
    if isinstance(value,dict):
        if 'payloadRef'in value:found.append(value)
        for child in value.values():found.extend(attachment_records(child))
    elif isinstance(value,list):
        for child in value:found.extend(attachment_records(child))
    return found
objects=[record]if record else [];seen=set()
for depth in range(3):
    pending=set().union(*(refs(r,'testsRef')|refs(r,'summaryRef')for r in objects))-seen
    assert len(pending)+len(seen)<=100
    if not pending:break
    for reference in sorted(pending):
        seen.add(reference);item=execute('object-'+str(len(seen)),['get','object','--legacy','--path',str(bundle),'--format','json','--id',reference])
        if item:objects.append(item)
attachments=[];payloads=set()
for item in objects:
    for a in attachment_records(item):
        label=a.get('name',{}).get('_value','');reference=a.get('payloadRef',{}).get('id',{}).get('_value')
        if not reference or reference in payloads:continue
        if not any(term in label.lower() for term in ('failure','debug description')):continue
        payloads.add(reference);assert len(payloads)<=100
        uti=a.get('uniformTypeIdentifier',{}).get('_value','')
        suffix='.txt'if 'text'in uti or 'tree'in label.lower() or 'description'in label.lower() else '.png'
        destination=exports/('attachment-'+str(len(payloads))+suffix)
        execute('export-'+str(len(payloads)),['export','object','--legacy','--type','file','--path',str(bundle),'--id',reference,'--output-path',str(destination)])
        attachments.append({'label':label,'uti':uti,'file':destination.name,'exported':destination.exists()})
after=snapshot();assert before==after
report={'source_run':40806503241,'source_head':'b5238165c4263aa9bf65c5dd798a876c47203e18','input_artifact':12869476345,'input_sha256':hashlib.sha256(raw).hexdigest(),
 'input_payload_files':len(before),'all_input_files_unchanged':True,'commands':commands,'selected_attachments':attachments,
 'SDK_cases_or_application_or_provider_execution':False,'legacy_flag_scope':'saved result object format reader only'}
(out/'inspection.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'input_files_unchanged':True,'read_only_commands':len(commands),'selected_attachments':len(attachments)}))
assert any(p.is_file() and p.suffix in ('.txt','.png','.jpeg') and p.stat().st_size for p in exports.rglob('*')),'No readable exported attachments; inspect retained tool diagnostics.'
