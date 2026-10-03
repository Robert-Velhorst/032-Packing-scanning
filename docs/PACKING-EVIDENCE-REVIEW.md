# Review evidence before packing

Open **Review packing evidence** on the packing plan. It groups missing, estimated, lower-confidence or invalid records for the selected pack's items, selected preparation forms and bags. **Needs review** is the default filter; **All selected properties** also shows recorded and currently optional properties. Switching packs resets the filter. On narrow phone layouts, the **Pack** selector above the plan makes the existing packs accessible.

**Review item** and **Review bag** open the existing editors. The review itself does not save anything, change confidence, rescan belongings or alter packed positions. Save an editor only after checking the relevant value and source. Editing uses the same durable storage and packed-position rules as the library and bag screens. A missing or conflicting record remains visible and leads to backup settings; the review does not choose an arbitrary duplicate or remove a required entry.

| Status | Meaning |
| --- | --- |
| Not reviewed | No separate source/confidence record is saved. An unchecked handling flag is not evidence of safe handling. |
| Estimate | The recorded source is estimated, or adopted geometry remains an estimate regardless of its measured envelope. |
| Lower confidence | Recorded confidence is below 80%. This is a review reminder, not a calibrated error bound. |
| Correct record | A value, selected form, geometry, source, confidence or review date needs correction. Future dates are invalid. |
| Source recorded | A valid non-estimated source with at least 80% recorded confidence exists. This does not verify physical fit or safety. |
| Optional · not recorded | The missing weight or exterior size is not needed by the selected plan's current weight/size checks. Other missing properties remain visible. |

The review uses the selected preparation's dimensions and evidence, retains mass-range uncertainty and upper-weight planning, and checks selected bag space, openings, lid/intrusions/compartments and support records when present. It does not include unused library records or unrelated packs. A stacking limit becomes relevant when a proposed load uses it; duplicate item entries cannot hide that load. Adopted shapes and interiors remain estimates with unknown source confidence where none was recorded.

Printable sequences include the flagged properties without collapsed controls. Local backups retain the original records and packed progress; the review is recomputed after restoration and works from cached app assets offline. No additional schema, account, upload or rescan is required.

Carrier booking applicability and source freshness remain in **Carrier rules**. A zero review count is not a certificate: check real objects, insertion clearance, support, cushioning and bag closure. Source/confidence labels in example packs are illustrative records. Actual phone scans, microphone/audio and physical packing trials still require device acceptance; iOS compilation remains outstanding.

Verification evidence and Android package details are recorded in [the dated build report](QA-ANDROID-BUILD.md). Thirteen model tests cover selected scope, prepared forms, missing/conflicting records, optional inputs, mass ranges, duplicate-entry loads, geometry uncertainty, malformed evidence and unit display without mutating saved values.
