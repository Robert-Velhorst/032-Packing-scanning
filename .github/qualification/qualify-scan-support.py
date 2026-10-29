"""Owned hosted simulator component qualification; original SDK/app cases unchanged."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'macOS'
    assert os.environ.get('RUNNER_TEMP') == '/Users/runner/work/_temp'
    out = Path('/Users/runner/work/_temp/packing-stock-SDK-callbacks')
    out.mkdir(exist_ok=False)
    consumer = out / 'consumer'
    consumer.mkdir()
    checkout = Path.cwd()
    report = {'scope': 'Actual Scan support source,22 callback/Print/key/lease/event controls; not full app UI/device acceptance',
              'SDK_patch_applied': False, 'print_application_source_wired': True, 'scan_application_port_complete': False, 'commands': [],
              'new_unchecked_Sendable_or_actor_suppression': False, 'component_acceptance': False}

    def run(name, argv, timeout=1200):
        with (out / (name + '.log')).open('wb') as log:
            result = subprocess.run(argv, cwd=consumer, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        report['commands'].append({'name': name, 'argv': argv, 'returncode': result.returncode})
        if result.returncode:
            raise RuntimeError(name + ' failed; inspect retained diagnostics')
        return (out / (name + '.log')).read_text(encoding='utf-8')

    def snapshot(root):
        return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(root.rglob('*')) if p.is_file()}

    try:
        assert shutil.disk_usage(out).free >= 12 * 1024**3
        mappings = {
            '.github/qualification/callback-consumer-Package.swift': 'Package.swift',
            'ios/App/App/PackingSDKCallbacks.h': 'Sources/PackingSDKCallbacks/include/PackingSDKCallbacks.h',
            'ios/App/App/PackingSDKCallbacks.m': 'Sources/PackingSDKCallbacks/PackingSDKCallbacks.m',
            'ios/App/App/PackingCallbackToken.swift': 'Sources/PackingCallbackConsumer/PackingCallbackToken.swift',
            '.github/qualification/stock-boundary-probe.swift': 'Sources/PackingCallbackConsumer/Boundary.swift',
            'ios/App/App/PackingPrintPlugin.swift': 'Sources/PackingCallbackConsumer/PackingPrintPlugin.swift',
            'ios/App/App/PackingForeground.swift': 'Sources/PackingCallbackConsumer/PackingForeground.swift',
            'ios/App/App/PackingCaptureBridgeValues.swift': 'Sources/PackingCallbackConsumer/PackingCaptureBridgeValues.swift',
            '.github/qualification/PackingPrintActorTests.swift': 'Tests/PackingPrintActorTests/PackingPrintActorTests.swift',
            'ios/App/App/PackingCaptureAuthority.swift': 'Sources/PackingCallbackConsumer/PackingCaptureAuthority.swift',
            'ios/App/App/PackingWorkspaceKey.swift': 'Sources/PackingCallbackConsumer/PackingWorkspaceKey.swift',
            '.github/qualification/PackingScanSupportTests.swift': 'Tests/PackingScanSupportTests/PackingScanSupportTests.swift',
            '.github/qualification/PackingCallbackConsumerTests.swift': 'Tests/PackingCallbackConsumerTests/PackingCallbackConsumerTests.swift',
        }
        report['original_checkout_inputs'] = {}
        for original, destination in mappings.items():
            raw = (checkout / original).read_bytes()
            assert raw == subprocess.check_output(['git', 'show', 'HEAD:' + original], cwd=checkout)
            path = consumer / destination
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            report['original_checkout_inputs'][original] = hashlib.sha256(raw).hexdigest()
        report['consumer_before'] = snapshot(consumer)
        report['compiler'] = run('compiler', ['xcrun', 'swift', '--version'], 60).strip()
        assert 'Swift version 6.4.1 ' in report['compiler']
        report['Xcode'] = run('Xcode', ['xcodebuild', '-version'], 60).strip()
        assert report['Xcode'].startswith('Xcode 27.1\n')
        runtimes = json.loads(run('runtimes', ['xcrun', 'simctl', 'list', 'runtimes', '--json'], 60))['runtimes']
        ids = {r['identifier'] for r in runtimes if r.get('isAvailable') and r.get('version') == '27.1'}
        assert len(ids) == 1
        runtime = ids.pop()
        devices = json.loads(run('devices', ['xcrun', 'simctl', 'list', 'devices', 'available', '--json'], 60))['devices'][runtime]
        candidates = sorted([d for d in devices if d.get('isAvailable') and d['name'].startswith('iPhone')], key=lambda d: d['name'])
        assert candidates
        device = candidates[0]
        report['simulator'] = {'runtime': runtime, 'name': device['name'], 'udid': device['udid']}
        derived = out / 'DerivedData'
        common = ['xcodebuild', '-scheme', 'PackingCallbackConsumer', '-destination', 'id=' + device['udid'],
                  '-derivedDataPath', str(derived)]
        run('resolve', common + ['-resolvePackageDependencies'])
        repository = derived / 'SourcePackages/checkouts/capacitor-swift-pm'
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repository).decode().strip()
        assert revision == 'e9e932f7748d3b948bc47f5791c761ac5221ec6a'
        report['SDK_package_commit'] = revision
        artifacts = derived / 'SourcePackages/artifacts'
        report['SDK_binary_payloads_before'] = snapshot(artifacts)
        assert report['SDK_binary_payloads_before']
        bundle = out / 'callbacks.xcresult'
        log = run('test', common + ['-enableThreadSanitizer', 'YES', '-parallel-testing-enabled', 'NO', '-resultBundlePath', str(bundle),
                                   'SWIFT_VERSION=6', 'SWIFT_STRICT_CONCURRENCY=complete',
                                   'IPHONEOS_DEPLOYMENT_TARGET=15.4', 'CODE_SIGNING_ALLOWED=NO', 'test'])
        test_source = '\n'.join(p.read_text(encoding='utf-8') for p in sorted((consumer / 'Tests').rglob('*.swift')))
        expected = re.findall(r'@Test(?:\s+@MainActor)?\s+func (\w+)\(', test_source)
        assert len(expected) == 22
        passed = [name for name in expected if re.search(r'Test ' + name + r'\(\) passed', log)]
        report['component_cases_expected'] = expected
        report['component_cases_reported_passed'] = passed
        assert passed == expected and '** TEST SUCCEEDED **' in log
        report['thread_sanitizer_requested'] = True
        report['test_summary'] = json.loads(run('xcresult-summary', ['xcrun', 'xcresulttool', 'get', 'test-results', 'summary', '--path', str(bundle)], 60))
        for key, expected_count in [('passedTests', 22), ('failedTests', 0), ('skippedTests', 0)]:
            assert report['test_summary'].get(key) == expected_count
        for path, digest in report['consumer_before'].items():
            assert hashlib.sha256((consumer / path).read_bytes()).hexdigest() == digest
        report['consumer_inputs_unchanged'] = True
        assert report['SDK_binary_payloads_before'] == snapshot(artifacts)
        report['component_acceptance'] = True
    finally:
        if 'SDK_binary_payloads_before' in report:
            report['SDK_binary_payloads_unchanged'] = report['SDK_binary_payloads_before'] == snapshot(artifacts)
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'component_acceptance': True, 'cases': 22, 'scope': report['scope']}))


if __name__ == '__main__':
    main()
