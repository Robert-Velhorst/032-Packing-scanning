# Selected bag allowances and saved packed contents

In **Carrier rules**, edit or review a source and enter **Maximum number of selected bags** when the source states a piece allowance. Select every bag in that allowance, including empty bags. A zero allowance is supported; a blank field means the count has not been recorded. Whole numbers from 0 to 100 are accepted.

The count applies to this record's selected set. For a per-passenger allowance, select that passenger's bags and use separate records for other passengers or allowance categories. It does not infer that a traveller has a seat, booked a large bag, shares an entitlement or has permission to pool allowances. It does not combine route/fare text or piece limits across records. Numeric count results do not establish booking applicability or carrier acceptance.

The current easyJet adapter extracts one bag for each supported small/large allowance from the official page's explicit piece statement, alongside existing dimensions, weight and conditions. Changed, absent or conflicting piece statements fail parsing. The small and large allowances remain separate, with their existing booking/membership and locker-space conditions. See [easyJet's official cabin-bag source](https://www.easyjet.com/en/help/baggage/cabin-bags), retrieved and parsed directly on 2026-10-01. This is a public-page check, not access to a booking. Older saved catalog copies without a numeric piece field remain usable with count unrecorded; a newer retrieved piece limit raises the existing updated-source review notice rather than rewriting saved records.

An excess selection is shown after saving, so the source and conflicting bags stay visible. Editing the count clears the previous booking-review acknowledgement. Counts retain their exact integer value when changing measurement units. A retrieved count edit is a manual override; the original retrieved catalog and timestamp remain unchanged. Backups and household copies retain the field and reject malformed counts or duplicated selected bag IDs.

## Weight when packed positions are paused

Carrier weight checks use the proposed contents together with saved physical positions. A saved position takes precedence over a new proposed position of the same item instance; an accepted packed position is counted once. Every selected bag's own weight is counted once, including an explicitly recorded zero tare. Upper item ranges stay upper ranges; folding or compression does not reduce mass.

A saved position rejected from a new geometric plan may still represent physical contents. Its available upper saved mass remains in the carrier subtotal. **Saved subtotal above limit** shows a known subtotal already over the recorded carrier limit, even if other records remain missing. An incomplete subtotal below the limit shows **Cannot check**, with no positive margin. Geometry-stale positions, ambiguous/malformed identities, duplicate item records, missing bags/weights and invalid or overflowing totals cannot produce a complete pass. Both per-bag and combined limits follow these rules.

Correct the relevant records or deliberately undo packed positions after checking the real contents. Corrected eligible positions recover without moving their saved coordinates or clearing their completion. A complete total remains a sum of saved records, not a scale reading. Estimated/low-confidence sources remain labelled as estimates. Weigh the packed bags and verify the exact booking before travel.

## Verification and remaining scope

Sixteen focused cases and the full 394-test suite cover counts, missing/duplicate bag identities, paused physical mass, no double counting, upper ranges, missing/invalid/overflowing weights, zero tare, correction, shared/backup validation and retrieved count provenance. Client, server and benchmark-tool type checks and build pass. Rendered desktop/mobile, Android package and live-source details are recorded in [the dated verification report](QA-ANDROID-BUILD.md).

Automatic passenger entitlement resolution, pooling across sources, wider carriers and booking access remain unfinished. These checks do not establish actual packed mass, scan accuracy, fit, closure, carrier acceptance or supported-phone behavior.
