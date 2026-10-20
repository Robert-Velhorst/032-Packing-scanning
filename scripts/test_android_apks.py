"""Small synthetic corruptions exercise rejection; CI also checks the real APKs."""
import hashlib
import io
import json
import struct
import unittest
import warnings
import zipfile
from verify_android_apks import inspect_elf, inspect_archive


def elf(machine=183, alignment=16384, relro_end=32768):
    data = bytearray(20480)
    ident = b"\x7fELF\x02\x01\x01" + bytes(9)
    struct.pack_into("<16sHHIQQQIHHHHHH", data, 0, ident, 3, machine, 1, 0, 64, 0, 0, 64, 56, 3, 0, 0, 0)
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 5, 0, 0, 0, 4096, 16384, alignment)
    struct.pack_into("<IIQQQQQQ", data, 120, 1, 6, 16384, 16384, 0, 4096, 16384, alignment)
    struct.pack_into("<IIQQQQQQ", data, 176, 0x6474E552, 4, 16384, 16384, 0, 4096, relro_end - 16384, 1)
    return data


def archive(entries):
    buffer = io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        with zipfile.ZipFile(buffer, "w") as output:
            for name, content in entries:
                # Preserve malformed names even when tests run on Windows.
                info = zipfile.ZipInfo()
                info.filename = info.orig_filename = name
                output.writestr(info, content)
    buffer.seek(0)
    return zipfile.ZipFile(buffer)


class ElfAlignmentTests(unittest.TestCase):
    def test_checks_both_supported_64_bit_architectures(self):
        for abi, machine in [("arm64-v8a", 183), ("x86_64", 62)]:
            with self.subTest(abi=abi):
                result = inspect_elf(elf(machine), abi)
                self.assertEqual(result["loadAlignments"], [16384, 16384])
                self.assertEqual(result["relroEnds"], [32768])

    def test_rejects_4k_and_non_power_of_two_load_alignment(self):
        for alignment in [4096, 8192, 24576]:
            with self.subTest(alignment=alignment), self.assertRaisesRegex(ValueError, "load segment"):
                inspect_elf(elf(alignment=alignment), "arm64-v8a")

    def test_rejects_relro_end_that_can_make_16k_loading_fail(self):
        with self.assertRaisesRegex(ValueError, "RELRO"):
            inspect_elf(elf(relro_end=20480), "arm64-v8a")

    def test_accepts_unaligned_relro_end_with_padding_before_next_writable_segment(self):
        data = elf(relro_end=20480)
        struct.pack_into("<Q", data, 120 + 40, 4096)  # writable LOAD ends at RELRO end
        result = inspect_elf(data, "arm64-v8a")
        self.assertEqual(result["relroEnds"], [20480])
        self.assertEqual(result["relroPageRanges"], [[16384, 32768]])

    def test_refuses_rounding_that_covers_writable_data_before_relro(self):
        data = elf()
        struct.pack_into("<Q", data, 176 + 16, 20480)
        struct.pack_into("<Q", data, 176 + 40, 12288)
        with self.assertRaisesRegex(ValueError, "writable data"):
            inspect_elf(data, "arm64-v8a")

    def test_refuses_protection_that_would_remove_execute_permission(self):
        data = elf()
        struct.pack_into("<I", data, 120 + 4, 5)
        with self.assertRaisesRegex(ValueError, "executable"):
            inspect_elf(data, "arm64-v8a")

    def test_refuses_relro_pages_outside_the_load_mapping(self):
        data = elf()
        struct.pack_into("<Q", data, 176 + 40, 49152)
        with self.assertRaisesRegex(ValueError, "outside mapped"):
            inspect_elf(data, "arm64-v8a")

    def test_combines_declared_relro_ranges_when_they_share_a_page(self):
        data = elf(relro_end=24576)
        struct.pack_into("<H", data, 56, 4)  # four program headers
        struct.pack_into("<IIQQQQQQ", data, 232, 0x6474E552, 4, 16384, 24576, 0, 0, 8192, 1)
        self.assertEqual(inspect_elf(data, "arm64-v8a")["relroEnds"], [24576, 32768])

    def test_rejects_wrong_architecture_and_truncated_headers(self):
        for data in [elf(62), elf()[:63], elf()[:200], bytes(256)]:
            with self.subTest(size=len(data)), self.assertRaises(ValueError):
                inspect_elf(data, "arm64-v8a")

    def test_rejects_incongruent_load_address(self):
        data = elf()
        struct.pack_into("<Q", data, 64 + 16, 4096)
        with self.assertRaisesRegex(ValueError, "load segment"):
            inspect_elf(data, "arm64-v8a")

    def test_rejects_program_headers_pointing_beyond_file(self):
        data = elf()
        struct.pack_into("<Q", data, 32, len(data) - 20)
        with self.assertRaisesRegex(ValueError, "program-header"):
            inspect_elf(data, "arm64-v8a")

    def test_rejects_elf_without_load_segments(self):
        data = elf()
        struct.pack_into("<I", data, 64, 0)
        struct.pack_into("<I", data, 120, 0)
        with self.assertRaisesRegex(ValueError, "no load"):
            inspect_elf(data, "arm64-v8a")


class ApkContentsTests(unittest.TestCase):
    def entries(self):
        config = {"appId": "com.packingscanning.app", "loggingBehavior": "none",
                  "plugins": {"PackingAccount": {"serviceOrigin": ""}}}
        return [("lib/arm64-v8a/libsynthetic.so", elf()), ("AndroidManifest.xml", b"synthetic"),
                ("classes.dex", b"synthetic"), ("assets/public/index.html", b"app"),
                ("assets/capacitor.config.json", json.dumps(config).encode())]

    def expected(self):
        return {"index.html": hashlib.sha256(b"app").hexdigest()}

    def test_checks_native_library_and_actual_asset_bytes(self):
        with archive(self.entries()) as value:
            self.assertEqual(len(inspect_archive(value, self.expected())), 1)

    def test_refuses_duplicate_and_noncanonical_paths(self):
        for name in ["assets/public/index.html", "../private", "/absolute", "assets/../private", "lib\\bad"]:
            with self.subTest(name=name), archive(self.entries() + [(name, b"bad")]) as value:
                with self.assertRaises(ValueError):
                    inspect_archive(value, self.expected())

    def test_refuses_mismatched_or_missing_web_assets(self):
        with archive(self.entries()) as value:
            with self.assertRaisesRegex(ValueError, "does not match"):
                inspect_archive(value, {"index.html": "0" * 64})
            with self.assertRaises(KeyError):
                inspect_archive(value, {"missing.js": "0" * 64})

    def test_refuses_app_without_native_scanner_libraries(self):
        with archive(self.entries()[1:]) as value:
            with self.assertRaisesRegex(ValueError, "ARM64"):
                inspect_archive(value, self.expected())

    def test_refuses_live_reload_diagnostic_logging_and_account_enabled_qa_builds(self):
        for patch in [{"server": {"url": "http://localhost:5173"}}, {"loggingBehavior": "debug"},
                      {"plugins": {"PackingAccount": {"serviceOrigin": "https://account.invalid"}}}]:
            entries = self.entries()
            config = json.loads(entries[-1][1])
            config.update(patch)
            entries[-1] = (entries[-1][0], json.dumps(config).encode())
            with self.subTest(patch=patch), archive(entries) as value:
                with self.assertRaisesRegex(ValueError, "guest build"):
                    inspect_archive(value, self.expected())

    def test_allows_instrumentation_apk_without_bundled_web_or_native_code(self):
        with archive([("AndroidManifest.xml", b"synthetic"), ("classes.dex", b"synthetic")]) as value:
            self.assertEqual(inspect_archive(value), [])

    def test_refuses_archives_without_android_package_contents(self):
        for missing in ["AndroidManifest.xml", "classes.dex"]:
            with self.subTest(missing=missing), archive([item for item in self.entries() if item[0] != missing]) as value:
                with self.assertRaisesRegex(ValueError, "manifest or primary"):
                    inspect_archive(value, self.expected())


if __name__ == "__main__":
    unittest.main()
