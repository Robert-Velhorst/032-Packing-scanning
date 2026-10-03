# Household profiles and shared packing lists

Implementation checkpoint: 2026-10-01. Enabled browser accounts support private households, addressed invitations, selected shared packs, offline local copies, reviewed combination of newer versions and explicit publication of edits. This advances the controlled MVP's shared family lists and traveller-specific required items. Android native accounts connect to these same APIs through a fixed HTTPS transport and optional protected workspaces; physical acceptance remains outstanding. iOS is prepared in uncompiled source. See [native access and guest-storage limits](NATIVE-ACCOUNTS.md). Real-time synchronization, automatic conflict merging and advanced per-traveller permissions remain unfinished.

## Share one pack

A household is a group of packing accounts. A traveller on a list is a person being packed for; children and other travellers need no account. Every current household member can open, download and edit shared packs. The owner additionally controls invitations, member removal, ownership transfer and shared-record deletion.

Creating a household shares no packing data. Sharing requires separate consent for one selected local pack. The upload includes its travellers, travel details, entries and required flags, referenced items, selected bags, measurements and evidence, adopted shapes/interiors, preparation forms, bag assignments, saved positions, rejected attempts and progress. It excludes unused personal items, other private packs, local settings, reference photos and original scan links/files. Malformed references and unknown extra fields are rejected. The personal account backup stays separate from household access.

The interface names the receiving household and explains that all members can edit and download these sensitive records. No public share link, email, notification or automatic upload is created.

## Invite and join

In **Settings → Packing account → Household sharing**, create a household or select one to review. Owners invite an existing account username. A fresh private code is displayed once and can be downloaded deliberately. It expires after 48 hours, is addressed to that account and works once. Creating it sends no message. Give the code privately to that person; never place it in a public URL.

The invited person signs in to the addressed account, opens **Join an invited household**, enters the code and confirms membership. Other accounts cannot redeem it. Reissuing invalidates the previous code; owners can revoke pending invitations. Members see each other's account display names and usernames after joining.

## Work offline and publish

Review a selected local pack, consent and choose **Share selected pack**. The original private pack and source files stay unchanged; the shared version opens as a separate working copy. Other members choose **Open separate local copy**. Its references are remapped without colliding with existing records, retaining traveller-specific requirements, bags, forms, source provenance and packed geometry.

Use ordinary planner, item/bag editors and packing steps on that copy. Edits and confirmations are saved locally and remain available offline. Returning to household settings does not publish them. **Publish this shared copy** requires fresh consent and the exact server revision from which it was opened.

A newer server version blocks stale publication. Open it separately, or choose **Review newer shared version** on a copy with a saved comparison baseline. Independent changes have proposed selections; conflicts, required-item/constraint changes and differing saved local positions require explicit choices. Inconsistent references hold opening. **Open combined local copy** preserves earlier records and does not publish. Review the resulting plan, then consent again to publication. Older copies without a baseline can still open a separate version; a successful matching-revision publication establishes their baseline. See [combined-copy behavior and limits](SHARED-PACK-COMBINATION.md). No background polling or automatic synchronization occurs.

**Download shared pack** exports one accessible server version and its revision. Account export contains current household membership and pack summaries; download shared packs individually for their full content. A local backup includes opened copies and version links, but restoring it does not restore server membership or revive invitations.

## Ownership and deletion

Members can leave. Owners can remove another member, but must transfer ownership or delete the household before leaving themselves. Transfer to another current member requires confirmation and current-password verification; the old owner then remains a member.

Account deletion is blocked while owning a household with other members. Transfer ownership or deliberately delete that household first. Deleting a member account removes its membership and invitations, preserving the remaining group's shared packs. A sole owner's household is deleted with that account. Shared records show a deleted-publisher marker rather than a removed profile.

Owners can delete a reviewed shared pack after confirmation; newer revisions block stale deletion. Household deletion requires confirmation and password verification, then removes current memberships, invitations and shared packs. Cancellation preserves the group. Removed access cannot recall local/downloaded copies or operator snapshots. Local-device deletion and backup retention remain separate controls.

## Server boundaries and limits

Households use the same optional service, exact HTTPS origin, key and SQLite database as [accounts](ACCOUNTS.md), with no additional provider. Accounts stay disabled by default. Tables are added without replacing private backups. Household names and shared payloads use the account service's AES-256-GCM with separate authenticated contexts. The operator can decrypt with the master key; this is encryption at rest, not end-to-end encryption.

Every operation checks current membership. Owner operations also check current ownership, including after asynchronous password verification. Subsequent requests enforce removal even when a browser still shows old controls. Session, Host/Origin and authenticated-mutation CSRF gates apply. Non-members cannot read packs through guessed IDs. These choices follow [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html); they do not establish an independent security assessment.

Limits: five owned households and twenty memberships per account; twenty members and pending invitations per household; ten packs per household; 8 MiB per upload; 500 referenced items, twenty bags/travellers, 1,000 entries and 2,000 instances per pack. The installation allows at most 1,000 households. Household requests are bounded at 180 per account and 600 per peer over fifteen minutes; in-memory counters reset on restart. Proxy users can share a peer limit. Hosting still requires proxy limits, storage monitoring and a retention policy.

Sensitive operations and shared-pack reads add action/timestamp events to capped account audit history. Codes, passwords and request bodies are not logged. API responses are `no-store`; the service worker bypasses API requests. Local copies deliberately remain after sign-out. Optional protected browser workspaces now provide an encrypted local cache; guest copies remain unprotected. See [device workspaces](DEVICE-WORKSPACES.md).

## API contract

Prefix: `/api/v1/account`. Existing success/error envelopes and Host/Origin/session/CSRF rules apply. IDs are server UUIDs; query parameters and GET bodies are rejected.

| Method and route | Input | Result |
| --- | --- | --- |
| `GET /households` | None | Accessible household summaries. |
| `POST /households` | `name` | 201; new group and Location. |
| `GET /households/:id` | None | Members, pack summaries and owner-only invitation metadata; no codes. |
| `POST /households/:id/invitations` | `username` | 201; new addressed code, expiry and Location. |
| `DELETE /households/:id/invitations/:inviteId` | None | 204; owner revokes invitation. |
| `POST /households/memberships` | `code`, `consent: true` | 201; membership and Location. |
| `DELETE /households/:id/members/:userId` | None | 204; member leaves or owner removes a non-owner. |
| `POST /households/:id/ownership` | `userId`, `password`, `confirm: true` | 200; transfer to current member. |
| `GET /households/:id/packs` | None | Current pack summaries. |
| `POST /households/:id/packs` | `records`, `consent: true` | 201; selected-pack version one and Location. |
| `GET /households/:id/packs/:packId` | None | Full current selected-pack snapshot. |
| `PUT /households/:id/packs/:packId` | `records`, `consent: true`, `revision` | 200; replace matching revision. |
| `DELETE /households/:id/packs/:packId` | `revision`, `confirm: true` | 204; owner deletes reviewed version. |
| `DELETE /households/:id` | `password`, `confirm: true` | 204; owner deletes current group records. |

Failures include 401 expired sign-in; 403 owner/Origin/CSRF gate; 404 inaccessible group, pack or invitation; 405 method; 409 stale version or ownership state; 413 size; 422 invalid records, consent or quotas; and 429 work limits. No response supplies another member's private backup. Network timeouts do not establish publication failure: reload metadata and compare revisions before retrying.

## Verification boundary

The current web/server/tool suite passes 492 tests in 53 files. Store and real HTTP checks cover addressed invitations, consent, single use, expiry/revocation, isolation, private-vault separation, encrypted persistence, conflicts, ownership, membership loss, deletion safeguards and limits. Model checks cover separate/combined copies, ID/reference round trips, retained packed geometry, malformed baselines and extra-field rejection. The new real HTTP combination test covers two members, an explicit revision 3 publication, later stale writes and membership revocation.

Isolated desktop/mobile Chrome exercises real two-person publication with synthetic accounts and an actual native-generated synthetic derivative. Packed progress is published, stale writes preserve local records, newer copies preserve earlier work, private records/source links stay excluded, and ownership/removal, cancelled/confirmed deletion and offline use after removal are checked. Page identity, meaningful content, overlays, console, screenshots and interactions are checked separately from compilation.

No real invitation was sent, personal records uploaded, hosting deployed, phone camera/microphone exercised or physical fit certified. Android native account transport and protected workspaces have local/simulated verification; physical native acceptance and iOS compilation remain outstanding. Real-time synchronization, automatic merging, advanced permissions and physical scan/packing acceptance remain product work. Current CUA desktop/phone-width combination evidence and the exact verification boundary are in [the combination checkpoint](SHARED-PACK-COMBINATION.md).

Subsequent local-privacy checkpoints: optional [protected device workspaces](DEVICE-WORKSPACES.md) encrypt account-specific local records and reference photos, retain offline access, and lock on logout. Android capture storage is connected to the protected workspace in source and simulated-boundary checks. Existing guest copies and deliberate ordinary exports remain unencrypted; physical Android/iOS acceptance remains outstanding.
