# Release readiness checkpoint — 2026-10-20

This records verified preparation, not full production or physical-device
acceptance. Source/runtime release: `7179938`. Intended public origin:
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
- Android physical-device acceptance and release signing, iOS compilation and
  remaining native feature parity, and physical scan/fit/closure/replanning
  trials remain required. No mobile or physical acceptance is inferred from
  the web/server tests.

Follow the [Hetzner deployment and recovery runbook](HETZNER-DEPLOYMENT.md)
for the next steps. Preserve the shared services and all data volumes.
