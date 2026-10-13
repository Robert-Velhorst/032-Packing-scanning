# Packing Scanning

Packing Scanning helps people choose belongings and arrange them inside their travel containers while keeping measurements and uncertainty visible.

## Language

**Shared comparison baseline**:
A locally prepared versioned map of selected-record hashes from an opened or acknowledged shared version. It supports comparison of offline edits without retaining another complete geometry copy. It is not a server attestation or evidence of physical accuracy.

**Combined local copy**:
A separate packing copy built from a reviewed comparison between local records, their saved baseline and a newer household version. Conflicts and constraint changes require choices; differing saved local packed positions cannot be replaced in the review. Earlier copies remain available and publishing needs separate consent.

**Capture diagnostic**:
A versioned count of sampled central depth pixels and separated contributing camera directions. It describes camera-frame observations, not complete object surfaces, physical measurement accuracy or a validated recognition/blur score.


**Item label suggestion**:
A transient output from the optional local Android detector. Explicit acceptance replaces an editor draft's name/category only. The model score does not establish identification accuracy, measurement, handling, carrier permission or physical fit. Predictions and recognition images are not stored as item/scan evidence.

**Saved forecast**:
A deliberately retained weather-source copy with its place, timezone, original retrieval time and supplied daily observations. It is distinct from verified local conditions or a current forecast after its review window expires.

**Forecast coverage**:
The supplied daily observations that overlap the recorded trip dates. Uncovered dates and missing values remain unknown; they are not substituted with historical or climate averages.

**Separation rule**:
A traveller-chosen requirement that every copy of two checklist entries use different bags, different reviewed compartments, or a minimum recorded geometric gap. It is a packing preference, not proof of hygiene, cushioning or transport compliance.

**Geometric gap**:
The shortest distance between the recorded occupied shapes of two item positions in the same bag. An empty geometric gap does not establish a physical barrier or safe containment.

**Withdrawal prerequisite**:
A distinct planned item whose position or support relationship must be addressed before another item can follow its recorded upward retrieval path. It is a geometric dependency, not a safe physical unpacking instruction.

**Modeled retrieval path**:
A fixed-orientation upward route from a proposed item position through the reviewed top access, evaluated against recorded occupied geometry and supporting items. Physical access and stability remain separate observations.

**Candidate packing plan**:
A proposed arrangement generated for one packing approach, with its included and excluded items, saved-weight uncertainty and warnings. Different approaches can produce identical proposed positions; choosing one does not confirm that the real bag will close.
_Avoid_: Physically validated fit, optimal arrangement, guaranteed baggage acceptance

**Selected bag allowance**:
A recorded piece limit for the specific bags assigned to one source record. It is distinct from a verified passenger entitlement or permission to pool allowances.

**Carrier weight subtotal**:
The available upper saved weights of proposed contents and saved physical positions, plus bag weights, counted once per instance and bag. Missing or unresolved records keep it incomplete even when its known part already exceeds a recorded limit.

**Packing evidence review**:
A pack-specific inspection of the sources, confidence and unresolved assumptions behind selected item forms and bag properties. It is distinct from confirmation that a geometric plan fits real objects.

**Unreviewed handling property**:
A saved handling choice without a recorded source and confidence review. An absent fragility or upright restriction does not establish that the physical object is robust or safe to rotate.

**Recorded confidence**:
The recorded degree of belief in a property at its review time. It is distinct from a measured uncertainty interval or a probability that packing will succeed.

**Measured reference**:
A versioned record of an object's physical state, dimensions or mass, the measurement method and instrument, and the person and time of measurement. Its uncertainty remains distinct from the difference between it and a scan estimate.
_Avoid_: Exact truth, certified dimensions

**Scan attempt**:
One deliberate capture attempt against a particular reference state, including a completed, failed or cancelled result. A completed result retains its original scan estimate separately from later calibration or manual editing.

**Physical packing trial**:
A recorded attempt by a tester to follow a particular packing sequence with real containers and objects. Fit, closure, access, damage, deviations and replanning are observations rather than consequences inferred from a geometric plan.
_Avoid_: Solver test, synthetic trial

**Benchmark run**:
A recorded set of references, scan attempts and packing trials under a declared device, build and testing conditions. Reference identities and revisions belong to that run; repeated records do not establish additional physical observations.

**Benchmark dataset**:
A collection of benchmark runs whose observations retain their source identities and evidence classes. Its physical observations remain distinct from synthetic checks and unexecuted preparations.

**Household**:
A private group of packing accounts whose members can access packs deliberately shared with that group. A traveller on a packing list is a person being packed for and need not have an account.

**Shared pack**:
A packing list, its selected items and bags, and their recorded geometry and progress made available to a household. Unused personal items, photos and original captures stay separate.

**Shared working copy**:
A local copy of one shared pack version that can be edited and used offline. Publishing is deliberate; opening a newer version creates a separate copy and preserves earlier local work.

**Household invitation**:
A private one-use code addressed to a particular packing account. The invited person must sign in and accept before gaining household access.

**Packing account**:
An optional identity for accessing private packing backups on an enabled installation. Signing in does not change the packing records on the device.

**Private account backup**:
A traveller-approved copy of local packing records, including adopted shapes and progress. Original captures and reference photos stay separate. Restoring is an explicit replacement of local records, not automatic sharing or merging.

**Recovery code**:
A private one-use code that can replace an account password. Recovery replaces the code and ends previous sign-ins.

**Captured surface**:
The points or reconstructed surfaces actually observed during a scan. Hidden regions and neighbouring objects may make it incomplete or inaccurate.
_Avoid_: Complete object, verified shape

**Scan envelope**:
A rectangular outer bound that contains all observed points, with any stated sampling margin. It is an estimate of an object's occupied space, not proof of its physical dimensions.
_Avoid_: Exact dimensions, watertight model

**Usable interior**:
The clear space inside a container after accounting for walls, rounded corners, intrusions and obstacles. The outer bounds of scanned interior surfaces do not establish this space.
_Avoid_: Scan envelope, external dimensions

**Opening**:
The narrowest usable entry through which an item must pass. It is distinct from the container's inside dimensions.

**Reviewed opening plane**:
The traveller-selected end of a captured interior through which the bag is entered. It is a reviewed boundary assumption, not an observed wall or proof of the narrowest physical opening.

**Interior seed**:
A traveller-selected point in the empty part of a captured container. It identifies one connected cavity to review, without establishing that all compartments or hidden surfaces were captured.

**Adopted interior**:
A connected estimate of empty bag space explicitly chosen for packing at a recorded scale. It remains separate from the source capture; walls and other compartments are unavailable.

**Packing frame**:
The interior view with its reviewed opening upward and its corner at the smallest free side edges and lowest free floor. It may differ from the orientation of the bag during travel.

**Travel-up end**:
The reviewed end of the bag that faces upward during travel. Upright belongings must point toward that end, even when it appears sideways in the packing view.

**Unavailable space**:
A recorded region inside a container that must remain free of packed items, such as a frame intrusion or an unusable compartment. Its top is not automatically a load-bearing support.

**Lid clearance**:
Space deliberately kept empty below a container's lid. Recording it does not prove that the lid will close or that fragile items have enough protection.

**Source capture**:
The original scan retained for review and later processing. A simplified packing representation does not replace it.

**Reconstructed surface**:
An estimated boundary computed from a source capture. A mathematically closed boundary does not establish physical completeness or safe fit.
_Avoid_: Verified object, exact mesh

**Occupied cell**:
A bounded volume element treated as part of the reconstructed object. Exterior-connected recesses may remain empty; hidden enclosed cavities can be filled by reconstruction.
_Avoid_: Measured material, usable interior

**Adopted shape**:
A reconstructed estimate explicitly chosen for packing at a recorded scale. It remains separate from the original capture and does not establish physical completeness.

**Insertion order**:
The sequence in which planned items can enter their positions. Height and layer labels alone do not establish access beneath or inside another item.

**Reachable placement**:
A planned position an item can enter along the considered insertion path without crossing items already in place. It does not establish physical fit, bag closure or later retrieval access.

**Upright direction**:
The end of an item that must face upward in travel. It is a handling requirement tied to the reviewed item, distinct from a scan's starting axes or its longest dimension. Traveller confirmation does not establish stability or physical fit.

**Scale calibration**:
A correction based on a physically measured reference. It establishes the scale of an estimate without confirming unobserved surfaces or usable interior space.

**Stacking limit**:
The recorded maximum additional static weight resting on an item in its planned orientation. It is separate from the item's own weight, pressure resistance and impact protection.

**Upper stack load**:
The combined upper saved weights of distinct items carried through a supporting item. Without a verified load-sharing model, each support path accounts for the full supported weight.

**Travel base**:
The closed end underneath the bag in its reviewed travel orientation. A reconstruction cap at an open end does not establish a supporting lid.

**Support review**:
Traveller confirmation of the packing floor, closed travel base, support strength and applicability of recorded stacking limits in both positions. It is bound to the source, scale and travel end; it does not certify physical strength, balance or handling between positions.

**Packing form**:
A reproducible folded, rolled or compressed state of an item, with its own checked envelope, preparation and stacking-limit evidence. Selecting it for a pack does not change the original item scan or establish how much compression a material can tolerate.

**Packed envelope**:
The full rectangular space occupied by an item after its recorded preparation. It includes any retained air or protrusions; reduced box volume is not a claim of reduced material volume or weight.

**Recorded bag total**:
The upper saved weights of planned items plus the recorded empty bag weight. It is a planning value, not a weighed packed bag or a balance assessment.

**Known bag subtotal**:
The recorded weights available for a bag when an item or empty-bag weight is missing. Missing weight is unknown rather than zero.

**Saved packed-weight conflict**:
A recorded bag limit exceeded by the known upper weights of saved packed positions and the empty bag. The saved positions may still describe physical contents even when omitted from a new proposed sequence. Their recorded completion is distinct from a current fit or weight check.

**Native account connection**:
An app-controlled connection to one operator-configured HTTPS account server. Session credentials remain outside JavaScript. Native signing-in alone does not create a protected local workspace. Android can explicitly create or unlock one; iOS captures remain guest data. See docs/NATIVE-ACCOUNTS.md for implementation and remaining device/iOS acceptance.

**Forget device sign-in**:
Remove the native saved session locally when remote sign-out cannot be confirmed. This does not revoke a server session or remove guest packing records.

**Capture workspace lease**:
A revocable, in-memory selection used by the Android encrypted capture core to bind work to one device workspace. Old leases cannot access a later selection. Android's unlock screen, capture bridge and activity callbacks use this lease. New captures in an unlocked protected workspace are encrypted; guest captures stay separate. Physical lifecycle execution remains unverified. See docs/NATIVE-CAPTURE-STORAGE.md.


**Pending native backup selection**:
An Android document chosen for one workspace and staged encrypted in private cache, without restoring it. Its random ticket exposes no JSON while locked. It can be reviewed only after reopening the workspace and account that selected it; confirmation replaces that workspace's records/photos and removes its previous original scans. Selections expire after ten minutes or process restart. See docs/NATIVE-BACKUP-FILES.md.

**Ordinary packing backup file**:
An intentionally exported, unencrypted JSON copy of packing records and reference photos. It retains adopted shapes and cavities but excludes original scan files. Choosing a cloud destination in the native system picker can copy this file there. It is separate from an optional account metadata backup and is not automatic synchronization.

**Pending item photo draft**:
An incomplete item editor and optional reference image held in purpose-bound encrypted native cache for at most ten minutes. Resume requires unlocking the original workspace; the item enters the library only through explicit save. Cancellation, permission denial and selection failure can preserve the draft, but restart/reload recovery is not guaranteed. See [Android reference photos](docs/NATIVE-ITEM-PHOTOS.md).

**Recorded compartment**:
A separately reviewed rectangular packing area within a bag, with its own narrowest top opening, supporting bases, optional contents-weight limit and eligible item categories. Space outside recorded compartments remains unused.
_Avoid_: Keep-free area, whole bag, automatically detected pocket

**Compartment assignment**:
A pack-entry requirement to use one named compartment of one bag. It applies to every copy in that entry and remains separate from the reusable item record.


**Raw scan retention**:
A traveller-chosen lifetime for original scan sources, separate from reference photos, saved measurements and adopted packing geometry. Removed originals cannot be recovered from ordinary packing backups.
_Avoid_: Photo deletion, deleting the item, deleting the packing plan
