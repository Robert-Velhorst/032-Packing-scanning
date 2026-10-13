# Recorded folded, rolled and compressed forms

A packing form is a reusable preparation of one library item, with independently recorded dimensions, preparation instructions, size provenance and a form-specific stacking limit. It is selected per pack entry. The original dimensions, source scan, adopted occupied cells, mass evidence, fragility and upright requirement remain separate.

## Record and choose a form

In **My items → Edit item → Reusable packing forms**, choose the actual flexibility first. Rigid items cannot use prepared forms. Add a folded, rolled or compressed form, describe its reproducible preparation and enter its full measured, known or traveller-confirmed rectangular envelope. Include air, protrusions and anything holding the form; estimated compression ratios are not accepted. If the item must remain upright, measure the form's height towards its real top.

The form starts with zero permitted weight above. Record an independent limit and source if known, or clear the field to retain unknown support strength. The original-form limit is not copied. Fragile always means no stacking, regardless of a form's positive limit. Confirm that the prepared state can be reproduced within its dimensions without damage and review its applicable limit. Save applies the draft; Cancel retains the saved record. Editing dimensions, preparation, method or strength clears the draft confirmation. Untouched unit changes and resaves retain precise numbers and review dates.

In the pack checklist, choose **Original item** or one of its recorded forms. Quantity controls add a copy or remove only the last untouched copy. **Separate one unpacked copy** keeps earlier instance IDs and their packed positions, then lets the separate entry choose a different form. A copy with a packed, locked, unavailable or rejected-placement record cannot be removed or split this way. Restore, undo packed or unlock through the explicit existing controls after physical checking.

## What the planner uses

The chosen form uses a fully occupied rectangular envelope. It does not inherit empty recesses, occupied cells or a source top-axis transform from the original scan. The item’s upright requirement still applies: the prepared form’s recorded height points up in the reviewed travel direction. Constraints for collisions, bag and opening bounds, unavailable regions, lid clearance, traveller/bag eligibility, mass, occupied support and packing/travel static loads remain active in every mode.

A form does not reduce saved mass or infer added material weight. Record compression-bag, straps or wrapping weight in the item’s weight or upper range; where forms use different accessories, retain a conservative upper weight covering the selected preparations. Nothing measures strength or safe compression from a scan. This is a traveller-reviewed envelope model, not continuous deformation, material-pressure analysis, cushioning certification or an automatic choice of the best fold.

The checklist shows the selected dimensions and their provenance. Steps, spoken-step text and print include the selected form and preparation. Geometry views show its rectangular envelope while the item editor retains the original source separately. Audio and physical preparation have not been exercised.

## Packed records, failed attempts and offline data

Packed and rejected positions retain both selected form ID and exact bounded preparation/envelope identity. Changing dimensions, preparation, review, applicable load limit or selected form cannot silently reuse a stale lock, even when the new box has the same dimensions. Its bag pauses until the traveller explicitly permits movement; raw coordinates and completed flags remain stored. Returning to the same unchanged form can resume a still-valid lock.

JSON backups retain forms, independent provenance, entry selections and packed identities. Malformed form or placement identity records are rejected before any replacement of app data. A missing selected form remains a visible required-item exclusion; it never falls back silently to the original dimensions. Native capture links are excluded on restore, but adopted source cells and forms remain available offline. Corrupt local forms fail closed and can be cleared only from an explicit editor draft; cancellation preserves the corrupt saved data for recovery.

Up to eight forms can be recorded per item. Each entry uses one form for all copies in that entry; separate untouched copies to use different preparations. Other packs continue using their own selections, while editing a shared library form correctly revalidates every pack that references it.

## Verification boundary

Analytic tests cover explicit selection in every mode, different forms of the same library item, unchanged upper weight and original geometry, form-specific fragile/load rules, opening/bag/assignment constraints, invalid records, exact unit/JSON preservation, stale lock and rejected-pose identities, and quantity/split recovery. Browser checks use synthetic dimensions and a derivative generated by the actual Java reconstruction code; they do not validate a real folded item or safe compression. Device accuracy, material rebound, continuous deformation and physical packing acceptance remain outstanding.

The 2026-10-01 implementation has 211 passing web/server tests across 25 files. Its rendered workflow and upright, occupied-shape, insertion and cavity regressions pass desktop/mobile Chrome at 1440x1000 and 375x812. Browser plugin availability was absent, so bundled Playwright and installed Chrome were used. A supplemental desktop/mobile backup check also confirms that a synthetic imported provider stacking-limit source displays accurately and survives an untouched resave with its original review dates; this is source-field handling, not provider acceptance. The locally generated three-page PDF was inspected. The Android build and lint pass with zero errors and 21 warnings; the unchanged native suite’s existing 40 passing results were rechecked. Debug APK assets match the final build, and signature/16 KB alignment verify. No phone, native bridge, microphone, physical material behavior or carrier/provider acceptance was exercised.
