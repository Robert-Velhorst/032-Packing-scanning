"""Hosted-only metadata resolution; never install or execute Capacitor SDK cases."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

PUBLISHER_COMMIT = 'ef3ce6e4edfbc90b678f37138f387d1f524d6b35'


def main():
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('RUNNER_OS') != 'Linux':
        raise RuntimeError('Only the owned disposable Linux metadata worker is permitted')
    if os.environ.get('RUNNER_TEMP') != '/home/runner/work/_temp':
        raise RuntimeError('Unexpected worker temporary root')
    out = Path('/home/runner/work/_temp/capacitor-publisher-lerna-profile')
    out.mkdir(exist_ok=False)
    source = out / 'publisher-source'
    report = {'publisher_commit': PUBLISHER_COMMIT, 'SDK_main_queue_source_patch_applied': False, 'SDK_root_test_metadata_profile_applied': True,
              'SDK_or_application_cases_executed': False, 'normal_SDK_install_executed': False,
              'publisher_disables_lockfiles': True, 'lock_is_metadata_analysis_only': True,
              'commands': [], 'strict_stable_graph_acceptance': False}

    def run(name, args, cwd=None, timeout=60, environment=None):
        with (out / (name + '.log')).open('wb') as stream:
            result = subprocess.run(args, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                                    env=environment, timeout=timeout)
        report['commands'].append({'name': name, 'argv': args, 'returncode': result.returncode})
        return result.returncode

    def snapshot():
        data = subprocess.check_output(['git', 'ls-files', '-s', '-z'], cwd=source)
        records = {}
        for item in data.split(b'\0'):
            if not item:
                continue
            head, name = item.split(b'\t', 1)
            mode, blob, stage = head.decode().split()
            if stage != '0' or mode not in ('100644', '100755', '120000'):
                raise RuntimeError('Unexpected publisher Git input mode or conflict')
            path = name.decode()
            payload = os.readlink(source / path).encode() if mode == '120000' else (source / path).read_bytes()
            actual = hashlib.sha1(b'blob ' + str(len(payload)).encode() + b'\0' + payload).hexdigest()
            expected = declared_profile_blobs.get(path, blob)
            if actual != expected:
                raise RuntimeError('Publisher/profile source payload changed: ' + path)
            records[path] = {'blob': actual, 'publisher_blob': blob, 'sha256': hashlib.sha256(payload).hexdigest(), 'mode': mode}
        return records

    before = None
    declared_profile_blobs = {}
    try:
        if run('clone-source', ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null',
                                'clone', '--depth', '1', '--single-branch', '--branch', '8.6.0',
                                'https://github.com/ionic-team/capacitor.git', str(source)], timeout=180):
            raise RuntimeError('Publisher source checkout failed')
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
        if commit != PUBLISHER_COMMIT:
            raise RuntimeError('Publisher tag no longer matches the reconciled immutable commit')
        publisher_original = snapshot()
        (out / 'publisher-source-original.json').write_text(json.dumps(publisher_original, indent=2) + '\n')
        report['original_Git_payloads'] = len(publisher_original)
        manifest = source / 'package.json'
        original = manifest.read_bytes()
        needle = b'"lerna": "^7.1.3"'
        if original.count(needle) != 1:
            raise RuntimeError('Original publisher Lerna declaration differs from the reviewed source')
        candidate = original.replace(needle, b'"lerna": "10.1.1"')
        previous = json.loads(original)
        effective = json.loads(candidate)
        expected = json.loads(original)
        expected['devDependencies']['lerna'] = '10.1.1'
        if effective != expected or effective['scripts'] != previous['scripts']:
            raise RuntimeError('Metadata profile changes more than the reviewed Lerna field')
        manifest.write_bytes(candidate)
        declared_profile_blobs['package.json'] = hashlib.sha1(b'blob ' + str(len(candidate)).encode() + b'\0' + candidate).hexdigest()
        report['declared_metadata_profile'] = {'path': 'package.json', 'field': 'devDependencies.lerna',
                                              'from': '^7.1.3', 'to': '10.1.1',
                                              'publisher_blob': publisher_original['package.json']['blob'],
                                              'effective_blob': declared_profile_blobs['package.json']}
        report['original_source_payloads_preserved_except_declared_metadata'] = len(publisher_original) - 1
        report['all_publisher_scripts_and_case_fixture_payloads_unchanged'] = True
        before = snapshot()
        (out / 'source-before.json').write_text(json.dumps(before, indent=2) + '\n')
        report['effective_workspace_manifest_SHA256'] = {
            path: hashlib.sha256((source / path).read_bytes()).hexdigest()
            for path in ['package.json', 'android/package.json', 'ios/package.json', 'cli/package.json', 'core/package.json']}
        for name, args in [('node-version', ['node', '--version']), ('npm-version', ['npm', '--version'])]:
            if run(name, args):
                raise RuntimeError('Unable to inspect actual metadata tools')
        env = {**os.environ, 'NPM_CONFIG_ENGINE_STRICT': 'true', 'NPM_CONFIG_STRICT_PEER_DEPS': 'true'}
        code = run('metadata-resolve', ['npm', 'install', '--package-lock-only', '--package-lock=true', '--ignore-scripts'],
                   cwd=source, timeout=600, environment=env)
        report['metadata_resolve_returncode'] = code
        modules = source / 'node_modules'
        if modules.exists() and any(modules.iterdir()):
            raise RuntimeError('Metadata-only resolution unexpectedly populated node_modules; no SDK cases may run')
        report['node_modules_populated'] = False
        lockfile = source / 'package-lock.json'
        if lockfile.is_file():
            raw = lockfile.read_bytes()
            (out / 'generated-package-lock.json').write_bytes(raw)
            lock = json.loads(raw)
            packages = lock.get('packages', {})
            report['lock_SHA256'] = hashlib.sha256(raw).hexdigest()
            report['lockfileVersion'] = lock.get('lockfileVersion')
            report['resolved_package_records'] = len(packages)
            report['prerelease_packages'] = [
                {'path': path, 'version': item['version']}
                for path, item in packages.items()
                if re.match(r'^\d+\.\d+\.\d+-', item.get('version', ''))]
        if code:
            raise RuntimeError('Normal strict metadata resolution failed; inspect retained resolver output')
        if not lockfile.is_file():
            raise RuntimeError('No complete generated metadata lock was produced')

        audit_code = run('metadata-audit', ['npm', 'audit', '--json', '--package-lock=true', '--ignore-scripts'],
                         cwd=source, timeout=180, environment=env)
        report['audit_metadata_returncode'] = audit_code
        audit_file = out / 'metadata-audit.log'
        try:
            audit = json.loads(audit_file.read_text(encoding='utf-8'))
            (out / 'audit-result.json').write_text(json.dumps(audit, indent=2) + '\n')
            report['audit_metadata'] = audit.get('metadata')
            report['audit_report_version'] = audit.get('auditReportVersion')
            report['audit_error'] = audit.get('error')
            report['audit_scope'] = 'Complete declared Lerna-profile workspace dependency metadata; not native-iOS-framework vulnerability attribution'
        except (ValueError, UnicodeError) as error:
            report['audit_parse_error'] = str(error)

        if report['prerelease_packages']:
            raise RuntimeError('Unapproved prerelease versions selected; no SDK dependency installation or cases may run')
        report['strict_stable_graph_acceptance'] = True
    except Exception as error:
        report['failure'] = str(error)
        raise
    finally:
        try:
            if before is not None:
                after = snapshot()
                (out / 'source-after.json').write_text(json.dumps(after, indent=2) + '\n')
                if before != after:
                    raise RuntimeError('Publisher source changed during metadata resolution')
                report['all_profile_source_payloads_unchanged'] = len(after)
        except Exception as error:
            report['source_binding_failure'] = str(error)
            report['strict_stable_graph_acceptance'] = False
            raise
        finally:
            (out / 'metadata-result.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
