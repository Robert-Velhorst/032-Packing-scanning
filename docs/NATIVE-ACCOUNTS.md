# Optional native account access

Checkpoint: 2026-10-01. Android now has a compiled account transport and an account screen connected to the existing private backup and household service. The iOS bridge and project registration are prepared in source but have not been compiled on this Windows host. The distributed debug APK has no account server configured. Guest scanning and packing remain available.

## Traveller behavior

An operator-configured installation displays its account server in **Settings → Packing account**. Registration, sign-in, recovery, password changes, private backup consent, revision conflicts, explicit restore, household invitations and selected-pack publication use the same server endpoints and authorization checks as the browser. Signing in fetches account information; it does not upload local records. Photos and original native capture files remain excluded from server backups and shared packs.

Signing in alone does not encrypt, migrate or separate guest records. Android can now explicitly create or unlock a protected device workspace, including encrypted originals from new captures. Signing out, account switching or forgetting device sign-in locks an opened workspace; original guest copies remain visible. Restore/clearing affects the selected scope only. iOS protected workspaces remain unavailable. See [native workspace behavior and acceptance](NATIVE-CAPTURE-STORAGE.md).

Account backup, recovery-code, account-export, household-code and shared-pack exports use an explicit system file-save dialog. Canceling does not claim a save succeeded. Exported files contain ordinary plaintext records or recovery/invitation secrets; the user chooses the destination. A chosen cloud document provider can upload the file under that provider's own behavior. The app performs no background export or message sending.

Confirmed server sign-out removes the native credential. If connectivity or secure storage fails, **Forget this device sign-in** separately removes the local saved session without requesting server revocation. Server sessions can remain until revoked or expired; downloaded records and guest packs remain. **Check account connection** allows recovery from an initially unreachable configured server without restarting the app.

## Operator configuration

Enable the server using [the existing account setup](ACCOUNTS.md), with an exact HTTPS `APP_ACCOUNT_ORIGIN`, its separately protected key and the intended registration policy. Native access requires HTTPS even for a local fixture. A publicly trusted certificate and normal hostname verification are required by the shipped transport; no certificate exception or test trust store is packaged.

Set the public build variable `PACKING_ACCOUNT_ORIGIN` to that same exact HTTPS origin before running `npm run cap:sync`. It accepts no username, password, path, query, fragment or trailing slash. Then build Android or compile iOS on a supported Mac. Clear the variable and sync again to produce an installation with accounts disabled. The origin is public configuration, never a credential. Web assets do not receive a session token or an arbitrary native HTTP client.

Deploying the server, configuring a real provider, distributing a release and uploading actual personal records require their own operator acceptance. This checkpoint performs none of those actions.

## Native boundary and stored sessions

`PackingAccount` exposes local availability, fixed-route requests, local session removal and selected file export. Callers cannot supply a URL, host, cookie, arbitrary header or redirect policy. A bounded serial queue avoids credential races. Ordinary requests are limited to 16 KiB, larger backup/shared requests to 16 MiB plus framing, and replies to 32 MiB; the server applies its tighter endpoint limits as well. Requests have time limits. Unsupported routes, queries, GET bodies, redirects, unsafe cookies and invalid envelopes fail closed. There is no automatic retry after an unconfirmed change.

The client sends the configured Origin and only the server's secure host-only session cookie. Existing server Host, Origin, CSRF, consent, membership, revision, rate and workload gates remain unchanged. Session headers never enter the JavaScript reply. Cookie replacement occurs after a validated reply; anonymous/unauthorized and expired sessions are cleared.

Android encrypts the private session record with AES-256-GCM using an app key in [Android Keystore](https://developer.android.com/privacy-and-security/keystore). The configured origin is authenticated with the ciphertext. Missing keys, corrupt records and an origin change cannot silently reopen the previous sign-in. Existing Android backup and transfer exclusions include the encrypted record. Hardware-backed key protection depends on the device; it has not been checked on a phone.

The prepared iOS source uses an app-specific, origin-bound [Keychain](https://support.apple.com/guide/security/keychain-data-protection-secb0694df1a/web) record with `WhenUnlockedThisDeviceOnly`, no synchronization, and a fresh-container guard against inheriting a session after reinstall. Its ephemeral URL session disables cookie storage, credential storage and URL caching and bounds streamed replies. This remains source-level work until Mac/device verification.

Native bridge logging is disabled because diagnostic responses can include private account information. Encryption at rest does not protect an opened app from malicious app scripts, an unlocked-device user or an operating-system compromise. Server backup encryption remains operator-managed, rather than end-to-end encryption unavailable to the server.

## Verification and remaining acceptance

The production web/server suite passes 252 tests across 32 files; production type checks/build pass. Android build, 43 native unit tests and lint pass with zero errors. Desktop JVM checks execute the production Java transport against the real AccountApi/AccountStore over isolated synthetic localhost TLS. They check native cookie retention/reopening, CSRF, consent, backup round trips/conflicts, household publication, password rotation, confirmed sign-out, expiry and local forgetting. Default trust rejects the synthetic certificate. Redirects, wrong MIME, oversized replies, trailing JSON and unsafe cookie policies are rejected without replacing a valid session.

Chrome checks at 1440×1000 and 375×812 run the production app through a simulated Capacitor promise boundary backed by that production Java transport and real HTTPS service. They cover registration, recovery-code export cancellation, explicit backup save/download, canceled/confirmed restore, shared-pack publication/download, guest-source preservation, failed sign-out, local forgetting, reconnecting and confirmed sign-out. Browser account cookies/requests are absent from this native path. File-dialog responses and disconnected-native conditions are simulated, not physical-device evidence. The JVM credential store is in-memory because Android Keystore is unavailable on desktop.

Physical Android secure-store persistence, OS file-save providers/cancellation, background/resume and native WebView network behavior remain unverified. iOS compilation, Keychain, file dialogs and device execution remain unverified. Physical acceptance of Android account-scoped captures/workspaces, iOS protection, automatic synchronization, merging, advanced household permissions and physical scan/packing acceptance remain required work. The full product goal is still active.

The preserved earlier native-account debug APK is `packing-scanning-0.1.0-android-native-accounts-debug-2026-10-01.apk` (8,102,985 bytes; SHA-256 `aa18b96e694a8ac593488e8fef8273575c9a2c8a3a3a01c30369d7e098df61fd`). Its signature, 16 KiB alignment and all seven production web assets match; the native bridge is present, account origin is blank, diagnostic logging is disabled and desktop test trust overrides are absent. Lint retains 21 warnings and zero errors. Prior APKs remain intact.

Existing browser account and encrypted-workspace journeys also pass on a separate fresh synthetic server fixture after these changes, including recovery/revocation, conflict/canceled/confirmed restore, actual encrypted IndexedDB photos, offline unlocking and scoped locks/removal. Disabled browser accounts and both missing/unconfigured simulated native bridges make no uploads; the native variants issue no account network requests. Test helpers and screenshots stay outside repository source.

The latest protected-workspace connection and artifact are documented in [native capture storage](NATIVE-CAPTURE-STORAGE.md) and [build verification](QA-ANDROID-BUILD.md). The earlier native-access test counts/artifact above describe that checkpoint; the current Android suite passes 59 tests and the web/server suite passes 256.
