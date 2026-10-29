"""Owned hosted metadata probe; no app/test launch and no compatibility bypass."""
import hashlib
import json
import os
import signal
import subprocess
from pathlib import Path


def source_snapshot(require_clean=True):
    records = subprocess.check_output(["git", "ls-files", "--stage", "-z"]).split(b"\0")
    result = {}
    for record in records:
        if not record:
            continue
        metadata, raw_path = record.split(b"\t", 1)
        mode, blob, stage = metadata.decode("ascii").split()
        assert mode in ("100644", "100755") and stage == "0"
        path = raw_path.decode("utf-8")
        body = Path(path).read_bytes() if Path(path).is_file() else None
        actual = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest() if body is not None else None
        if require_clean:
            assert actual == blob, "Tracked source differs from its exact checkout"
        result[path] = actual
    return result


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_OS") == "macOS"
    out = Path(os.environ["RUNNER_TEMP"]) / "packing-swift641-manifest-tools"
    out.mkdir(exist_ok=False)
    before = source_snapshot()
    (out / "source-before.json").write_text(json.dumps(before, indent=2) + "\n", encoding="utf-8")
    report = {
        "purpose": "Tool-resolution observation only; not app, SDK-suite or test acceptance",
        "selected_environment": {k: os.environ[k] for k in ("TOOLCHAINS", "DEVELOPER_DIR", "SDKROOT") if k in os.environ},
        "commands": [],
        "app_or_tests_launched": False,
    }

    def observe(name, args):
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
        timed_out = False
        try:
            output, _ = process.communicate(timeout=180)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(process.pid, signal.SIGTERM)
            try:
                output, _ = process.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                output, _ = process.communicate()
        limit = 1024 * 1024
        saved = output if len(output) <= limit else output[:limit // 2] + b"\n[bounded diagnostic excerpt]\n" + output[-limit // 2:]
        (out / (name + ".log")).write_bytes(saved)
        report["commands"].append({"name": name, "argv": args, "returncode": process.returncode,
                                   "timed_out": timed_out, "output_bytes": len(output),
                                   "full_output_sha256": hashlib.sha256(output).hexdigest(),
                                   "saved_output_is_complete": len(output) <= limit})

    try:
        for tool in ("swiftc", "swift", "clang", "ld"):
            observe("selected-" + tool, ["xcrun", "--find", tool])
        for tool in ("clang", "ld"):
            observe("Xcode-default-" + tool, ["xcrun", "--toolchain", "default", "--find", tool])
        observe("macOS-SDK", ["xcrun", "--sdk", "macosx", "--show-sdk-path"])
        observe("selected-clang-search", ["xcrun", "clang", "-print-search-dirs"])
        observe("selected-swift-target", ["xcrun", "swiftc", "-print-target-info"])
        observe("SwiftPM-describe", ["xcrun", "swift", "package", "--package-path", "ios/App/CapApp-SPM", "-v", "describe", "--type", "json"])
        observe("Xcode-package-resolution", ["xcodebuild", "-resolvePackageDependencies", "-project", "ios/App/App.xcodeproj", "-scheme", "App", "-sdk", "iphonesimulator", "-destination", "generic/platform=iOS Simulator", "-derivedDataPath", str(out / "DerivedData"), "-verbose"])
    finally:
        after = source_snapshot(require_clean=False)
        (out / "source-after.json").write_text(json.dumps(after, indent=2) + "\n", encoding="utf-8")
        report["tracked_sources_unchanged"] = before == after
        (out / "probe.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert report["tracked_sources_unchanged"]
    print(json.dumps({"metadata_commands_observed": len(report["commands"]), "source_files_unchanged": len(before), "app_or_test_acceptance": False}))


if __name__ == "__main__":
    main()
