"""Read selected public SDK declaration metadata; no app or compiler invocation."""
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path


def query(args):
    return subprocess.check_output(args, text=True).strip()


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true" and os.environ.get("RUNNER_OS") == "macOS"
    out = Path(os.environ["RUNNER_TEMP"]) / "packing-realitykit-API"
    out.mkdir(exist_ok=False)
    xcode = query(["xcodebuild", "-version"])
    assert xcode == "Xcode 27.1\nBuild version 27A9275", "Inspect the exact failing Xcode profile"
    report = {"Xcode": xcode, "SDKs": [], "app_compiler_or_tests_invoked": False}
    symbols = ("ObjectCaptureSession", "ObjectCaptureView", "PhotogrammetrySession")
    for name in ("iphonesimulator", "iphoneos"):
        root = Path(query(["xcrun", "--sdk", name, "--show-sdk-path"]))
        version = query(["xcrun", "--sdk", name, "--show-sdk-version"])
        assert version == "27.1"
        sdk = {"name": name, "version": version, "root": str(root), "public_interfaces": []}
        frameworks = root / "System/Library/Frameworks"
        selected = [p for p in frameworks.glob("*.framework") if any(s in p.name for s in ("Reality", "ObjectCapture"))]
        sdk["frameworks_selected"] = [p.name for p in sorted(selected)]
        for framework in sorted(selected):
            for source in sorted(framework.rglob("*.swiftinterface")):
                if ".private." in source.name:
                    continue
                data = source.read_bytes()
                assert len(data) <= 16 * 1024 * 1024
                lines = data.decode("utf-8").splitlines()
                stack = []
                declarations = []
                for index, line in enumerate(lines):
                    stripped = line.strip()
                    if stripped.startswith("#if "):
                        stack.append(stripped)
                    elif stripped.startswith(("#elseif ", "#else")) and stack:
                        stack[-1] = stripped
                    elif stripped.startswith("#endif") and stack:
                        stack.pop()
                    if re.search(r"\b(class|struct|enum|typealias)\s+(ObjectCaptureSession|ObjectCaptureView|PhotogrammetrySession)\b", line):
                        declarations.append({"line": index + 1, "declaration": line[:500], "conditional_stack": list(stack),
                                             "preceding_lines": lines[max(0, index - 6):index]})
                text = "\n".join(lines)
                sdk["public_interfaces"].append({"path": str(source.relative_to(root)), "sha256": hashlib.sha256(data).hexdigest(),
                                                 "bytes": len(data), "reference_counts": {s: text.count(s) for s in symbols},
                                                 "reexports": [l[:400] for l in lines if "@_exported import" in l][:25],
                                                 "declarations": declarations[:40]})
        sdk["inspected_interface_count"] = len(sdk["public_interfaces"])
        assert sdk["inspected_interface_count"] > 0, "No public interfaces found; absence cannot be inferred"
        report["SDKs"].append(sdk)
    (out / "SDK-API.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"SDKs": [{"name": s["name"], "version": s["version"], "public_interfaces": s["inspected_interface_count"]} for s in report["SDKs"]], "app_test_acceptance": False}))


if __name__ == "__main__":
    main()
