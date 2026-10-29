"""Observe only this disposable worker's freshly created PackingPhotoQA simulator."""
import hashlib,json,os,re,signal,subprocess,sys,time,uuid
from pathlib import Path
root=Path(os.environ['RUNNER_TEMP'])/'packing-owned-console';root.mkdir(exist_ok=True)
identity=root/'owner.json';script=Path(__file__).resolve()
def devices():
    result=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json']))
    return [d for values in result['devices'].values()for d in values if re.fullmatch(r'PackingPhotoQA-[0-9a-f-]{36}',d['name'])]
if sys.argv[1]=='start':
    assert not identity.exists() and not devices(),'Ambiguous existing owned-name simulator; do not observe another invocation.'
    session=str(uuid.uuid4());log=(root/'observer.log').open('wb')
    child=subprocess.Popen([sys.executable,str(script),'watch',session],stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
    identity.write_text(json.dumps({'pid':child.pid,'session':session,'script':str(script)})+'\n')
    print('Started isolated synthetic UI console observation.')
elif sys.argv[1]=='stop':
    if identity.exists():
        owner=json.loads(identity.read_text());state=subprocess.run(['ps','-p',str(owner['pid']),'-o','command='],stdout=subprocess.PIPE)
        text=state.stdout.decode()
        if state.returncode==0:
            assert owner['script']in text and owner['session']in text,'Observer PID ownership changed; preserve foreign process.'
            os.kill(owner['pid'],signal.SIGTERM)
        print('Owned observer cleanup requested; original test/simulator cleanup unchanged.')
else:
    assert sys.argv[1]=='watch';session=sys.argv[2];stopping=False;stream=None;selected=None;truncated=False
    def stop(signum,frame):
        global stopping
        stopping=True
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    observed_hashes=set(); capture_errors=set(); capture_count=0
    def capture_synthetic_file():
        global capture_count
        if not selected or capture_count >= 100: return
        current=[d for d in devices() if d['udid']==selected['udid'] and d['name']==selected['name']]
        if len(current)!=1: return
        probe=subprocess.run(['xcrun','simctl','get_app_container',selected['udid'],'com.packingscanning.app','data'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
        if probe.returncode: return
        container=Path(probe.stdout.decode().strip()).resolve()
        owned=(Path(selected['dataPath'])/'Containers'/'Data'/'Application').resolve()
        assert container.is_relative_to(owned), 'App container escaped the freshly owned simulator.'
        source=(container/'Library'/'Caches'/'packing-synthetic-ui.ndjson').resolve()
        assert source.is_relative_to(container), 'Synthetic diagnostic path escaped the app container.'
        if not source.is_file() or source.stat().st_size > 1024*1024: return
        data=source.read_bytes(); digest=hashlib.sha256(data).hexdigest()
        if digest in observed_hashes: return
        observed_hashes.add(digest);capture_count+=1
        (root/f'synthetic-ui-snapshot-{capture_count:03d}.ndjson').write_bytes(data)
    started=time.monotonic()
    try:
        while not stopping and time.monotonic()-started<600:
            matches=devices();assert len(matches)<=1,'Multiple freshly owned simulators; refuse ambiguous observation.'
            if matches and matches[0]['state']=='Booted':selected=matches[0];break
            time.sleep(2)
        if selected and not stopping:
            assert re.fullmatch(r'[0-9A-Fa-f-]{36}',selected['udid'])
            (root/'selected-simulator.json').write_text(json.dumps({'name':selected['name'],'udid':selected['udid'],'session':session},indent=2)+'\n')
            with (root/'app-console.ndjson').open('wb')as output,(root/'stream-errors.log').open('wb')as errors:
                stream=subprocess.Popen(['xcrun','simctl','spawn',selected['udid'],'log','stream','--style','ndjson','--level','info','--predicate','process == "App" AND subsystem == "com.packingscanning.app.UIQualification"'],stdin=subprocess.DEVNULL,stdout=output,stderr=errors)
                while not stopping and stream.poll()is None and time.monotonic()-started<1800:
                    if (root/'app-console.ndjson').stat().st_size>64*1024*1024:truncated=True;break
                    try: capture_synthetic_file()
                    except (OSError,subprocess.TimeoutExpired) as error: capture_errors.add(type(error).__name__)
                    time.sleep(.5)
    finally:
        if stream and stream.poll()is None:
            stream.terminate()
            try:stream.wait(timeout=10)
            except subprocess.TimeoutExpired:stream.kill();stream.wait()
        (root/'observer-result.json').write_text(json.dumps({'session':session,'selected_fresh_owned_simulator':selected,'synthetic_file_snapshots':capture_count,'synthetic_file_capture_errors':sorted(capture_errors),'console_size_limited':truncated,'app_or_test_process_terminated_by_observer':False,'only_owned_log_stream_cleanup':True},indent=2)+'\n')
