"""Hosted-only compile probe against the application's exact stock binary SDK."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'macOS'
    assert os.environ.get('RUNNER_TEMP') == '/Users/runner/work/_temp'
    out = Path('/Users/runner/work/_temp/packing-stock-SDK-boundary')
    out.mkdir(exist_ok=False)
    package = out / 'consumer'
    package.mkdir()
    sources = package / 'Sources/PackingBoundaryProbe'
    sources.mkdir(parents=True)
    checkout = Path.cwd()
    report = {'scope': 'Additional compiler probe only; no app adapter or original SDK/app cases executed',
              'SDK_source_or_binary_patch_applied': False, 'main_merge_deploy_data_changed': False,
              'commands': [], 'compile_acceptance': False}

    def run(name, argv, timeout=1200):
        with (out / (name + '.log')).open('wb') as log:
            result = subprocess.run(argv, cwd=package, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
        report['commands'].append({'name': name, 'argv': argv, 'returncode': result.returncode})
        if result.returncode:
            raise RuntimeError(name + ' failed; inspect retained log')
        return (out / (name + '.log')).read_text(encoding='utf-8')

    def snapshot(root):
        return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in sorted(root.rglob('*')) if p.is_file()}

    try:
        assert shutil.disk_usage(out).free >= 12 * 1024**3
        mappings = [('.github/qualification/stock-boundary-probe-Package.swift', package / 'Package.swift'),
                    ('.github/qualification/stock-boundary-probe.swift', sources / 'Boundary.swift'),
                    ('ios/App/App/PackingCaptureAuthority.swift', sources / 'PackingCaptureAuthority.swift')]
        report['original_checkout_inputs'] = {}
        for source, destination in mappings:
            raw = (checkout / source).read_bytes()
            git = subprocess.check_output(['git', 'show', 'HEAD:' + source], cwd=checkout)
            assert raw == git
            destination.write_bytes(raw)
            report['original_checkout_inputs'][source] = hashlib.sha256(raw).hexdigest()
        report['consumer_before'] = snapshot(package)
        report['compiler'] = run('compiler', ['xcrun', 'swift', '--version'], 60).strip()
        assert 'Swift version 6.4.1 ' in report['compiler']
        report['Xcode'] = run('Xcode', ['xcodebuild', '-version'], 60).strip()
        assert report['Xcode'].startswith('Xcode 27.1\n')
        derived = out / 'DerivedData'
        common = ['xcodebuild', '-scheme', 'PackingBoundaryProbe', '-destination', 'generic/platform=iOS Simulator',
                  '-derivedDataPath', str(derived)]
        run('resolve', common + ['-resolvePackageDependencies'])
        repositories = list((derived / 'SourcePackages/checkouts').glob('capacitor-swift-pm'))
        assert len(repositories) == 1
        sdk_repository = repositories[0]
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=sdk_repository).decode().strip()
        report['SDK_package_commit'] = revision
        assert revision == 'e9e932f7748d3b948bc47f5791c761ac5221ec6a'
        artifacts = derived / 'SourcePackages/artifacts'
        before = snapshot(artifacts)
        assert before and any('/Capacitor.swiftmodule/' in p and p.endswith('.swiftinterface') for p in before)
        report['SDK_artifacts_before'] = before
        run('compile', common + ['SWIFT_VERSION=6', 'SWIFT_STRICT_CONCURRENCY=complete',
                                'IPHONEOS_DEPLOYMENT_TARGET=15.4', 'CODE_SIGNING_ALLOWED=NO', 'build'])
        after = snapshot(artifacts)
        report['SDK_artifacts_unchanged'] = before == after
        assert before == after
        for path, digest in report['consumer_before'].items():
            assert hashlib.sha256((package / path).read_bytes()).hexdigest() == digest
        report['consumer_source_inputs_unchanged'] = True
        report['compile_acceptance'] = True
    finally:
        if 'SDK_artifacts_before' in report:
            report['SDK_artifacts_unchanged'] = report['SDK_artifacts_before'] == snapshot(artifacts)
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'compile_acceptance': True, 'scope': report['scope']}))


if __name__ == '__main__':
    main()
