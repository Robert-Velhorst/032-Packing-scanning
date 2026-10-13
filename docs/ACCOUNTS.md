# Optional accounts and private backups

Implementation checkpoint: 2026-10-01. Accounts are an optional browser service on an explicitly enabled installation. Guest packing remains local and works offline. Private backups and explicit restore stay separate from [household selected-pack sharing](HOUSEHOLDS.md), which now supports addressed invitations, member edits and manual publication. Android account transport and native UI are now implemented; iOS source is prepared but uncompiled. See [native account access and its verification boundary](NATIVE-ACCOUNTS.md). Automatic synchronization and protected native workspaces remain unfinished.

## Traveller workflow

Open **Settings → Packing account** on an enabled server. Create a username and a 15–128-character passphrase, then save the displayed one-use recovery code somewhere private and separate from the password. No email service is involved. Registration can be closed by the operator. Recovery and password changes replace the recovery code and revoke previous sessions.

Signing in loads account identity, backup version metadata and household summaries. It does not upload, download or replace packing records. Review the included local packs, then explicitly consent before each save. All packs in the current device workspace, names, travel details, item and bag measurements, weights, adopted shapes, forms, provenance and progress are included. Other protected workspaces are excluded. Photos, photo links and original native scan links/files are excluded. Source captures and reference photos remain on the device when saving.

A save replaces the account's current backup only if its revision still matches. A stale save receives a conflict; local records stay unchanged. Reload the account version and review before choosing to save again. No background merging or automatic retry is performed.

**Download account backup** retrieves the packing JSON only when selected. **Restore account backup on this device** retrieves it, validates it and asks for confirmation before replacing local records. Cancellation leaves local data unchanged. Confirmed restore affects the current device store, retaining adopted packing derivatives and removing obsolete source references and reference photos absent from the metadata backup. Guest restore also clears guest native captures; protected restore leaves guest records/files and other workspaces intact. Export local records and photos before restoring if they need to be retained.

The security controls download profile, current backup, household membership/pack summaries and up to 500 audit actions; revoke other sessions; change password; or delete the account after confirmation and current-password verification. Sign-out and account deletion lock an opened protected workspace and leave its encrypted records and downloaded copies on devices. Guest records remain visible. Local data removal is a separate setting. Deletion cascades through current server records and checkpoints the database journal; it cannot erase operator snapshots, filesystem snapshots, downloaded copies or prove physical erasure on storage hardware.

## Enable a local installation

Node.js 22.18 or newer is required. Accounts use native [Node SQLite](https://nodejs.org/docs/latest-v22.x/api/sqlite.html), which is experimental in Node 22. Browser/runtime checks for this checkpoint use Node 24.19.0. The Docker configuration is prepared separately; it has not been deployed.

Accounts default to disabled. Configure both `APP_ACCOUNT_ORIGIN` and `APP_ACCOUNT_KEY_FILE`, or neither. The key must be exactly 32 raw random bytes, kept separately from the database and outside the checkout. Generate it once with exclusive creation; never print it or replace an existing key:

```js
// Run with Node, substituting a private, existing parent directory.
const { writeFileSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
writeFileSync('/private/packing-account.key', randomBytes(32), { flag: 'wx', mode: 0o600 });
```

On Windows, restrict access through the file's Security permissions; Unix mode flags do not establish a Windows ACL. Back up the key securely, separately from the database. A lost key makes profiles and backups unreadable. The store rejects a mismatched key; automatic key rotation is not implemented.

| Setting | Meaning |
| --- | --- |
| `APP_ACCOUNT_ORIGIN` | Exact HTTPS origin, with no path or trailing slash; loopback HTTP is accepted only for local use. |
| `APP_ACCOUNT_KEY_FILE` | Private raw 32-byte key file; relative paths resolve from the project. |
| `APP_ACCOUNT_DB_FILE` | Writable SQLite file; defaults to `.account-data/accounts.sqlite`. |
| `APP_ACCOUNT_ALLOW_REGISTRATION` | Only the literal `true` opens account creation; defaults to closed. |

For a browser check on this machine, use an origin such as `http://127.0.0.1:3001`. On a hosted installation, serve the app and API on the same HTTPS origin and preserve the public Host and Origin headers through the reverse proxy. Do not enable account requests from the separate Vite development origin; use the built same-origin app. No account CORS access is granted. Forwarded headers are not trusted for identity or rate limits.

For containers, the optional overlay is prepared for an already configured HTTPS reverse proxy:

```sh
docker compose -f deploy/compose.yaml -f deploy/compose.accounts.yaml config
```

Set `PACKING_ACCOUNT_ORIGIN`, `PACKING_ACCOUNT_KEY_FILE` and, only when needed, `PACKING_ACCOUNT_ALLOW_REGISTRATION=true`. The overlay supplies a read-only secret and a writable account-data volume. The base service stays loopback-bound. Configure the proxy and private key permissions before any deployment. Application data and key patterns are excluded from Docker build context. This command reviews configuration; no hosting or deployment is implied.

## Storage, limits and security boundaries

Profiles and packing backups use AES-256-GCM with fresh nonces and account-bound authenticated context. The operator supplies the master key; this is encryption at rest, not end-to-end encryption. An operator with the running server/key can decrypt records. Usernames are indexed by a keyed hash; passwords use individually salted scrypt (`N=2^17`, `r=8`, `p=1`), following the [OWASP scrypt guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Recovery codes and session tokens are hashed with domain-separated keyed hashes before storage.

Sessions use HttpOnly, SameSite=Strict cookies, with Secure and the `__Host-` prefix on HTTPS. Sessions expire after 30 minutes idle or 12 hours total, with at most five retained per account. Authenticated changes require a per-session CSRF value and the exact Origin; Host is checked too. The enabled app sends a same-origin content security policy. Account responses are `no-store`, and the service worker bypasses every API request. These choices follow the [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html); they do not establish a completed independent security assessment.

Each backup is limited to 16 MiB. The store permits at most 1,000 accounts, four concurrent bounded body readers and two concurrent password calculations. Authentication attempts are limited per peer and username over 15 minutes; these limits are in memory, shared across users behind the same proxy peer and reset on restart. Internet deployment still requires appropriate proxy request limits, storage monitoring, an operator retention policy and acceptance of the experimental Node 22 SQLite dependency. Audit records contain actions and timestamps, not passwords, recovery codes or request bodies.

## API contract

Prefix: `/api/v1/account`. Successful JSON responses use `{ "data": ... }`; failures use `{ "error": { "code": "...", "message": "..." } }`. No query parameters or GET bodies are accepted. JSON mutations require `Content-Type: application/json` and the exact configured Origin. Authenticated mutations additionally require the session cookie and `X-Packing-CSRF` from the session response. Account ownership is derived from that cookie, never a supplied user ID.

| Route and method | Input | Result |
| --- | --- | --- |
| `GET /session` | None | Availability, registration flag, profile or null, CSRF or null. Disabled installation returns availability false. |
| `POST /registrations` | `username`, `name`, `password` | 201; profile, CSRF, one-use recovery code; session cookie. |
| `POST /sessions` | `username`, `password` | 200; profile, CSRF; session cookie. |
| `POST /recovery` | `username`, `recoveryCode`, `newPassword` | 200; new profile/session/CSRF and recovery code; old credentials revoked. |
| `DELETE /session` | None | 204; current session revoked and cookie cleared. |
| `DELETE /sessions` | None | 200; other sessions revoked. |
| `GET /vault` | None | Revision, save date and hasBackup flag; no packing records. |
| `PUT /vault` | `revision`, `consent: true`, `backup` | 200; new revision and save date; shared packing schema validation. |
| `GET /vault/backup` | None | Current revision/date/packing backup, or 404 when absent. |
| `GET /export` | None | Profile, current vault and capped audit history; no credential hashes or session tokens. |
| `POST /password` | `currentPassword`, `newPassword` | 200; fresh session/CSRF/recovery code; previous sessions revoked. |
| `DELETE /` (prefix root without trailing slash) | `password`, `confirm: true` | 204; account and current server records deleted; cookie cleared. |

Failure statuses: 400 malformed input, 401 invalid credentials/expired session, 403 origin/Host/CSRF or registration gate, 405 unsupported method with Allow header, 408 timed-out body, 409 revision or credential conflict, 413 size limit, 415 non-JSON, 422 invalid account/backup/consent, 429 bounded attempts/work with Retry-After, and 503 unavailable service. Network timeouts do not prove a save failed: reconnect and reload the current account version before choosing to retry.

## Verification boundary

The web/server suite passes 246 tests in 31 files, and both production type checks/build pass. Store tests exercise encrypted persistence, wrong-key refusal, ownership isolation, revision conflicts, source preservation, expiry/revocation, single-use concurrent recovery, credential rotation during an in-flight sign-in, deletion and resource limits. Real HTTP tests cover cookies, Origin/Host/CSRF gates, closed registration, methods and bounded bodies. Isolated desktop/mobile Chrome checks exercise the complete browser account and metadata-backup workflow with synthetic users and a real native-generated synthetic derivative. The enabled server's content security policy is present; no unexpected browser errors or warnings occurred. Existing form, cavity and bag-weight browser regressions pass. Disabled-server and simulated native guest checks confirm no uploads and no native account requests. The Android debug build and lint complete; unchanged native unit tasks are up-to-date, with all 40 existing passing results checked, zero lint errors and 21 retained warnings. No real personal account, external upload, deployment, phone, camera or microphone was exercised. Basic household selected-pack sharing now passes its own tests and browser checks; see [household workflow and remaining limits](HOUSEHOLDS.md). Physical scan acceptance, protected native workspaces, iOS/device acceptance, automatic synchronization and advanced household permissions remain required product work.

Subsequent local-privacy checkpoint: optional [protected browser device workspaces](DEVICE-WORKSPACES.md) now encrypt account-specific local records and reference photos, retain offline access, and lock on logout. Existing guest copies and deliberate ordinary exports remain unencrypted; native account workspaces remain unfinished.

Subsequent native-access checkpoint: Android adds a fixed-origin HTTPS transport, Keystore-encrypted session storage, explicit system file exports and local session forgetting. Native records/captures remain guest data. The web/server suite now passes 252 tests in 32 files; Android passes 43 unit tests and lint with zero errors. Production Java transport and desktop/mobile native-boundary UI checks pass against a real synthetic local HTTPS account server. Device secure storage and file dialogs were not executed; iOS was not compiled. See [native account details](NATIVE-ACCOUNTS.md).

Latest Android workspace checkpoint: Android now connects protected records/photos to encrypted original captures through explicit workspace unlocking and scoped requests. Sign-in alone leaves guest records unchanged. Sign-out/forget/account switching locks protected access; iOS protection and physical device acceptance remain unfinished. See [native workspace behavior](NATIVE-CAPTURE-STORAGE.md).
