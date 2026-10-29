"""Documented project integration on a disposable worker; never rewrite SDK payloads."""
import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path


def snapshot(root):
    records = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in sorted(dirs + files):
            path = Path(directory) / name
            info = path.lstat()
            relative = str(path.relative_to(root))
            if stat.S_ISLNK(info.st_mode):
                records[relative] = {"kind": "symlink", "target": os.readlink(path)}
            elif stat.S_ISREG(info.st_mode):
                with path.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                records[relative] = {"kind": "file", "sha256": digest, "mode": stat.S_IMODE(info.st_mode)}
            else:
                assert stat.S_ISDIR(info.st_mode), "Unexpected special file in SDK"
    assert len(records) <= 100000
    return records


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_OS") == "macOS"
    out = Path(os.environ["RUNNER_TEMP"]) / "packing-current-apple-linker"
    out.mkdir(exist_ok=False)
    report = {"purpose": "One explicit platform integration link; not an unmodified-SDK or acceptance claim", "link_added": False}

    def checked(name, args):
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=60)
        (out / (name + ".log")).write_bytes(result.stdout)
        assert result.returncode == 0, f"{name} failed; no trust bypass allowed"
        return result.stdout.decode("utf-8").strip()

    try:
        compiler = Path(checked("selected-compiler", ["xcrun", "--find", "swiftc"])).resolve()
        toolchain = compiler.parent.parent.parent
        assert toolchain.name == "swift-6.4.1-RELEASE.xctoolchain"
        assert toolchain.parent == (Path.home() / "Library/Developer/Toolchains").resolve(), "Only the private disposable user installation is allowed"
        version = checked("compiler-version-before", ["xcrun", "swift", "--version"])
        assert "Swift version 6.4.1 " in version
        developer = Path(checked("selected-Xcode", ["xcode-select", "--print-path"])).resolve()
        platform_tools = developer / "Toolchains/XcodeDefault.xctoolchain"
        linker = Path(checked("selected-Apple-linker", ["xcrun", "--toolchain", "default", "--find", "ld"])).resolve()
        assert linker == (platform_tools / "usr/bin/ld").resolve()
        assert linker.is_relative_to(platform_tools.resolve())
        checked("Apple-linker-identity", ["codesign", "--display", "--verbose=4", str(linker)])
        checked("Apple-linker-signature", ["codesign", "--verify", "--strict", "-R", "=anchor apple", str(linker)])
        destination = toolchain / "usr/bin/ld"
        assert not os.path.lexists(destination), "Never replace an existing SDK entry"
        before = snapshot(toolchain)
        (out / "SDK-before.json").write_text(json.dumps(before, indent=2) + "\n", encoding="utf-8")
        report.update({"toolchain": str(toolchain), "compiler": str(compiler), "Apple_linker": str(linker), "Xcode": checked("Xcode-version", ["xcodebuild", "-version"])})
        with linker.open("rb") as stream:
            report["Apple_linker_sha256"] = hashlib.file_digest(stream, "sha256").hexdigest()
        destination.symlink_to(linker)
        report["link_added"] = True
        after = snapshot(toolchain)
        (out / "SDK-after.json").write_text(json.dumps(after, indent=2) + "\n", encoding="utf-8")
        assert set(after) - set(before) == {"usr/bin/ld"}
        assert all(after.get(path) == value for path, value in before.items()), "An original SDK payload changed"
        assert after["usr/bin/ld"] == {"kind": "symlink", "target": str(linker)}
        checked("compiler-signature-after", ["codesign", "--verify", "--strict", str(compiler)])
        after_version = checked("compiler-version-after", ["xcrun", "swift", "--version"])
        assert after_version == version
        report.update({"original_SDK_entries_unchanged": len(before), "added_entries": ["usr/bin/ld"], "actual_compiler_unchanged": version, "acceptance": False})
    finally:
        (out / "integration.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"original_SDK_entries_unchanged": report["original_SDK_entries_unchanged"], "added_link": "usr/bin/ld", "compiler": "6.4.1", "app_acceptance": False}))


if __name__ == "__main__":
    main()
