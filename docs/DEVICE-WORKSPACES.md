# Protected device workspaces

Checkpoint: 2026-10-01. Enabled browser accounts can now have separate encrypted local packing workspaces. They retain offline planning, reference photos, adopted geometry, preparation forms, packed progress and opened household copies. Android now uses the same encrypted record workflow with scoped encrypted original captures; iOS protection remains unfinished. See [native connection and acceptance](NATIVE-CAPTURE-STORAGE.md).

## Create and use

In **Settings → Packing account**, sign in and save any newly issued recovery code. Open **Protect this account’s packs on this device**. Choose a device label and a separate device passphrase of 15–128 characters. Save that passphrase somewhere private and confirm the disclosure before creating the workspace.

The default creates an empty workspace. Optionally copy the current guest packs, library and reference photos after reviewing the checkbox. Copying leaves the guest originals unchanged and visible. It retains adopted geometry and source provenance, but excludes original native scan links; original files are not moved or deleted. No records upload during creation.

Use ordinary packing controls after unlocking. Changes and photos save encrypted in this workspace. Account backups and selected household publication still require their own explicit consent. Open shared packs from an unlocked protected workspace to keep those local copies encrypted. Opening them in guest storage leaves guest copies unprotected.

**Settings → Device workspace → Choose saved device workspace** opens the chooser. Reload also starts at the locked chooser when protected workspaces exist. Enter the relevant device passphrase to open saved records, including offline; server sign-in does not unlock them. **Use guest packs** opens the original separate guest store.

## Locking and accounts

**Lock workspace**, protected-account sign-out, a detected account change, hiding the page, leaving/reloading it, and five minutes without pointer/touch/keyboard interaction or a complete accepted packing voice command discard the opened key and remove packing content from the rendered application. Voice commands wait for live original-workspace authority, including Android native lease renewal, before changing records. Uncertain speech, recognizer restarts and automatic reading do not extend the idle window; expired authority cannot be revived by late activity. See [voice activity and remaining physical acceptance](PACKING-VOICE.md#enable-voice-explicitly). Locking one workspace also locks other open tabs using that workspace through the browser's BroadcastChannel. Changing accounts through the app informs other tabs. A detected server-account mismatch blocks account actions in the opened workspace and locks it.

A local passphrase authorizes offline access independently of a server session. Server membership removal, session revocation or account deletion cannot recall an already saved copy or invalidate its separate device passphrase. Server authorization continues to govern every account/household request.

Locking alone does not sign out the server account. The signed-in account's **Sign out of my account** control attempts server sign-out and locks the protected workspace even if that request fails. A failed attempt explicitly says that server sign-out was not confirmed; retry once connected. Guest packs remain visible after account sign-out.

## Passphrase, restore and removal

In **Settings → Device workspace → Device passphrase and local removal**, enter the current device passphrase to change it. The old passphrase stops opening the current stored workspace; existing copied browser storage or already opened keys cannot be recalled. This changes no server password. Account password recovery cannot recover a lost device passphrase.

An ordinary browser **Download backup**, or Android **Save backup file**, deliberately exports decrypted packing records and photos. Android uses system document dialogs while keeping normal workspace locking. A selected restore remains encrypted and unreadable until the original workspace is unlocked, then **Review selected backup** validates it and asks for replacement confirmation; that warning includes removal of existing original scans in this workspace. See [native backup files](NATIVE-BACKUP-FILES.md). That file is unencrypted; store it privately. Backup restore is confirmed and affects only the currently opened store. A protected restore preserves other workspaces, guest records and guest native files. References to original capture files cannot be restored from JSON. Cancelled restore changes no records.

**Delete all local data** removes records and photos in the current store and leaves other stores intact. In a protected workspace it retains an encrypted empty state and the device passphrase. **Remove this protected workspace** additionally removes its local workspace registration after confirmation and current-passphrase verification. It affects no other workspace, guest data, account, household or server backup. Platform browser-storage removal is a separate, broader action.

## Storage and concurrency

Guest data keeps the original `packing-scanning-local` IndexedDB database. Protected workspaces use `packing-scanning-protected`, with a workspace descriptor and encrypted state/photo records. Existing guest data is not automatically migrated, overwritten or deleted. There is at most one protected workspace per account and twenty per browser origin.

Each workspace uses a random 256-bit data key. Browser Web Crypto derives a wrapping key from the device passphrase with PBKDF2-HMAC-SHA-256, 600,000 iterations and a random 128-bit salt. AES-256-GCM with random 96-bit nonces authenticates the wrapped key and each state/photo record. Authenticated contexts bind the workspace, account wrapping identity and record identity. Opened data keys are non-extractable and held only in the active in-memory session. Descriptors persist no plaintext passphrase or usable plaintext key.

This uses browser [Web Crypto key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) and the PBKDF2 work-factor guidance from [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). It does not claim independent review, FIPS certification or protection against a compromised browser.

State and reference photo bytes are encrypted. Device labels, account identifiers, workspace IDs, revisions, record identifiers, sizes and creation dates remain observable in storage. Guest records and explicitly exported ordinary backups are unencrypted. Encryption does not protect decrypted content while opened, screenshots, copied files, malicious same-origin scripts, browser extensions with access, device compromise or someone who knows the passphrase. Strong device access controls remain necessary.

Each mounted packing app binds all storage operations to its own workspace session. Switching cannot redirect old asynchronous work into another store. Per-session writes queue in order; IndexedDB transactions compare revisions before committing. A stale tab refuses to overwrite newer records and asks for lock/unlock review. Closing a session refuses unfinished operations before commit. Photo transfer/restoration uses local bytes, preserving the server's restrictive connection policy.

## Verification and remaining acceptance

The web/server suite passes 246 tests in 31 files. Cryptographic checks reject altered ciphertext, wrong record/workspace identity and exported active keys. Closed-session operations fail before database use. Actual Chrome IndexedDB checks cover binary photos, account isolation, duplicate creation, conflicting tab writes, closing during a pending save, passphrase rotation, atomic scoped clearing, removal and guest preservation.

Desktop/mobile Chrome checks at 1440×1000 and 375×812 exercise explicit creation/copy, actual encrypted records/photos, photo display, confirmed packing progress, backup/restore cancellation and confirmation, reload/offline unlock, wrong-passphrase refusal, account-mismatch and cross-tab locks, failed offline sign-out with a warning and retained server cookie, accelerated idle locking, passphrase rotation and scoped removal. Tests use synthetic accounts, a tiny valid PNG and a real native-generated synthetic geometry fixture; no personal records or physical scans are used.

iOS protected workspaces, physical Android acceptance of original capture isolation under account switching, real-time synchronization, automatic merging, advanced household permissions and physical-device scan/packing acceptance remain unfinished. Browser storage retention, disk exhaustion, operating-system compromise, older browsers, real background/resume behavior and independent security assessment need further acceptance. This checkpoint does not complete the full product goal.

Subsequent native-access checkpoint: Android can use the account server via a fixed-origin HTTPS bridge, but native records/captures deliberately remain in guest storage. The local encryption workflow described here remains browser-only. See [native account access](NATIVE-ACCOUNTS.md).

Subsequent native-storage checkpoint: the Android encrypted capture core now supports revocable workspace scopes, authenticated original-file storage and isolated cleanup. Its native bridge, unlock interface and background-lock lifecycle are not connected yet; the running app still uses guest storage. See [implemented storage and remaining connections](NATIVE-CAPTURE-STORAGE.md).

Latest Android connection checkpoint: native unlock, lease-bound capture/read/reconstruction/cleanup and background-lock callbacks are implemented and compiled. Chrome boundary checks execute the actual Java encrypted store and Web Crypto/IndexedDB at desktop/mobile sizes. Android camera, OS callbacks and iOS remain unverified. The preceding native-access/storage paragraphs describe earlier checkpoints, not the current connection. See [current native workspace behavior](NATIVE-CAPTURE-STORAGE.md).

Latest reference-photo checkpoint: Android encrypts incomplete item drafts before native camera/provider handoffs. Background locking remains in force; read/resume requires a fresh lease for the original workspace/account. Explicit save commits the new record before old-photo removal. Pending drafts expire and are not durable across process/web restarts. See [photo workflow, privacy and acceptance limits](NATIVE-ITEM-PHOTOS.md).

## Transaction failure and explicit bag saves

Protected record mutations observe the transaction completion promise from creation. If an individual read/write rejects, the transaction is aborted where still active and its completion is settled before the error is returned. The in-memory revision advances only after the durable transaction completes. An aborted save can be retried in the same opened session without an unhandled transaction rejection or partially published record/revision.

Bag editors keep failed saves open and preserve their old records and native originals. Explicit acknowledged bag saves skip a redundant autosave of the same app-state object. New bag records and pack links commit together. This does not add autosave, recovery or encryption for an unsaved in-memory bag draft. Workspace revocation still blocks stale writes and cleanup. See [bag draft source behavior](NATIVE-CAPTURE-STORAGE.md#bag-draft-save-and-source-cleanup) and the dated [software evidence](QA-ANDROID-BUILD.md).
