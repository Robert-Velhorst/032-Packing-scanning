# Physical reference measurements and packing trials

The repository now has a local preparation, evidence-attachment and reporting tool for the physical trials required by controlled-MVP acceptance criterion 20. It reports original scan differences, scan failures/cancellations, first-plan and final fit, closure of every selected bag, replanning, elapsed time, measured packed mass, access, damage and excessive compression. It retains fixture coverage, independent/blinded tester declarations and missing observations. **The reporting tool does not conduct a physical trial or certify acceptance.**

No physical benchmark results have been collected in this environment. The supplied starter and automated arithmetic/CLI checks use synthetic example records and are labelled accordingly. The actual supported-device scan path, microphone/audio, fit, closure and OS lifecycle still require hardware and observers. See the dated [verification record](QA-ANDROID-BUILD.md).

## Prepare a real run

Use Node 22.18 or newer, as required by the repository. These commands run locally from the repository root; on Windows use `npm.cmd` if PowerShell blocks the npm script shim. No additional dependencies, server or network access are required. Create a private parent folder, then use a new child folder for every output. Existing output folders are refused.

1. Define the physical object set and its exact state before testing. Use a dedicated pack. Keep the same selected bag/item records, quantities, required flags, preparation forms, dimensions, mode and locked positions for the trial. A clean first-plan comparison should start with no earlier packed locks or failure feedback. Identify every omitted item explicitly rather than changing the test set after a failure.
2. On the phone, capture the reference items and bags through the supported native path and save their records. Keep original scan estimates separate from manual measurements and scale calibration. Export an ordinary app backup and keep its original bytes privately. Android uses **Settings → Save backup file**. Original point clouds/models are not in JSON backups; account metadata-only backups and restored copies can lack capture links, and cannot supply original scan differences.
3. Export **Packing mode → Printable sequence → Print or save PDF** for this exact selected pack and plan. Retain the original PDF or a faithful written sequence. The tool hashes its bytes; it cannot establish that an attached document contains the correct plan. The observer must check its correspondence to the source pack. The app's example pack is useful only for software verification, not physical acceptance.
4. Prepare the source snapshot and an empty observation packet:

```powershell
npm.cmd run benchmark -- prepare "C:\private-tests\backup.json" "C:\private-tests\run-001"
```

The active pack in the backup is selected by default. Add its exact ID as the final argument to select another pack. Preparation creates `source-records.json`, `trial.json` and `READ-ME.txt`. It extracts only the selected records and instances, recorded dimensions/upper masses, bag openings and original capture metadata. Photos, account information, traveller names and trip context are excluded; object labels, IDs and measurements can still be private. `backupSha256` identifies the original full backup without copying its photos. The input and live app stores are untouched.

The packet begins with evidence class `unexecuted`, missing measurements, no claimed scan attempts and a `not_attempted` packing trial. Saved app dimensions are **not** automatically called measured references. Original capture estimates are available only when their metadata exists. Manually edited/calibrated dimensions remain a separate source field.

5. Attach the plan to a new copy of the packet:

```powershell
npm.cmd run benchmark -- attach "C:\private-tests\run-001\trial.json" "C:\private-tests\sequence.pdf" "C:\private-tests\run-001-with-plan"
```

The default artifact ID is `plan-1`; add a different ID as the final argument when attaching another plan. Existing packet artifacts are verified before being copied. The plan is stored with a generated plain filename and SHA-256. PDF or UTF-8 text is accepted. Attachment alone leaves every trial unexecuted. Original files remain unchanged. Use the returned ID as `planArtifactId` only for a trial that actually follows that sequence.

The source snapshot is a measurement inventory, not a complete planner-input export. Separation rules remain in the original backup identified by `backupSha256` and appear in the app's printable sequence. Attach that current sequence when a trial involves separation rules; retain the original backup privately. The benchmark tool does not rerun the planner or independently score geometric separation, hygiene or containment. Record actual separation deviations explicitly rather than treating a fit or closure result as separation acceptance.

## Measure and record

Edit the new packet's `trial.json`, preserving its artifact declarations and reference identities. Keep a private checkpoint copy before recording another run. Do not edit the source snapshot to make a result look better: reporting refuses a changed artifact hash. When the physical state/reference changes, archive the previous packet, create a new run and increase its reference revision. Do not relabel old attempts as observations of a changed object.

For each reference record:

- Classify it as `rigid_box`, `cylinder`, `concave`, `handled`, `transparent_reflective`, `clothing_form`, `intruded_interior` or `opening_geometry`. Keep `unclassified` until the fixture is identified. Missing classes remain visible in the report; a box alone does not establish coverage.
- Record the actual preparation state, for example the specific folding procedure or the empty case with its liner installed. `dimensionsMm` is a measured rectangular envelope or measured usable interior, according to `quantity`. Record `measuredAt` in UTC, a private measurer ID, the instrument and method. Record mass in grams from a scale, never from the scanner. Keep absent values `null`.
- Record uncertainty only when it has an evidential basis. A zero or a confidence percentage is not supplied by default. The tool retains the reported uncertainty values without combining them, assigning a coverage probability or treating omitted uncertainty as zero.
- For bags, `quantity: "usable_inside"` measures the usable interior. The original scan envelope is the bound of observed wall surfaces; it is not automatically comparable with usable interior dimensions. Use `outer_envelope` only when the measured quantity really matches that observed-wall envelope. Measured opening length/width and their uncertainty have separate fields. An item cannot have a bag opening.

NIST distinguishes measurement error from uncertainty and treats accuracy as a qualitative concept. This tool therefore reports signed **differences from a recorded measured reference**, rather than claiming a numerical accuracy certification or a sensor-error bound. [NIST TN 1297 terminology](https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-appendix-d1-terminology).

Set `evidenceClass` to `physical_observation` only for actual physical observations. Fill the device model, OS version, exact app build/hash, supported scan path (`arcore_depth` or `guided_object_capture` for current native captures), lighting, background, network conditions and private operator ID. The tool checks that completed capture methods agree with the declared physical scan path; it cannot independently verify device identity or support. Automated fixtures use `synthetic` and never count as physical acceptance.

Add a scan-attempt row for **every** attempt, including failure and cancellation. A row has:

```json
{
  "id": "scan-1",
  "referenceId": "the-exact-reference-id-from-the-packet",
  "referenceRevision": 1,
  "status": "not_attempted",
  "startedAt": null,
  "finishedAt": null,
  "captureId": null,
  "reason": null
}
```

Change the status and fill actual UTC start/end times only after an attempt. A `completed` row needs its original capture ID from `source-records.json`; the capture timestamp must lie inside the recorded attempt. A failed/cancelled row has no successful capture ID and needs a reason. A capture cannot be counted twice. The reference revision must match the measurement used for comparison. If a later scan replaces the capture saved in the app, create and archive a new source packet from its new backup; the aggregate command combines verified packets while retaining each run's own source and reference revisions.

For each packing-trial row:

- Record actual start/end times, tester ID, whether the tester is independent of plan generation, whether they were blinded to how it was generated, and the matching attached plan ID. Unknown independence/blinding remains `null`.
- Keep every source instance accounted for: list physically packed instances in `packedInstanceIds`, and every omitted instance in `excluded` with its reason. A completed trial cannot silently drop an instance. A fit success cannot omit a required instance.
- Record `firstPlanFit` before replanning and `finalFit` after the last actual attempt. Use `pass`, `fail` or `not_tested`. A pass means the observed intended placements can be followed with the tested objects; it is not inferred from a geometric plan. Required items must remain in the tested packed set. Report omitted optional items rather than presenting them as fitted.
- Record closure for **each** selected bag. Do not report closure merely because the placements are inside recorded bounds. Stop if closure requires damaging force or excessive compression; record that outcome and the deviation.
- Record the actual number of replans, failed instance IDs/reasons, deviations, access result, damage and excessive-compression observations. Unknown replan counts remain `null`; unobserved damage/compression remains `not_checked`. Record total measured mass of the selected packed bags, including their own tare, if actually weighed.
- An aborted trial still gets its times, matching plan and available outcomes. Unknown results remain untested and remain in the attempted-trial denominator.

The physical test protocol should include different opening geometries, wheel/handle intrusions, conservative clothing forms, reflective/transparent failures and awkward handled/concave objects. The current packet records measurements/openings and capture metadata, not a full original-model corpus. Independent source-file/surface completeness, support, closure, damage and actual-device acceptance cannot be established from these metadata reports.

## Generate a report

```powershell
npm.cmd run check:benchmarks
npm.cmd run benchmark -- report "C:\private-tests\run-001-with-plan\trial.json" "C:\private-tests\run-001-report"
```

The command creates `report.json` and a readable `report.md` in a new directory. It verifies every artifact against its declared hash and records the dataset hash and source-backup hash. Missing or altered files, duplicated captures, malformed values, inconsistent identities/dates, omitted required items and conflicting observations are refused before creating a report directory. Filenames must refer to ordinary files directly inside the packet; URLs, traversal and symlinks are refused. Each input/attachment is limited to 64 MiB and combined packet artifacts to 128 MiB. No network, server, upload, app-data mutation or native-source cleanup is performed.

Scan completion is completed / all attempted scans, including failed and cancelled attempts. Not-attempted rows remain planned, not attempted. Raw dimension comparisons sort each envelope's three edges independently and subtract measured longest/middle/shortest edges from the original scan estimate. The report retains signed millimetre and relative percentage differences, the measured uncertainty and current recorded dimensions. The median/max absolute differences pool the three comparable edges from each completed scan; they do not measure surface completeness or physical fit. Raw estimates missing from a legacy/metadata-only backup and nonmatching bag quantities remain explicitly unscored.

Fit, all-bag closure and replanning each show positive/negative/untested counts, an observed rate over positive+negative results, and a conservative positive-count / all-attempted-trial lower bound. Untested outcomes cannot inflate that lower bound. Closure passes only when every selected bag is observed to close. A positive replanning outcome means at least one replan was needed, not that replanning succeeded. Initial/final fit stay separate. Both all-attempt scan duration and completed-scan duration are shown; packing duration is derived from actual recorded start/end times.

Recorded upper combined mass uses the packed instance set plus every selected bag's recorded tare. Missing item mass/tare makes that predicted total unknown. It remains a recorded estimate; the separately observed packed mass comes from the tester's scale. These differences do not establish carrier acceptance, mass distribution, transit safety or a mass-limit model.

Reports preserve observed measurements, fixture gaps, missing results and declaration limits. They set `physicalAcceptanceVerified: false` and `rawSourceFilesVerified: false`; no accuracy threshold or global acceptance gate is invented. Review real trials and original source evidence against the full [MVP criteria](../README.md#20-acceptance-criteria-for-the-controlled-mvp) before declaring readiness. This path does not implement a public report publisher, phone-side observation form, benchmark reference-model archive or independent certification.

## Combine runs across devices

Use the raw `trial.json` packets, rather than single-run reports. Supply every packet explicitly and choose a new output folder:

```powershell
npm.cmd run benchmark -- aggregate "C:\private-tests\dataset-report" "C:\private-tests\phone-a\trial.json" "C:\private-tests\phone-b\trial.json"
```

The command validates each dataset/source pair and verifies every declared artifact before creating `aggregate.json` and `aggregate.md`. It refuses repeated run IDs, identical dataset bytes, repeated completed captures and repeated failed/cancelled observations or packing trials matching their recorded identities. It does not silently discard duplicates or choose between conflicting records. Correct the input selection and keep the original packets. Differently labelled records can still describe the same real event; recorded identity checks cannot prove independence.

Physical observations, synthetic checks and unexecuted preparations have separate totals and performance rates. Device groups distinguish the model, OS, exact app build and scan path; condition groups also distinguish lighting, background and network records. Absent metadata remains explicit. Operator-reported device names and supported paths are not independently verified. An example-source run remains labelled as such even if its evidence class is edited.

Rates are recomputed from individual attempts, including failures, cancellations, aborted trials and unknown outcomes. Medians use individual durations and comparable edge differences, never averages of run percentages or medians. The report retains first-plan versus final fit, every-bag closure, replanning, access, damage, excessive compression, measured packed-mass availability and unknown tester independence/blinding. Missing fixture classes and unclassified records remain visible, including failed/cancelled scans for each class. Reference counts count records across runs; repeated measurements of one object are not claimed to be additional unique objects.

Each run keeps its reference identities/revisions, measured quantities and uncertainty, original scan comparisons, packing observations, source snapshot hash, original backup hash and dataset hash. Reference IDs are local to the run: identical IDs in independent packets are not merged or assumed to identify the same physical object. Original native clouds/models are still absent unless separately archived and reviewed; verifying a declared source snapshot is not verification of those original files. No error threshold, device compatibility level, physical fit or acceptance certification is inferred.

The command accepts 1–50 packets, each with the existing file/packet limits, and at most 512 MiB of combined input bytes. Existing output directories are refused. Inputs are unchanged; no upload, network request or live app-store edit occurs. Reports retain object labels, private operator/tester IDs and conditions, so keep them in a private location.

The 2026-10-01 aggregation checkpoint passes fourteen new model/CLI cases and the full **378-test suite in 43 files**. Client, server and benchmark-tool type checks and the production build pass. A saved command example combines two synthetic packets and the existing unexecuted starter, showing zero physical observations. Duplicate selection is refused before output, existing output bytes stay unchanged, and input hashes remain identical. See [the dated verification record](QA-ANDROID-BUILD.md). Real supported-device trials, the full measured/original-model corpus and independent physical acceptance remain outstanding.
