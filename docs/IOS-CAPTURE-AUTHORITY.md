# iOS capture authority and authenticated-file core

`PackingCaptureAuthority` implements the runtime lease and cryptographic boundary
used by the protected iOS capture bridge.
It is compiled into the native target and exercised directly by Mac CI.
`PackingScanPlugin` now exposes the revision/lease handshake and opens encrypted
capture storage only for the selected workspace. See the [bridge workflow](IOS-CAPTURE-BRIDGE.md).
File/photo staging, retention and device acceptance remain separate
unfinished work; the handshake is not proof of those features or server identity.

## Authority

The manager starts locked. Deliberate guest selection or protected-workspace
opening requires the current revision. Every selection issues a fresh lease;
retained accesses stay bound to the old selection and are revoked on replacement,
lock, idle expiry or manager destruction. A stale close cannot lock a newer
selection. Failed identity/key validation preserves a valid current selection.

Protected opening requires canonical workspace/account UUIDs and a 32-byte
borrowed data key. The core owns a separate byte array and never writes the key,
preferences or a session file. Revocation overwrites that owned array before
release. Swift value semantics, compiler behavior, CryptoKit copies and memory
reclamation cannot guarantee complete secret erasure; callers must release their
own borrowed copies too. A retained access does not keep its manager alive.

Only explicit accepted interaction through `touch` renews the five-minute
monotonic idle deadline. Reads, writes and state checks do not. Exact expiry,
backward/invalid clock readings and a suspended operation crossing expiry revoke
protected access. Touch uses one initial time snapshot and checks again before
returning, so resuming after suspension cannot grant a fresh idle window.
The recursive lock serializes selection, revocation and checked file operations;
results are checked again before returning. Native lifecycle hooks must still
close the manager when the bridge/workspace integration is implemented.

## File envelope

The core uses CryptoKit's authenticated
[`AES.GCM.seal`](https://developer.apple.com/documentation/cryptokit/aes/gcm/seal(_:using:nonce:authenticating:))
and open operations with a fresh default random nonce. Its `PSC1` envelope has
the same layout as the Android core: four header bytes, a 12-byte nonce,
ciphertext and 16-byte tag. The
[`combined` representation](https://developer.apple.com/documentation/cryptokit/aes/gcm/sealedbox/combined)
provides the nonce/ciphertext/tag ordering.

Authenticated additional data binds the existing versioned capture purpose,
workspace UUID, account UUID, capture UUID and logical filename. Only
`points.ply` and `capture.json` are accepted, bounded respectively to 8,000,000
and 20,000 plaintext bytes, plus the exact 32-byte envelope overhead when sealed.
Guest accesses cannot use protected encryption. Unknown names, traversal,
malformed/oversized envelopes, wrong keys, identity changes and corrupted data
fail before plaintext is returned. There is no plaintext fallback.
The iOS persistence module additionally uses a dedicated workspace/account-bound
key-check context for an encrypted public constant. This confirms that a supplied
key matches an existing store; it neither persists the key nor reuses a capture's
authenticated purpose.

This primitive does not yet encrypt Object Capture images, checkpoints or USDZ
models, provide atomic file publication or manage scratch files. Those files
must not be described as protected workspace captures merely because this core
exists. Existing [guest capture file policy](IOS-CAPTURE-FILES.md) is separate.
The [protected point/metadata store](IOS-ENCRYPTED-CAPTURE-STORE.md) adds scoped
authenticated persistence and publication separately; its bridge and capture
workflow are still unfinished.

## Verification boundary

Native CI executes the actual Swift implementation for selection/revocation,
stale access/close, key ownership, exact idle expiry, interaction renewal,
operation/touch suspension, clock failures, envelope bounds and mutation of the
header, nonce, ciphertext and tag. It checks workspace/account/capture/purpose
binding and guest/unknown-purpose refusal.

A public synthetic fixture created with Node/OpenSSL must authenticate in
CryptoKit. The native tests then encrypt a new fixture with a random nonce;
the independent Node/OpenSSL check must authenticate it in the other direction.
The fixed sequential key and all fixture content are synthetic and public.
This proves provider compatibility for these fixtures, not a general cryptographic
audit, Java runtime acceptance or portable original-file backup support.

The workflow also compiles the real simulator Debug and unsigned device Release
targets. Production workspace/camera/file lifecycle and device memory behavior
remain unverified until their native bindings, persistence paths and physical
acceptance are completed. The full product goal remains open.
