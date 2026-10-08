# Recorded weight distribution across bags

Balanced mode favors a lighter eligible bag when the item's upper saved weight, the empty weights of the relevant bags and their already placed item weights are available. It includes empty-bag weight even without a recorded mass limit. Inside one bag, the existing geometry score still chooses the position. Unknown weights disable this additional preference; they are not treated as measured zero.

## Record and compare

Enter item weights in **My items** and empty bag weights in **My bags → Edit bag**. Keep measurement provenance and any upper weight range. The plan's **Recorded bag weights** section lists every selected bag, including bags with no planned items. It uses upper saved item weights plus recorded empty bag weight.

- **Recorded total** means all numeric weights are present with recorded provenance; it is not a scale reading of the packed bag.
- **Estimated total** includes an estimated or unsourced weight or an upper item range.
- **Known subtotal** leaves missing item or empty-bag weights explicitly unresolved. The difference between heaviest and lightest complete totals is withheld until every bag is complete.

Metric and imperial display use the same saved numbers. A recorded limit is checked against the total or known subtotal: a subtotal already above the limit remains a conflict, while an incomplete subtotal below the limit cannot claim that the bag is within it. Allowance applicability and weighing remain separate checks.

## Planning constraints and recovery

Weight distribution is a soft preference among placements that pass the existing constraints. It cannot bypass opening or interior bounds, adopted cavities, unavailable areas, support, stacking limits, upright care, traveller eligibility, bag assignments or hard recorded mass limits. It does not override a known future-shape obstruction. Required-item inclusion and feasibility still dominate final plan selection; the small weight-distribution tie preference cannot outweigh one excluded optional item.

Balanced retains its required-first and heavy-first candidate order, with alternative geometry orders. This is a deterministic bounded heuristic, not proof of the best distribution or that an excluded item cannot fit. Maximum Capacity, Easy Access and Fragile Protection retain their own preferences. The mass-limit risk in Balanced now also includes recorded empty-bag weight.

Packed positions are retained. Changing a weight can change suggestions for unpacked items, but cannot silently move a stored lock or clear its completed flag. Conflicting, stale or malformed saved packed positions may still represent contents physically in the bag; those bags show incomplete subtotals and cannot claim a complete total or within-limit result. Unidentified malformed locks mark every selected bag incomplete. Existing conflict and explicit recovery controls still apply. A stale or malformed lock continues to pause its bag.

The comparison is derived from the current plan and records; no separate potentially stale totals are persisted. Printable sequences include the same complete/incomplete distinction in grams. JSON backups retain the source weights, provenance, entries and packed records, and the comparison recalculates after restore or offline reload.

## Limits and verification

### Saved packed-weight conflicts — 2026-10-01

Changing a bag limit, its empty weight or an already packed item's weight now rechecks the saved physical positions in all four approaches. When their upper saved weights plus known empty-bag weight already exceed the recorded limit, **Bag paused · weight needs review** shows the saved amount and limit. New placements in that bag stop; other eligible bags remain available. The raw saved positions and completion records stay unchanged. Required items outside the proposed plan remain visible. The conflict also counts saved positions that separately fail a geometry check.

Check the real contents and weights, then correct the records or deliberately undo packed positions. Corrected records restore eligible saved positions without rescanning. Missing weights stay unknown: a known subtotal already above the limit is a conflict, while an incomplete subtotal below it cannot establish a pass. Existing support and stacking checks can independently pause a bag. An explicitly recorded zero empty-bag weight is allowed.

Invalid present item weights, reversed ranges, negative empty-bag weights and nonpositive limits are rejected at backup and shared-record validation boundaries. They cannot bypass planning gates. Missing optional weights remain permitted. Conflicts are derived again after restore and offline reload; they are not separately persisted. Candidate details and printed sequences show the same conflict. The print header separates confirmations within the proposed sequence from saved confirmations outside it.

The current checkpoint passes **364 tests in 42 files**, including twelve mass-record/conflict cases. Desktop/mobile interaction checks cover all approaches, corrections, unit changes, print, backup and offline recovery with zero tare. These are synthetic checks, not physical weighing or packing acceptance. See [the current dated verification report](QA-ANDROID-BUILD.md) for Android and rendered evidence. The older distribution checkpoint below is historical.

This compares recorded scalar weights. It does not calculate centre of mass, wheel or strap loads, a backpack's physical stability, pressure, securing, carrying effort or balance while the bag is moving. No guessed mass centre is assigned to a scan or folded form. Weigh and physically inspect the packed bag and verify its applicable limits before relying on the plan.

The 2026-10-01 implementation passes 221 web/server tests across 26 files. Ten focused distribution tests cover unequal empty-bag weights, no recorded mass limits, upper ranges, missing/invalid/zero weights, numeric normalization, bag/traveller assignments, hard limits, too-small openings/interiors, recorded intrusions preserved packed positions, and incomplete totals for paused or malformed packed records. Client and server type checks and the production build pass.

Desktop/mobile Chrome at 1440×1000 and 375×812 checks actual bag editing, redistribution, explicit incomplete totals, imperial display with unchanged stored numbers, packed locks, print, backup and offline reload. Page identity, meaningful content, framework overlays, console health, screenshots and horizontal overflow were checked. The Browser plugin was unavailable; bundled Playwright and installed Chrome were used. Recorded-form and Java-derived cavity browser regressions also pass. The nine-page synthetic sequence PDF was rendered and inspected for clipping.

The Android debug build and lint pass with zero errors and 21 warnings. The unchanged native suite's existing 40 passing results were checked again. All seven packaged web assets match the production build; signature and 16 KB alignment verify. No phone, native bridge, microphone, system print, physical weighing, physical balance or carrier acceptance was exercised.
