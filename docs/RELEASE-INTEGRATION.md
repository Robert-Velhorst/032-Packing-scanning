# Combined release and acceptance gates

The `codex/release-integration-20261020` branch combines the Android package
handoff, iOS printing, iOS voice and iOS capture-file changes from PRs
[#55](https://github.com/Robert-Velhorst/032-Packing-scanning/pull/55),
[#56](https://github.com/Robert-Velhorst/032-Packing-scanning/pull/56),
[#57](https://github.com/Robert-Velhorst/032-Packing-scanning/pull/57) and
[#58](https://github.com/Robert-Velhorst/032-Packing-scanning/pull/58).
Their separate results do not prove the combined source builds. Inspect the
matching integration PR's source-bound CI results and retained diagnostics.

## Combined-source requirements

| Path | Required evidence |
| --- | --- |
| Web/server | Full suite on both supported CI Node versions, production type checks/build, benchmark tooling check and final-image runtime checks |
| Android | Native unit tests, debug/test/release assemblies, lint, APK verifier tests and verified exact-file QA artifact with matching source receipt |
| iOS project | Account, scan, print and voice bridge registration; one Sources entry for every Swift file, with no merge markers or lost declarations |
| iOS native | Production capture-filesystem checks, 11 Swift voice-result policy cases, simulator Debug and unsigned device Release builds |
| Static analysis | All configured CodeQL languages at the integration head; a skipped aggregate or earlier source is not a pass |

The merge keeps both native test paths: capture-filesystem checks in the workflow
and voice policy checks in the build helper. The combined Android artifact must
match its own web assets, native libraries, signatures and source revision.
Earlier APKs do not establish that handoff. Packages remain temporary guest QA
builds; they are not signed production releases.

## Required work beyond compilation

- Public Hetzner DNS/Caddy HTTPS cutover and public browser/TLS acceptance remain
  pending the requested approval. The private host checkpoint is recorded in
  [release readiness](RELEASE-READINESS-20261020.md); it must be refreshed before
  any cutover. No integration branch or CI run updates the server automatically.
- Keep accounts disabled until operator-selected off-host backups, scheduling,
  recovery rehearsal, independent monitoring and alerts are established. The
  tested synthetic snapshot/restore path does not prove those operations.
- Complete iOS account-bound encrypted device workspaces and capture storage,
  native backup/import files, reference-photo workflows and occupied USDZ shape
  extraction. The guest capture's OS file protection does not satisfy those
  missing implementations. Other native guidance/retention gaps remain subject
  to their source-specific acceptance documents.
- Exercise supported Android and iPhone/iPad hardware: permissions, camera/depth,
  file providers, voice/audio, printing, lifecycle interruptions, storage limits,
  offline use and 16 KB Android runtime behavior. CI compilation and policy tests
  do not execute those device paths.
- Complete production signing/provisioning and platform distribution acceptance.
- Run the README's controlled-MVP physical benchmark trials with independent
  dimensions/mass, fit, closure, replanning and accessibility results. Synthetic
  solver/mesh fixtures do not satisfy those trials.

The full product objective stays open while these items are incomplete. The
individual implementation/QA documents retain their dated, source-specific
evidence rather than silently replacing older measurements with current claims.
