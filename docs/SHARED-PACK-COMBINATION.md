# Review newer household changes

Implementation checkpoint: 2026-10-01. A linked household copy can compare its offline edits with a newer shared version and open a separate combined copy. Publication remains an explicit, consented account request. This is reviewed version combination; real-time synchronization and automatic publication remain unfinished.

## Use the review

1. In **Settings → Packing account → Household sharing**, choose the household and your linked local pack.
2. Choose **Review newer shared version**. The app reads the current version from the account service. It does not upload, replace or change local packing records.
3. Independent edits have a proposed selection. Choose explicitly for conflicts, required-item or constraint changes, and differences involving a saved local packed position. **Show only changes needing an explicit choice** filters the review; other independent selections remain in the result. Long reviews show twenty records per page.
4. Choose related records consistently. For example, keeping an entry while deleting its referenced item cannot produce a valid copy. The app holds the result with an explanation instead of silently dropping requirements or repairing references.
5. Choose **Open combined local copy**. Both earlier copies and their source files remain available. Only items referenced by the resulting checklist enter the new copy; photos and original capture links are excluded under the existing shared-pack contract.
6. Inspect the resulting plan and recorded evidence. To share it, consent again and choose **Publish this shared copy**. A later server revision still blocks publication; compare again before retrying.

Dismissal changes neither local copies nor server records. Offline comparison requests fail with a reconnect message; saved copies remain usable offline. Opening another person's version records their reported measurements and progress, not independently verified physical observations.

## Positions and constraints

A differing locally saved packed position has only **Keep this local record**. The review cannot replace its coordinates, rotation, dimensions, bag, geometry or form identity. To accept a different physical position, first deliberately unlock or correct it in the earlier copy and compare again. Choosing a required entry or item deletion that leaves saved progress unsupported holds the combined result.

Incoming changes to existing required entries or bag/compartment assignments, carrier rules and keep-apart rules require explicit review. So do item removal, relaxation of fragility/upright/stacking restrictions, relaxation of a recorded bag weight or lid-clearance limit, and changes to existing unavailable areas or compartments. Changing an item or bag used by a saved placement also requires a choice. New or stricter independent records still pass the normal shared-record validation. The planner continues to report resulting conflicts without moving saved positions.

Items, bags, entries, rules and per-copy progress are selected as whole records. A dimension from one copy is not silently combined with the other copy's evidence or adopted geometry. Different edits to separate fields of the same item still require choosing that item record as a whole. Inspect detailed geometry and evidence in the resulting copy before publication.

## Local comparison baseline

Newly opened versions and confirmed publications store a versioned SHA-256 map for pack identity, name, approach, trip context, travellers, entries, selected items/bags, rules and per-copy progress. The baseline contains canonical record identifiers and hashes, rather than another full geometry payload. Item update timestamps do not create semantic conflicts; array order remains significant. Hashes describe a locally prepared comparison baseline, not authenticated server attestations or proof of physical accuracy.

The selected records and version link must still match when a review is accepted. Changes during loading invalidate it; a stale or malformed source cannot open a reviewed copy. A combined copy records the newer server baseline even when local choices differ, preserving those choices as unpublished edits. After publication the baseline represents the exact submitted body acknowledged at that revision; edits made while the request was in flight remain local.

Baseline metadata stays in local records and backups. It is excluded from household selected-pack uploads with local settings, unused items, photos and original scan files. Existing protected workspace encryption covers it when that workspace is used. Ordinary guest storage and JSON exports remain unencrypted. Backup validation checks method, revision, canonical keys and hash syntax. Older copies without a baseline remain readable: open the current version separately, or successfully publish the old copy at its matching revision to establish one. The app does not invent its missing history.

## Verification and remaining work

All **492 web/server/tool tests in 53 files** pass. New checks cover independent additions/edits, record conflicts with evidence, required deletions, dependent references, relaxed constraints, saved coordinates through all four approaches and backup restore, legacy/malformed baselines, stale reviews and edits during publication. A real HTTP test uses two synthetic accounts and verifies revision 1 → 2 → reviewed publication 3, later conflicts, consent, membership revocation and private-vault/unused-item isolation.

CUA checks the full built app against an actual isolated account service at 1440×1000 and 376×812 CSS viewport sizes. Required deletion and relaxed bag limits need choices; a dangling item reference holds opening; review/dismissal preserve records; independent edits and saved coordinates survive opening; both earlier packs remain unchanged; deliberate publication confirms version 3. Desktop checks additionally verify a later peer version blocks a stale write and that the combined copy survives an offline reload. Phone opening/publication were verified with keyboard activation after an initial locator click left the page unchanged. This establishes browser behavior and responsive layout, not physical touch or native phone acceptance.

Client/server/tool type checks, production build, Android sync and app-specific debug build/lint/instrumentation assembly pass. The unchanged Android unit task retains the previously executed **107 passing tests**. Lint retains zero errors and 27 warnings. An initial unqualified build also tried the Capacitor Cordova library's separate instrumentation package and failed on duplicate Kotlin classes; the app-specific targets pass without changing dependencies. The new APK's signature, all seven web assets, 16 KiB package/ARM64/x86-64 alignment and retained recognition assets are verified. Twenty earlier APK hashes are unchanged.

No personal accounts or records were used, messages sent or live service deployed. The supplied native account origin remains unset. No Android device is connected; device lifecycle/camera/touch and physical packing acceptance remain outstanding. iOS source is uncompiled. Background collaboration, automatic field merging, automatic publication and advanced member permissions remain product work. The full repo goal is incomplete.

See [household authority and server limits](HOUSEHOLDS.md), [device workspaces](DEVICE-WORKSPACES.md) and [dated Android build evidence](QA-ANDROID-BUILD.md).
