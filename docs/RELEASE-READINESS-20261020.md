# Release readiness checkpoint — 2026-10-20

This records the dated private-server checkpoint and its follow-up, not full
production or physical-device acceptance. It is not a live host inspection.
For current mobile implementation and exact-head CI requirements, see
[release integration](RELEASE-INTEGRATION.md). Source/runtime release at this
checkpoint: `7179938`. Intended public origin:
`https://032-packing-scanner.noodzakelijkonline.de`.

## Verified

- Docker build on Node 26.12.0: 562 tests in 66 files passed; benchmark-tool
  type check, application/server type checks and Vite production build passed.
  The existing lazy Three.js chunk still produces a size warning.
- `npm audit --audit-level=moderate`: zero advisories with the scoped xcode
  override to uuid 11.1.1. Upstream advisory:
  [GHSA-w5hq-g745-h8pq](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq).
  CommonJS xcode parsed the actual iOS project, generated valid unique IDs and
  serialized an in-memory project change. This does not compile iOS.
- Final-image smoke test: UID/GID 1000, read-only filesystem, capabilities
  dropped, homepage/readiness and source-file refusal; synthetic account
  registration, secure-cookie attributes, graceful stop and successful login
  to the same persisted account after restart. The test sends a synthetic
  HTTPS Host/Origin through loopback HTTP; it does not test public TLS.
- Base + Hetzner Compose config validates. Image archive SHA-256 matched after
  authenticated SSH transfer to the selected General-Server.
- On General-Server, `packing032-packing-1` is healthy and bound only to
  `127.0.0.1:3001`, with the configured 768-MB limit. `/health/ready` returns
  `{"status":"ok"}`. Account and weather status both report unavailable.
- Existing shared Caddy configuration was copied into the release directory;
  the current file and backup checksums match. The proposed combined Caddy
  config validates. It has not been applied at this checkpoint.

Image config ID:
`sha256:aa9b803b12171e140476ecaf2e2ba54eb6d1f9622db199b83851bf401014eee7`.
Transferred `packing-scanning-7179938.tar` SHA-256:
`f5901bd8d8ee2f9872f843edae919c81ba1c2a73dca62ac45d5bf812f3ac2f58`.
Release directory: `/opt/packing032/releases/7179938/`.

## Remaining release gates

- GitHub CI and CodeQL for PR #51 are queued at this checkpoint; no remote
  pass is claimed. Local verification above used the actual Linux image.
- Public cutover awaits the required confirmation for new public exposure.
  The DNS A record is absent, Caddy is not connected to the packing network,
  and the proposed site has not been loaded. Public DNS/TLS/browser acceptance
  therefore remains unverified.
- Off-host account backup storage/scheduling, a real restore rehearsal,
  independent monitoring and operator alerts must be established before real
  accounts are accepted. Accounts/registration remain disabled on staging.
- Android physical-device acceptance and release signing, remaining iOS native
  feature parity and device acceptance, and physical scan/fit/closure/replanning
  trials remain required. No mobile or physical acceptance is inferred from
  the web/server tests.

Follow the [Hetzner deployment and recovery runbook](HETZNER-DEPLOYMENT.md)
for the next steps. Preserve the shared services and all data volumes.

## Backup tooling follow-up in PR #51

The new `server/account-backup.ts` command creates a consistent SQLite online
snapshot without reading the encryption key, checks integrity/schema/foreign
keys, returns a SHA-256, and refuses overwrite. Publication uses a private
temporary file and an atomic hard link. The backup is still private account
data, and its matching key must be recovered separately.

Verified after adding this tool:

- Node 26.12.0 Linux image build: **567 tests in 67 files passed**, benchmark
  tooling type check and production type checks/build passed. The test runner
  now uses two workers to bound parallel CPU/memory use; assertions and the
  pre-existing test time limits are unchanged. Earlier runs in the shared local
  Docker environment hit time limits, including an existing account HTTP test.
- All five operator snapshot tests also passed on Windows under a separately
  downloaded official Node 26.12.0 runtime with verified archive SHA-256. Tests
  cover committed WAL records, encrypted-vault recovery, wrong-key refusal,
  snapshot immutability after source edits, actual CLI use, overwrite and
  invalid-source refusal, competing backups and aborted-copy cleanup.
- The new final-image smoke passed locally after a transient account-request
  timeout in the shared Docker environment. It then passed on General-Server
  with the app limited to **768 MB, 0.5 CPU and 128 processes**, using an isolated
  synthetic account volume and loopback port. Both an in-container snapshot and
  a separate helper container with the source volume mounted read-only passed.
  Sign-in to a copy of the snapshot and account persistence after graceful
  restart passed. The synthetic containers/volumes were removed afterward.
- Hetzner's system Node 18 was unsuitable for this driver and exited during
  startup; those two synthetic fixtures were explicitly removed after checking
  their test-volume ownership labels. The successful run used an isolated copy
  of the image's verified Node 26 binary, without replacing the system runtime.
- Node 26 xcode parsing/UUID/serialization checks and npm audit passed, with
  zero advisories. Public DNS/TLS, off-host backup storage and scheduling,
  operator recovery rehearsal, alerts and mobile/physical acceptance remain
  outstanding. No real account records or encryption key were backed up.

The tested image is `packing-scanning:backup-readiness-20261020`; its identity
on the Hetzner Docker engine is
`sha256:ef97d2ead78d2eb21607d35aa02313f851656f9f7cb44478b95e09f918ebb2dc`.
The transferred QA archive SHA-256 is
`0b64bbf521987fbc380977e809694540d6a6aa86e5e56836c882aa51f651d34a`.
QA logs/archive/runtime are in `/opt/packing032/qa/backup-20261020/`.
The private long-running staging service still uses release `7179938`;
loading and testing the new image did not upgrade it or expose it publicly.
