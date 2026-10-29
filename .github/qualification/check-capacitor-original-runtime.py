"""Owned disposable-worker prerequisite check; no SDK/application cases are executed."""
import json
import os
from pathlib import Path
import shutil
import subprocess


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_OS') != 'macOS':
        raise RuntimeError('Only a disposable hosted macOS worker is permitted')
    if os.environ.get('RUNNER_TEMP') != '/Users/runner/work/_temp':
        raise RuntimeError('Unexpected worker temporary root')
    out = Path('/Users/runner/work/_temp/capacitor-original-runtime-prerequisite')
    out.mkdir(exist_ok=False)
    environment = {**os.environ, 'DEVELOPER_DIR': '/Applications/Xcode_27.1.app/Contents/Developer'}
    report = {'requested_fixture': '26.0.1', 'SDK_cases_or_application_executed': False,
              'publisher_case_commands_modified': False, 'download_attempted': False,
              'runtime_fixture_acceptance': False, 'commands': []}

    def command(name, args, timeout=60):
        # Names and argv come only from the fixed invocations below.
        with (out / (name + '.log')).open('wb') as stream:
            result = subprocess.run(args, stdout=stream, stderr=subprocess.STDOUT,
                                    env=environment, timeout=timeout)
        report['commands'].append({'name': name, 'argv': args, 'returncode': result.returncode})
        return result.returncode, (out / (name + '.log')).read_text(encoding='utf-8')

    def inventory(name):
        code, text = command(name, ['xcrun', 'simctl', 'list', 'runtimes', '--json'])
        if code:
            raise RuntimeError('Unable to inspect actual simulator runtimes')
        runtimes = json.loads(text)['runtimes']
        report[name] = [{key: runtime.get(key) for key in ['identifier', 'version', 'isAvailable', 'buildversion']}
                        for runtime in runtimes]
        return [runtime for runtime in runtimes if runtime.get('version') == '26.0.1' and runtime.get('isAvailable')]

    try:
        code, version = command('xcode-version', ['xcodebuild', '-version'])
        if code or version.strip() != 'Xcode 27.1\nBuild version 27A9275':
            raise RuntimeError('Unexpected selected Xcode build')
        matches = inventory('runtime-before')
        report['free_bytes_before'] = shutil.disk_usage(out).free
        if not matches:
            if report['free_bytes_before'] < 25 * 1024**3:
                raise RuntimeError('Less than 25 GiB disposable free space; no runtime download attempted')
            report['download_attempted'] = True
            code, _ = command('original-runtime-download', [
                'xcodebuild', '-downloadPlatform', 'iOS', '-buildVersion', '26.0.1',
                '-architectureVariant', 'arm64'], timeout=900)
            report['download_returncode'] = code
            matches = inventory('runtime-after')
        if len(matches) != 1:
            raise RuntimeError('The exact original OS26.0.1 fixture is not available; no SDK cases were run or rewritten')
        types = matches[0].get('supportedDeviceTypes', [])
        report['original_iPhone17_type_supported'] = any(t.get('identifier') == 'com.apple.CoreSimulator.SimDeviceType.iPhone-17' for t in types)
        if not report['original_iPhone17_type_supported']:
            raise RuntimeError('Exact runtime lacks original iPhone17 simulator type')
        report['runtime_fixture_acceptance'] = True
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        report['free_bytes_after'] = shutil.disk_usage(out).free
        (out / 'prerequisite.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
