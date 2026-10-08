# Carrier limits: local verification

Date: 2026-09-30. Scope: manual numeric carrier-source records, outside bag measurements, empty bag weights, and their comparison with the current rectangular packing plan. This is focused local verification, not controlled MVP or airline acceptance.

## Browser evidence

Used Chrome DevTools against the local Vite app in an isolated browser context. All source records were fictional (`QA Airline`, `https://example.test/rules`); the source link was not opened. The main browser profile and its packing records were not changed.

| Journey | Observed result |
| --- | --- |
| Save a source with one of three side dimensions supplied | Visible validation error; record not added. |
| Compare a bag without outside measurements or tare | Size and weight show Cannot check. |
| Enter outside sizes smaller than the usable interior | Save rejected with a units/measurement error. |
| Save measured outside dimensions and empty bag weight | Size shows Within entered limit. Estimated item masses keep total weight explicitly estimated. |
| Edit a source reviewed today | Original review time preserved; no incorrect future-date stale badge. |
| Change to imperial units; save source and bag without changing fields | Read-only IndexedDB inspection confirmed exact dimensions, weights, review time, and outside/tare evidence timestamps were preserved. Example source values: 550.037 mm and 12000.035 g. |
| Increase bag length to 560 mm against a 550.037 mm source limit | Over entered limit. |
| Change combined allowance to 3000 g in the phone form | Estimate above limit; 3860 g estimated total and 860 g over. |
| Save changed allowance, then immediately reload | After removing the delayed save, IndexedDB retained the new 3000 g allowance. Before the fix, a rapid reload could discard the edit. |

Carrier pages were visually inspected at 375, 768, and 1440 pixels. Each had a rendered page, readable controls, and no horizontal document overflow. The 375-pixel source editor saved successfully. Screenshots were viewed through the browser tool; file export was denied by that tool's workspace restrictions, so there are no saved screenshot artifacts. There is no committed visual baseline: visual regression is inconclusive.

The final development-page smoke check reported no console errors or warnings. Its 33 listed requests returned 200 or 304. Core Web Vitals, a complete keyboard/screen-reader pass, and an accessibility audit were not run.

## Automated checks

The final focused suite passed 34 tests in 5 files. It covers rectangular planner constraints, scan contracts and calibration, trip suggestions, carrier comparisons and review dates, and measurement round trips. The production type-check and build passed. Vite reported the existing bundle-size warning (one JavaScript chunk larger than 500 kB); this is not a performance acceptance result.

## Remaining product work

These comparisons evaluate user-entered limits. They do not retrieve or verify a booking, enforce carrier limits during optimization, evaluate piece allowances, or establish carrier acceptance. Physical dimensions and packed weight still require checking. Native scanner compilation, supported-device testing, Android depth capture, sharing/accounts, irregular geometry, and physical packing benchmarks remain outstanding.

Verdict: focused local journeys verified; full MVP release not ready. Visual regression and accessibility acceptance remain unverified.

Subsequent native verification on 2026-09-30: the Android debug app and instrumentation APK now compile, eight geometry/storage tests pass in Gradle, and Android lint passes with zero errors and 21 warnings. See the [Android build report](QA-ANDROID-BUILD.md). This follow-up does not change the carrier journey evidence above or establish physical scanner acceptance.
