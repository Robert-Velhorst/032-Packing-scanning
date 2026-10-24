"""Verify guest QA APKs. This does not certify device behavior or production signing."""
import argparse
import hashlib
import json
import re
import struct
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

PAGE = 16384
MACHINES = {"arm64-v8a": 183, "x86_64": 62}


def covered(start, end, ranges):
    cursor = start
    for left, right in sorted(ranges):
        if right <= cursor:
            continue
        if left > cursor:
            return False
        cursor = max(cursor, right)
        if cursor >= end:
            return True
    return cursor >= end


def inspect_elf(data, abi):
    if len(data) < 64 or data[:7] != b"\x7fELF\x02\x01\x01":
        raise ValueError("Expected a complete little-endian ELF64 header")
    header = struct.unpack_from("<16sHHIQQQIHHHHHH", data)
    if header[1] != 3 or header[2] != MACHINES[abi] or header[3] != 1 or header[8] != 64:
        raise ValueError("Invalid shared-library type, architecture or ELF version")
    offset, stride, count = header[5], header[9], header[10]
    if offset < 64 or stride < 56 or not 1 <= count <= 2048 or offset + stride * count > len(data):
        raise ValueError("Invalid ELF program-header bounds")
    loads, relros = [], []
    for index in range(count):
        kind, flags, file_offset, address, _, file_size, memory_size, alignment = struct.unpack_from(
            "<IIQQQQQQ", data, offset + index * stride)
        if kind == 1:  # PT_LOAD
            if (memory_size < file_size or file_offset + file_size > len(data)
                    or address + memory_size >= 2**64):
                raise ValueError("Invalid load-segment bounds")
            if alignment < PAGE or alignment & (alignment - 1) or (address - file_offset) % PAGE:
                raise ValueError("A load segment is not 16 KB aligned")
            loads.append((address, address + memory_size, flags, alignment))
        elif kind == 0x6474E552:  # PT_GNU_RELRO
            if address + memory_size >= 2**64:
                raise ValueError("Invalid RELRO bounds")
            relros.append((address, address + memory_size))
    if not loads:
        raise ValueError("Shared library has no load segments")
    # Bionic rounds mprotect to pages. A raw unaligned RELRO end can be safe
    # when the writable segment ends there and padding separates the next one.
    # Reject actual permission conflicts, rather than rejecting safe padding.
    mapped_loads = [(start // PAGE * PAGE, (end + PAGE - 1) // PAGE * PAGE)
                    for start, end, _, _ in loads]
    protected_ranges = []
    for start, end in relros:
        protected_start, protected_end = start // PAGE * PAGE, (end + PAGE - 1) // PAGE * PAGE
        if not covered(protected_start, protected_end, mapped_loads):
            raise ValueError("RELRO protection extends outside mapped load pages")
        for load_start, load_end, flags, _ in loads:
            left, right = max(load_start, protected_start), min(load_end, protected_end)
            if left < right:
                if flags & 1:
                    raise ValueError("RELRO page protection overlaps executable bytes")
                if flags & 2 and not covered(left, right, relros):
                    raise ValueError("RELRO page protection covers writable data outside RELRO")
        protected_ranges.append([protected_start, protected_end])
    return {"loadAlignments": [load[3] for load in loads], "relroEnds": [end for _, end in relros],
            "relroPageRanges": protected_ranges}


def digest(stream):
    result = hashlib.sha256()
    for block in iter(lambda: stream.read(1024 * 1024), b""):
        result.update(block)
    return result.hexdigest()


def web_assets(directory):
    root = directory.resolve(strict=True)
    assets = {}
    for file in sorted(root.rglob("*")):
        if file.is_symlink():
            raise ValueError("Web output cannot contain symbolic links")
        if file.is_file():
            if file.stat().st_size > 32 * 1024 * 1024:
                raise ValueError("Web asset exceeds the verification size limit")
            with file.open("rb") as stream:
                assets[file.relative_to(root).as_posix()] = digest(stream)
    if "index.html" not in assets or not any(name.endswith(".js") for name in assets):
        raise ValueError("Missing bundled web output")
    return assets


def inspect_archive(archive, expected_assets=None):
    entries = archive.infolist()
    names = [entry.filename for entry in entries]
    if len(names) != len(set(names)):
        raise ValueError("APK contains duplicate entry names")
    if "AndroidManifest.xml" not in names or "classes.dex" not in names:
        raise ValueError("APK is missing its manifest or primary bytecode")
    if sum(entry.file_size for entry in entries) > 512 * 1024 * 1024:
        raise ValueError("APK exceeds the uncompressed verification size limit")
    libraries = []
    for entry in entries:
        # ZipInfo can normalize Windows separators; inspect the original name.
        raw_name = entry.orig_filename
        path = PurePosixPath(raw_name)
        if (path.is_absolute() or ".." in path.parts or "\\" in raw_name
                or "\x00" in raw_name or path.as_posix() != raw_name.rstrip("/")):
            raise ValueError("APK contains a noncanonical path")
        match = re.fullmatch(r"lib/(arm64-v8a|x86_64)/[^/]+\.so", entry.filename)
        if match:
            if entry.file_size > 128 * 1024 * 1024:
                raise ValueError("Native library exceeds the verification size limit")
            try:
                result = inspect_elf(archive.read(entry), match[1])
            except ValueError as error:
                raise ValueError(f"{entry.filename}: {error}") from error
            libraries.append({"entry": entry.filename, **result})
    if expected_assets is not None:
        if not any(item["entry"].startswith("lib/arm64-v8a/") for item in libraries):
            raise ValueError("The scanner APK is missing its ARM64 native libraries")
        for name, expected in expected_assets.items():
            with archive.open(f"assets/public/{name}") as stream:
                if digest(stream) != expected:
                    raise ValueError(f"Packaged web asset does not match dist: {name}")
        config_info = archive.getinfo("assets/capacitor.config.json")
        if config_info.file_size > 65536:
            raise ValueError("Capacitor configuration is unexpectedly large")
        config = json.loads(archive.read(config_info))
        if not isinstance(config, dict) or not isinstance(config.get("server", {}), dict) or not isinstance(config.get("plugins", {}), dict):
            raise ValueError("Invalid Capacitor configuration")
        if not isinstance(config.get("plugins", {}).get("PackingAccount", {}), dict):
            raise ValueError("Invalid account configuration")
        if (config.get("appId") != "com.packingscanning.app" or config.get("loggingBehavior") != "none"
                or config.get("server", {}).get("url")
                or config.get("plugins", {}).get("PackingAccount", {}).get("serviceOrigin") != ""):
            raise ValueError("Expected a guest build without a live server URL or bridge diagnostics")
    return libraries


def sdk_check(command, *, capture_streams=False):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    if result.returncode:
        diagnostic = (result.stdout + result.stderr).strip()[-4000:]
        raise ValueError(f"{Path(command[0]).name} failed ({result.returncode}): {diagnostic}")
    return result if capture_streams else result.stdout


def qa_signer_digest(output):
    # SDK 37 names certificates by their verified signing scheme. Older SDKs
    # number the signer. Bind either representation to the SDK's signer count
    # and successful verification, never to a matching substring in a DN.
    if output.splitlines().count("Verifies") != 1:
        raise ValueError("Missing successful SDK signature verification")
    if re.findall(r"^Number of signers: ([0-9]+)$", output, re.M) != ["1"]:
        raise ValueError("Expected exactly one verified QA signer")
    verified = set(re.findall(
        r"^Verified using (v(?:1|2|3|3\.1|3\.2|4)) scheme \([^\r\n]+\): true$", output, re.M))
    if not verified:
        raise ValueError("No signing scheme verified")
    labels, digests = set(), set()
    for line in output.splitlines():
        if "certificate SHA-256 digest:" not in line:
            continue
        match = re.fullmatch(
            r"(Signer #([1-9][0-9]*)|V(1|2|3|3\.1|3\.2|4) Signer:) certificate SHA-256 digest: ([a-fA-F0-9]{64})", line)
        if not match:
            raise ValueError("Unsupported or ambiguous SDK signer certificate line")
        label, number, scheme, digest = match.groups()
        if label in labels or (number is not None and number != "1"):
            raise ValueError("Duplicate or additional QA signer")
        if scheme is not None and "v" + scheme not in verified:
            raise ValueError("Certificate belongs to an unverified signing scheme")
        labels.add(label)
        digests.add(digest.lower())
    if not labels or len(digests) != 1:
        raise ValueError("Missing or conflicting verified QA signer certificates")
    return digests.pop()


def verify(args):
    for value in [args.source_revision, args.head_revision or args.source_revision]:
        if not re.fullmatch(r"[a-f0-9]{40}", value):
            raise ValueError("Source revisions must be full Git commit IDs")
    assets = web_assets(args.dist)
    records = []
    certificates = []
    for role in ["debug", "instrumentation", "release"]:
        apk = getattr(args, role).resolve(strict=True)
        if not apk.is_file() or apk.stat().st_size > 256 * 1024 * 1024:
            raise ValueError("Expected a bounded APK file")
        sdk_check([str(args.build_tools / "zipalign"), "-c", "-P", "16", "4", str(apk)])
        certificate = None
        if role != "release":
            checked = sdk_check([str(args.build_tools / "apksigner"), "verify", "--verbose", "--print-certs", str(apk)], capture_streams=True)
            try:
                certificate = qa_signer_digest(checked.stdout)
            except ValueError as error:
                diagnostic = (checked.stdout + "\n" + checked.stderr).strip()[-4000:]
                raise ValueError(f"Invalid QA signer for {role}: {error}. SDK output: {diagnostic}") from error
            certificates.append(certificate)
        with zipfile.ZipFile(apk) as archive:
            libraries = inspect_archive(archive, assets if role != "instrumentation" else None)
        with apk.open("rb") as stream:
            checksum = digest(stream)
        records.append({"role": role, "filename": apk.name, "bytes": apk.stat().st_size,
                        "sha256": checksum, "signing": "not-verified-release" if role == "release" else "verified-qa-key",
                        "certificateSha256": certificate, "zipAlignmentBytes": PAGE,
                        "webAssetCount": len(assets) if role != "instrumentation" else 0,
                        "elf64Libraries": libraries})
    if len(set(certificates)) != 1:
        raise ValueError("The debug app and instrumentation APK use different signing certificates")
    receipt = {"schemaVersion": 1, "checkedOutCommit": args.source_revision,
               "headCommit": args.head_revision or args.source_revision,
               "createdAt": datetime.now(timezone.utc).isoformat(), "guestBuild": True, "artifacts": records,
               "limits": "Static packaging checks only; no device, 16 KB runtime, production signing or store acceptance."}
    with args.output.open("x", encoding="utf-8") as output:
        output.write(json.dumps(receipt, indent=2) + "\n")
    print("Verified guest APK signatures, matching test signer, web assets, ZIP/ELF alignment and RELRO page safety.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for role in ["debug", "instrumentation", "release", "dist", "build-tools", "output"]:
        parser.add_argument(f"--{role}", type=Path, required=True)
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--head-revision")
    args = parser.parse_args()
    try:
        verify(args)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        print(f"Android artifact verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
