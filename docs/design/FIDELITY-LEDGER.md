# Design reference and implementation fidelity

The three concept images in this folder are visual direction for the first build. Their mock values and illustrated scanning results are not product evidence or acceptance requirements.

| Reference | Product direction retained | Implemented behavior | Deliberate difference |
|---|---|---|---|
| `packing-workspace-concept.png` | Quiet green-and-white workspace, trip context, checklist, bag preview, and visible trade-offs | The workspace keeps the active pack, item checklist, bag model, plan modes, and fit warnings together. | The volume figure is calculated from saved cuboid dimensions and is labeled as approximate box volume. It does not reuse the concept image's sample percentage. |
| `item-capture-concept.png` | Capture an item photo alongside measurements and confidence | Users can take or choose a reference photo, enter dimensions and weight, and record whether each value was measured, known, estimated, or confirmed. | A photo is only a reference. The web app does not infer dimensions or weight from it and does not claim automatic scanning. |
| `packing-steps-concept.png` | A practical sequence with visible progress and clear actions | The step view lists the generated placements and lets the user mark, skip, lock, or flag an item that does not fit. | Steps are generated from the approximate rectangular plan. They do not certify that the bag closes or that soft items compress as expected. |

## Responsive and behavior checks

The navigation, checklist, bag model, and step view adapt to narrow screens. Desktop and narrow-screen browser views were visually reviewed against the live app. A production-served first visit cached the HTML, built JavaScript, CSS, and icon; an offline reload reopened the plan, and a packing-progress change remained saved. The concept images themselves are not browser screenshots.

The desktop Lighthouse snapshot scored Accessibility 100 and Best Practices 100. Its SEO and Agentic Browsing checks flagged only absent `robots.txt` and `llms.txt` recommendations; those public-indexing files are outside this local-only application.

## Fidelity boundary

The web build provides local item records, manual photo capture, a deterministic rectangular packing suggestion, and step-by-step packing. It does not include native depth sensing, computer vision, carrier-rule verification, account sync, or physical fit validation. Those remain separate product work and must be verified before describing the result as a scanner or as guaranteed to fit.
