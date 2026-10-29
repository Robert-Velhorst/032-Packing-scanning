"""Hosted lock metadata/review only; no application acceptance claim."""
import hashlib,json,os,re,subprocess,sys
from pathlib import Path
out=Path(os.environ['RUNNER_TEMP'])/'packing-current-lock';out.mkdir(exist_ok=True)
root=Path.cwd()
def snapshot():
    paths=subprocess.check_output(['git','ls-files','-z']).decode().split('\0')
    return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in paths if p and not (root/p).is_symlink()}
if sys.argv[1]=='before':
    manifest=json.loads((root/'package.json').read_text());assert not manifest.get('overrides') and not manifest.get('resolutions')
    profile=json.loads((root/'.github/qualification/current-direct-profile.json').read_text())
    for group in ('dependencies','devDependencies'):
        assert set(manifest[group])==set(profile[group])
        assert all(manifest[group][n]==v and re.fullmatch(r'\d+\.\d+\.\d+',v) for n,v in profile[group].items())
    assert subprocess.check_output(['node','--version'],text=True).strip()=='v26.13.0'
    assert subprocess.check_output(['npm','--version'],text=True).strip()=='12.2.1'
    (out/'source-before.json').write_text(json.dumps(snapshot(),indent=2)+'\n')
else:
    after=snapshot();before=json.loads((out/'source-before.json').read_text());changed=[p for p in before if before[p]!=after.get(p)]
    (out/'source-after.json').write_text(json.dumps(after,indent=2)+'\n')
    assert set(changed)<={'package-lock.json'},changed
    report={'only_allowed_generated_lock_change':changed,'installed_application_or_original_SDK_tests_ran':False}
    if (root/'package-lock.json').exists():
        raw=(root/'package-lock.json').read_bytes();lock=json.loads(raw)
        (out/'package-lock.json').write_bytes(raw)
        report['lock_sha256']=hashlib.sha256(raw).hexdigest()
        report['lock_records']=len(lock['packages'])-1
        report['nonstable_records']=[{'path':p,'version':r['version']} for p,r in lock['packages'].items() if p and 'version'in r and not re.fullmatch(r'\d+\.\d+\.\d+',r['version'])]
        manifest=json.loads((root/'package.json').read_text())
        report['manifest_lock_direct_mismatch']=[n for group in ('dependencies','devDependencies') for n,v in manifest[group].items() if lock['packages'].get('node_modules/'+n,{}).get('version')!=v]
    (out/'resolution-review.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))
    assert not report.get('nonstable_records') and not report.get('manifest_lock_direct_mismatch')
