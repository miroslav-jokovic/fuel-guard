# Inventory UX research — how the best products do this, and what it changes in the plan (2026-09-08)

Companion to `INVENTORY-PLAN.md`. Four sweeps run in parallel on 2026-09-08, ~400 page fetches across
vendor help centres, release notes, WebKit bug trackers, caniuse, review sites and design systems.
Every claim below is cited to the page it came from; where a vendor documents nothing on a point, that
absence is stated, because it is usually the finding. Read §1 first — four facts change the plan
outright. §7 lists the decisions they lead to, numbered to continue the plan's D-INV series.

The bar the plan set (§2.5) is "receive, issue and count without reading documentation". This document
is what that bar looks like in the products people already use, and where none of them reach it.

---

## 1. Four facts that change the plan

**1. Every iPhone in the shop decodes in WebAssembly.** Safari has not shipped `BarcodeDetector`: caniuse
lists it "disabled by default in 26.6", WebKit bug 281848 ("Shape Detection API doesn't work on iOS") is
open and uncommented as of July 2026, and the 26.6 release post does not mention it
([caniuse](https://caniuse.com/mdn-api_barcodedetector),
[bug 281848](https://bugs.webkit.org/show_bug.cgi?id=281848),
[WebKit 26.6](https://webkit.org/blog/18178/webkit-features-for-safari-26-6/)). D-INV2's "native where
present, WASM fallback" is therefore "WASM everywhere, native as a free accelerator on Android Chrome".
The WASM must be self-hosted — the default fetches from jsDelivr on first use, which the CSP blocks and a
shop with no signal cannot reach ([zxing-wasm README](https://github.com/Sec-ant/zxing-wasm/blob/main/README.md)).

**2. An installed web app re-asks for the camera when the route changes.** WebKit 215884: standalone
(home-screen) web apps revoke camera permission on navigation; "persists on iOS 18.5+" reports continued
into 2026, and the same app in Safari does not do it ([bug 215884](https://bugs.webkit.org/show_bug.cgi?id=215884),
[STRICH KB](https://kb.strich.io/article/29-camera-access-issues-in-ios-pwa)). For a SPA this means the
scanner cannot be "scan, then navigate to the part page": the camera route must host the whole
scan → resolve → act loop without changing path. That is also the better product (§4).

**3. No fleet product has good scanner ergonomics, so this is where a web app can lead.** Across Fleetio,
Fullbay, MaintainX, Limble, UpKeep, Whip Around, Samsara and Motive, none documents continuous scan with a
tally, decode feedback, a torch toggle beyond Fleetio Android's "flash options", or a manual-entry
fallback. Those appear only in the count-app and SDK tier (Cetaris Count, Scandit) — see §2.9. The
plan's scanner does not have to match Fleetio; it has to match Scandit's published research, which is
public (§4).

**4. The asset-tracking leaders already solved truck inventory's shape.** Reftab's kit template is
"category + quantity" rules with a scan-to-fill checklist showing "what's included and what's still
needed" ([Reftab](https://www.reftab.com/faq/what-is-a-kit-template-and-how-can-i-create-them)) — that is
`kit_expectations` and `deriveKitStatus` exactly. Cheqroom makes kit incompleteness a first-class state
("Partially available", flagged "incomplete" at check-in) ([Cheqroom kits](https://knowledge.cheqroom.com/helpcenter/kits-overview)).
Shelf separates "Not scanned" from "Missing" until an audit closes — it shipped a fix for calling things
missing too early on 2026-08-18 ([Shelf audits](https://www.shelf.nu/knowledge-base/run-your-first-audit)).
And ShareMyToolbox assigns tools to "people, locations, crews, vehicles, and kits" — the only product
found where a truck is a holder, which is D-INV3 ([ShareMyToolbox](https://www.sharemytoolbox.com/)).

---

## 2. Parts inventory — what the leaders do the same, and the plan step it lands on

Products read: Fleetio (web + Go), Fullbay, MaintainX, Limble, UpKeep, Whip Around, Samsara Connected
Maintenance, Motive Maintenance (Aug 2026), FleetPal, AMCS/Dossier, Cetaris Count, ShopView.

| # | Pattern | Who | Plan step |
|---|---|---|---|
| 2.1 | **A scan resolves to a part AT a location, never a bare part.** Fleetio's printed QR "opens to the specific part location encoded in the QR code"; MaintainX makes you "select the location where the part was sourced from"; UpKeep stores one inventory line per location. ([Fleetio release notes](https://help.fleetio.com/en_US/fleetio-go-release-notes), [MaintainX](https://help.getmaintainx.com/complete-a-work-order), [UpKeep](https://help.onupkeep.com/en/articles/7670948-how-to-add-parts-with-multiple-inventory-lines)) | Fleetio, MaintainX, UpKeep, Limble | I1: the bin label's kind (`BIN`) resolves to a `part_stock` row. |
| 2.2 | **Two code classes.** The vendor UPC on the box and the app's own printed QR are handled as different things; the UPC is a lookup key on the part. ([Fleetio](https://help.fleetio.com/en_US/asset-management/link-your-own-barcodesqr-codes-to-fleetio-assets), [AMCS](https://www.amcsgroup.com/solutions/fleet-maintenance/fleet-parts-inventory-management/)) | Fleetio, Whip Around, AMCS, Limble, UpKeep | I6: resolve tries `parseTag` first, then `parts.upc` (D-INV7). |
| 2.3 | **Unknown code is an on-ramp, not an error.** "Add UPC to Existing Part" or "Create a New Part with UPC" (Fleetio); "Attach code to existing" (MaintainX); "Invalid Code → Create Item(s)" (EZO). | Fleetio, MaintainX, EZO, Sortly | I6: the miss branch of the verb sheet keeps the scanned code in the create form. |
| 2.4 | **Quantity is stepper + typed total; counts are absolute totals, never deltas.** Fleetio Go "+"/"−"; MaintainX "+/− or type the total"; Fleetio bulk "Current Qty … represents the total". ([Fleetio Go](https://help.fleetio.com/en_US/manage-parts-and-inventory-in-fleetio-go), [MaintainX](https://help.getmaintainx.com/conduct-a-cycle-count)) | all | I5: the count screen takes a total; the system computes the delta. Already the plan's D-INV4; the entry control is now specified (§5.5). |
| 2.5 | **A manual decrease requires a reason.** "Select a reason for the adjustment" (Fleetio Go); "Require a reason for manually lowering part quantities" (Limble setting); a note is mandatory on negative restock (MaintainX). Square's reason list: received, recount, damage, theft, loss, restock return. | Fleetio, Limble, MaintainX, Square | I5 Adjust: already "mandatory reason". Adopt a closed reason list in `inventoryContract.ts` rather than free text. |
| 2.6 | **Blind counts are the mark of the best two.** Limble: "A blind cycle count hides current inventory quantities to reduce bias … By default, this setting is turned on"; MaintainX: "Hide on-hand quantity". Fleetio, UpKeep and AMCS all show the expected figure while counting. ([Limble](https://help.limblecmms.com/en/articles/5695413-using-cycle-counts-to-audit-parts-inventory), [MaintainX](https://help.getmaintainx.com/about-cycle-counts)) | Limble, MaintainX | I5: blind by default, supervisor toggle, the mode recorded on the row (D-INV20). |
| 2.7 | **A count saves per part and completion is irreversible.** UpKeep: "Tap Update" per part, counted parts move to their own section; MaintainX: "you can't re-open it". Limble warns that inventory received during a count "might get overwritten" — the failure a ledger avoids, because the count movement's delta is taken at count time. ([UpKeep](https://help.onupkeep.com/en/articles/11725142-how-to-perform-cycle-counts-on-the-mobile-app), [Limble](https://help.limblecmms.com/en/articles/5695413-using-cycle-counts-to-audit-parts-inventory)) | UpKeep, MaintainX, Square, xtraCHEF | I5: per-bin commit as a `counted` movement at entry, inside a **count session** for progress and the report (D-INV19). |
| 2.8 | **Variance is reported in units, cost and percent, per counter; a threshold triggers a recount instead of a commit.** MaintainX's report: Available / Counted / Variance / Cost variance / % variance / Submitted By. Cetaris: "If a variance occurs, a recount sheet is generated. Variances can be configured based on percentage, quantity, or part value." Cycle-count practice: 2–5 % → mandatory recount, larger → a second counter. ([MaintainX](https://help.getmaintainx.com/view-cycle-count-data), [Cetaris](https://cetaris.com/inventory-count-app), [Stockount](https://www.stockount.com/articles/how-to-do-a-cycle-count)) | MaintainX, Cetaris | I5: a delta above max(5, 5 %) or a zero against non-zero gets a consequence-labelled confirm; above 10 % the row is flagged "recount by someone else". |
| 2.9 | **Scanner ergonomics are absent from every fleet product.** No batch scan with tally, no decode feedback, no manual entry documented by Fleetio, Fullbay, MaintainX, Limble, UpKeep, Whip Around, Samsara, Motive. Cetaris and Scandit have them. | — | I6: §4 is the spec. This is the leapfrog. |
| 2.10 | **Low stock is per location, colour-coded, with one push channel — and per-user subscription with a daily digest avoids fatigue.** Fleetio: real-time reorder email plus a morning summary, both per user; UpKeep: a sidebar badge count; Limble: a threshold task assigned to a team. Nobody documents mobile push. ([Fleetio alerts](https://fleetio.helpjuice.com/email-notifications-inventory-alerts), [UpKeep](http://help.onupkeep.com/en/articles/5205252-where-to-see-low-stock-parts-alert-and-how-to-filter-to-see-low-stock-parts)) | Fleetio, UpKeep, Limble | I4/I12: a badge count on the shop home first; email as per-user subscription with a digest, not a global blast. |
| 2.11 | **Shop home screens do not show inventory — except Fullbay's.** Fleetio Go's widget list has no stock card; Limble, UpKeep and MaintainX open on work. Fullbay's inventory home shows stock, average cost and preferred vendor. ([Fleetio Go home](https://help.fleetio.com/fleetio-go/navigate-the-fleetio-go-home-screen), [Fullbay](https://www.fullbay.com/blog/fullbay-and-parts-management/)) | Fullbay | I4: `/shop` becomes the shop home: low stock, kit shortfalls, today's movements, Scan. |
| 2.12 | **Offline is work-order-first; inventory is online-only in every fleet product.** Fleetio: "only available for Inspection Submissions"; UpKeep: parts on a WO are "Viewable only"; Limble: "only access work order information". ([Fleetio offline](https://help.fleetio.com/en_US/fleetio-go-for-account-owners-admins/use-fleetio-go-offline), [UpKeep](https://help.onupkeep.com/en/articles/4712557-how-to-use-upkeep-offline)) | all | The industry norm. §4.5 gives the cheap version that beats it: queue the write, replay on reconnect, idempotency key (D-INV27). |
| 2.13 | **Multi-location is a paid tier and the top complaint when missing.** MaintainX Enterprise-only ("I would also prefer an option for multiple part locations"), UpKeep Enterprise for counts, Fleetio Premium+ for receive-to-WO. ([Capterra MaintainX](https://www.capterra.com/p/179296/GetMaintainx/reviews/)) | — | D-INV1 (locations from day one) is vindicated. |
| 2.14 | **Receive is PO-line + received quantity, partial allowed, no photo, and on web.** Only MaintainX's manual Restock runs on mobile (quantity → location → optional unit cost → notes → images). Fleetio can receive straight into a work order. ([MaintainX](https://help.getmaintainx.com/order-and-restock-parts), [Fleetio](https://help.fleetio.com/parts-inventory/receive-purchase-order-parts-to-work-orders)) | MaintainX | I5 Receive: MaintainX's Restock is the shape — quantity, location, unit cost, supplier, optional photo. D-INV14 (no POs) costs nothing here. |

**Reviews, in the users' words.** Fleetio: "a way to scan directly into the system and not have to attach
invoices"; Go "doesn't provide full access to the same features available on desktop". Limble: "barcode
integration for parts checkout … cumbersome". UpKeep: the parts section on mobile "brings them to assets
instead, and when the phone screen flips, it sends them back … losing their place". Fullbay: "The
inventory set up … its a lot of work". ([Capterra Fleetio](https://www.capterra.com/p/120855/Fleetio/reviews/),
[Capterra Limble](https://www.capterra.com/p/162600/Limble-CMMS/reviews/),
[Capterra UpKeep](https://capterra.com/p/145635/UpKeep/reviews/),
[Capterra Fullbay](https://capterra.com/p/170876/Fullbay/reviews/)). Every complaint is the phone being a
lesser client. The plan's split — desk screens on desk, the scan and the count on the phone, both first
class — is the answer to that, and it is why the phone screens need their own layout (§5.1).

---

## 3. Assets and kits — what the leaders do the same

Products read: Snipe-IT, Cheqroom, Asset Panda, EZOfficeInventory, Sortly, AssetTiger, GoCodes, Reftab,
Shelf.nu, itemit, Timly, ShareMyToolbox.

| # | Pattern | Who | Plan step |
|---|---|---|---|
| 3.1 | **Scan → action sheet is the primary verb.** Nobody makes you find the asset and then scan. Shelf's batch scanner: action dropdown, "Items scanned (8)", per-row trash, one bottom button. ([Shelf](https://www.shelf.nu/knowledge-base/batch-scanning-actions)) | Shelf, GoCodes, Reftab, EZO | I10 |
| 3.2 | **Kit = type + quantity rules, filled by scanning, shortfall shown live.** Reftab's template lists "what's included and what's still needed" and a "Potential Kits Count"; Cheqroom's kit statuses include *Partially available* and *Empty*, and at check-in an incomplete kit is flagged for the next person. ([Reftab](https://www.reftab.com/faq/what-is-a-kit-template-and-how-can-i-create-them), [Cheqroom](https://knowledge.cheqroom.com/helpcenter/kits-overview)) | Reftab, Cheqroom, EZO Bundles | I7/I9: `deriveKitStatus` returns complete / short-by-N / extra — matches. The unit page shows the shortfall as a state, not a number buried in a table. |
| 3.3 | **Audit = expected list + scan session + three buckets + live counter; "Missing" only at close.** Shelf: "Audit: Studio B • 3/19 found", buckets Found / Not scanned / Unexpected, Missing after completion, comment and photo on unscanned rows. Reftab: scanned / missing / unexpected with a reconciliation phase. EZO: Verified / Wrong Location / Out of Scope. Cheqroom spotchecks by kit, location, custody. ([Shelf](https://www.shelf.nu/knowledge-base/run-your-first-audit), [Reftab](https://www.reftab.com/faq/how-to-audit-fixed-assets-in-reftab), [EZO](https://ezo.io/ezofficeinventory/blog/location-audit/), [Cheqroom](https://knowledge.cheqroom.com/helpcenter/how-to-use-and-manage-spotchecks)) | Shelf, Reftab, EZO, Cheqroom | I9: a **unit check** is the same session shape as I5's count: walk the truck, scan each item, three buckets, close. One session component serves both (D-INV19). |
| 3.4 | **Three identifiers per asset, one chosen for display.** Shelf: a system QR id (opaque cuid), a sequential `SAM-0001` "never reused", and an optional custom reference; a workspace setting picks which prints under the QR. ([Shelf](https://www.shelf.nu/knowledge-base/asset-identifiers-qr-id-sam-id-property-id)) | Shelf | I1/I10: the QR carries the opaque code and is never reprinted; a sequential display number is auto-assigned per org (no prefix setting) and is what people say aloud. Two columns, no setting (D-INV18). |
| 3.5 | **Haptics carry meaning.** Shelf: two pulses on success, three on error (unsupported type or another org's code); an unclaimed code shows a contact form, not a dead end. ([Shelf](https://www.shelf.nu/knowledge-base/scanning-an-asset)) | Shelf | I6 web: iOS web has no vibration (§4.4), so audio carries it; I13 native: haptics via the existing `haptic` prop on `ActionBar`. |
| 3.6 | **Blockers banner, not silent skips.** Shelf: a yellow "Unresolved blockers" banner with "Resolve all"; codes not on the booking, already out or in use elsewhere are blocked and named. ([Shelf](https://www.shelf.nu/knowledge-base/progressive-checkout-of-bookings)) | Shelf | I6/I9: an asset scanned onto unit 654 while held by 611 is a named blocker with a "move it here" answer. |
| 3.7 | **Location update is a side effect of scanning in an audit.** GoCodes stamps location + GPS per scan; Asset Panda's Room field bulk-sets scanned assets; EZO flags "Wrong Location". | GoCodes, Asset Panda, EZO | I9: scanning an item during a unit check that is recorded elsewhere offers "it's here now" as the one-tap fix (writes an `asset_movements` row). |
| 3.8 | **No signature is a defensible choice — the best-designed product made it.** Shelf: "Shelf does not have PDF custody agreements or e-signatures"; Cheqroom's pad is "quite poor" per reviewers; Snipe-IT does acceptance asynchronously by email with reminders. ([Shelf](https://www.shelf.nu/knowledge-base/understanding-and-using-pdf-agreements-for-asset-custody-in-shelf), [Snipe-IT](https://snipe-it.readme.io/docs/requiring-acceptance.md)) | Shelf | D-INV3 stands; Q7's revisit path (an `esign_consents`-shaped row) matches Snipe-IT's async model if it is ever needed. |
| 3.9 | **Status vocabulary is small.** Available / Checked out / In custody / Retired (Cheqroom, Shelf); Snipe-IT's meta-types with "Deployed" derived from assignment, and its v7 rule that a repair status force-checks-in is hated ([issue 15679](https://github.com/grokability/snipe-it/issues/15679)). | Cheqroom, Shelf | I1: the plan's five (`in_service`, `in_repair`, `spare`, `lost`, `retired`) are fine; **`in_repair` must not clear the holder**, or the truck loses the record of what it is missing. |
| 3.10 | **Labels: QR + human-readable code + name; square Avery sheets; test-print one sheet first.** Shelf's defaults: name top, QR centre, code under; Avery 22805 1½" "popular for general use", 22816 2" for "heavy machinery". Fleetio pins 5160/5163 and weatherproof 5520/5523. Sortly's one praised feature: "start from a specific position on a partially used sheet". ([Shelf](https://www.shelf.nu/knowledge-base/using-shelf-qr-codes-with-avery-label-sheets), [Fleetio](https://help.fleetio.com/hc/s/article/Use-Fleetio-To-Generate-And-Print-Asset-Labels), [Sortly](https://help.sortly.com/hc/en-us/articles/360037385792-Create-QR-Code-and-Barcode-Labels)) | Shelf, Fleetio, Sortly | I1b/I10: `labelSheet()` presets = Avery 22805, 22816, 5160, 5520 + a roll single; a start-position parameter; an X/Y nudge in the preview. |
| 3.11 | **Mobile home = my stuff + what's due + scan.** EZO: "My Assignments … due today, tomorrow, or overdue"; Shelf Companion: counts, overdue, status breakdown. | EZO, Shelf | I13: the driver's kit lives on the Home "Your rig" card (D-DB17), not a new tab. |

---

## 4. The scanner — the spec, derived from the one vendor that published research

Scandit is the only SDK vendor with a public UX rationale, and Apple's VisionKit sets what iPhone users
expect. Together they give a spec; the pieces are cited.

**4.1 Trigger and preview.** "When starting the camera hundreds of times a day, a large, ergonomic touch
area is a must. A small icon or button just won't do." SparkScan: a floating trigger, tap = single scan,
tap-and-hold = continuous, and a draggable **mini preview** rather than a full-screen camera, so
"close-range scanning without watching the viewfinder" works one-handed
([Scandit, Scanning at Scale](https://www.scandit.com/blog/scanning-at-scale-ux-insights/),
[SparkScan](https://docs.scandit.com/next/sdks/web/sparkscan/intro/)). Timly's top review complaint is
"The camera scanning button in the current app is very small" ([G2](https://www.g2.com/products/timly/reviews?qs=pros-and-cons)).

**4.2 Aim and pick.** A centre-weighted aimer; decode only inside it, which also "reduce[s] processing
overhead on low-end devices"; with several codes in view, take the centre-most and let a tap pick another
— VisionKit's default behaviour ("recognizes the center-most item until user taps elsewhere")
([Scandit](https://www.scandit.com/blog/ergonomic-scanner-for-frontline-workers/),
[WWDC22 10025](https://developer.apple.com/videos/play/wwdc2022/10025/)). Dynamsoft: a small region of
interest "dramatically reduc[es] latency" ([Dynamsoft](https://www.dynamsoft.com/blog/insights/browser-barcode-scanning-challenges-best-practices/)).

**4.3 Feedback and timing.** "Scan feedback should be obvious and delivered through visual, sound and
haptic feedback" because shops are noisy; and the measured number: **a 150 ms delay between confirmation
and closing the camera "significantly improved user perception of reliability"**
([Scandit](https://www.scandit.com/blog/scanning-at-scale-ux-insights/)). Zebra's DataWedge exposes the
same three channels plus a "Same Symbol Timeout" so a code in frame is not read twice; a camera scanner
reproduces that as an ~800 ms debounce ([DataWedge](https://techdocs.zebra.com/datawedge/7-4/guide/input/barcode/)).

**4.4 iOS web reality, tested before anything is built on it.**
- Torch works on iOS ≥ 17.5.1 via `applyConstraints({ torch })`; gate the button on
  `track.getCapabilities().torch` ([bug 243075](https://bugs.webkit.org/show_bug.cgi?id=243075)).
- `zoom` is exposed in capabilities since 17.0 but not applied; Dynamsoft falls back to crop-zoom
  (draw a centre crop of the video to a canvas and decode that) ([Dynamsoft](https://www.dynamsoft.com/codepool/auto-zoom-web-qr-code-scanner.html)).
- `ImageCapture` does not exist on iOS through 26.6; stills come from a canvas ([caniuse](https://caniuse.com/imagecapture)).
- One capture at a time: on background or app switch the track is `muted` with no programmatic unmute —
  stop and re-acquire on `visibilitychange` ([WebKit](https://webkit.org/blog/7763/), [bug 179363](https://bugs.webkit.org/show_bug.cgi?id=179363)).
- **No haptics on iOS web.** `navigator.vibrate` was never implemented in Safari and the checkbox-switch
  trick fires at most one tick on a direct tap, never on a decode ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate),
  [haptics survey](https://haptics.kushagragolash.dev/)). Decode feedback on the web is **tone + flash**;
  the driver app gets real haptics.
- Glare: torch on a laminated label adds glare; the hint is "tilt 10–15°", not "turn on the light"
  ([Honeywell](https://sps-support.honeywell.com/s/article/Is-it-possible-to-reduce-specular-reflection-when-scanning-a-bar-code)).
- Still-image fallback: `<input type="file" accept="image/*" capture="environment">` opens the rear camera
  and must be triggered from a user gesture — the D-APP11 path the apply feature already uses, now decoded
  through the same WASM ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/capture)).

**4.5 Offline, the cheap version.** Background Sync is unsupported on Safari through 26.6 and will not
be ([caniuse](https://caniuse.com/background-sync)), so the pattern that survives iOS is: write the
mutation to IndexedDB *before* the network call, carry the client UUID as the idempotency key, replay on
`online` and on foreground. Home-screen web apps are exempt from Safari's seven-day storage purge; a
Safari tab is not ([WebKit ITP](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
That collides with fact 2 (installed = camera re-prompt on route change). The resolution: the scan page
never changes route while the camera is open, so installed is safe, and installed is what the shop
should do. D-INV27 (client-generated UUID primary keys) is the server half of this.

**4.6 Library.** `vue-qrcode-reader` on Sec-ant's `barcode-detector` / `zxing-wasm`: MIT, uses the native
detector where it exists and the same ZXing-C++ WASM everywhere else, reader-only WASM ~1.04 MiB,
self-hosted via `prepareZXingModule({ locateFile })`, QR + Data Matrix + Code 128 + GS1 for supplier labels
([vue-qrcode-reader](https://github.com/gruhn/vue-qrcode-reader),
[barcode-detector](https://github.com/Sec-ant/barcode-detector)). Rejected: `html5-qrcode` — "in
maintenance mode until further notice", last release April 2023, on an unmaintained engine
([GitHub](https://github.com/mebjas/html5-qrcode)); Quagga2 — 1D only. When to pay: Scandit if the pilot
fails on greasy supplier 1D codes (its engine is service-worker-cacheable, iOS Safari 15.2+); Dynamsoft at
$1,499/yr has web auto-zoom but needs a special offline licence; STRICH meters per scan and phones home
on standard plans — wrong shape for a shop with dead zones ([Scandit](https://www.scandit.com/products/web-sdk/),
[Dynamsoft pricing](https://www.dynamsoft.com/barcode-reader/pricing/), [STRICH FAQ](https://strich.io/faq/)).

**4.7 Labels, the physics.** ECC-H (30 %) for a tag that gets grease and scuffs; keep the payload short
(an id, not a URL) so the symbol stays ≤ version 4; a 1-inch QR at version 3 gives ~0.69 mm modules,
comfortably above the 0.4 mm phone-scanning floor; four-module quiet zone; a human-readable code beside
the symbol is "the only path when a laminate has fogged"
([McAuley](https://mcauleylabels.com/blogs/articles/how-to-print-qr-codes-on-labels),
[qrcodekit](https://qrcodekit.com/guides/quiet-zone-requirements-for-qr-codes/)). Data Matrix takes
~30 % less area at matched payload and is in every decoder above — the choice for anything under ¾"
([Computype](https://computype.com/blog/data-matrix-barcodes-technical-guide/)). Materials: thermal-transfer
polyester with matte laminate for bins and shelves; photo-anodized aluminium for anything on the truck,
near exhaust, or pressure-washed — "lasts for more than 20 years outdoors", matte "eliminates glare"
([Camcode](https://camcode.com/blog/what-to-look-for-when-buying-metal-qr-code-tags/)). GoCodes' own
guide: polyester 2–3 years indoors, anodized foil ~10 years, metal "multiple decades"
([GoCodes](https://gocodes.com/label-types/)).

---

## 5. Shop-floor design patterns, mapped to components this product already has

Numbers are the platform floors, verified: Android 48 dp targets with 8 dp gaps
([Android a11y](https://support.google.com/accessibility/android/answer/7101858?hl=en)); Apple 44 pt
default control, body 17 pt, "avoid Ultralight, Thin, and Light", "convey information with more than
color alone" ([HIG](https://developer.apple.com/design/human-interface-guidelines/accessibility)); WCAG
4.5:1 for text under 18 pt ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).
Thumb reach: 49 % of users hold one-handed, "screen bottom is most comfortable, while the top demands a
stretch" ([Hoober](https://www.uxmatters.com/mt/archives/2013/02/how-do-users-really-hold-mobile-devices.php),
[A List Apart](https://alistapart.com/article/how-we-hold-our-gadgets/)). A gloved fingertip is larger
than a bare one and consumer phones have no glove mode (Zebra's TC53 does, at 600 nits
([Zebra](https://www.zebra.com/us/en/products/spec-sheets/mobile-computers/handheld/tc53-tc58.html))), so
the software absorbs it: 48 dp minimum, 56–64 dp for anything hit during a count, 12 dp gaps.

| # | Pattern | Spec | Web (apps/web) | Driver (apps/driver) |
|---|---|---|---|---|
| 5.1 | **Standalone shop chrome.** Below 768 px or in `display-mode: standalone`: no sidebar, full-height viewport, `overscroll-behavior-y: contain` on the camera page, sticky bottom action bar with `env(safe-area-inset-bottom)`, in-content back (iOS standalone has none) ([web.dev](https://web.dev/learn/pwa/app-design)). | — | New `layout: "shop"` on `ApplyLayout`'s model (D-INV17) | `Screen` + `ActionBar` already do this |
| 5.2 | **Scan trigger → verb sheet.** 64 dp trigger in the bottom bar centre (thumb overlap zone); on decode a bottom sheet with ≤ 4 verbs at 56 dp, item card on top, first verb = last used. No product ships this as a component; Sortly pre-arms one verb, Fleetio branches by type. | ≤ 4 verbs; safe-area padding | The sheet is a `SlideOver` from the bottom edge — the contract's one drawer, on a phone. Verbs are `AppButton size="lg"`. | `ChoiceSheet` exists |
| 5.3 | **Armed verb, continuous scan.** Pick the verb once, scan many (Sortly Quick Actions; Shopify "scan multiple items without the scanned items list interfering") ([Shopify](https://changelog.shopify.com/posts/updated-inventory-scanner-in-the-shopify-app)). | 800 ms same-symbol debounce | I6 receive/count modes | — |
| 5.4 | **Three-channel decode feedback.** Tone + aimer flash (+ vibrate on Android). Distinct error tone. | tone ≤ 150 ms, flash 200 ms, then the 150 ms hold before collapse | Web Audio, CSS | `haptic` prop |
| 5.5 | **Stepper + type-over, default 1.** 56 dp − / + with 12 dp gap; tapping the numeral opens the keypad with the value selected. `type="text" inputmode="numeric" pattern="[0-9]*"` — never `type=number` ("users accidentally incrementing … when they're trying to scroll" — [GOV.UK](https://design-system.service.gov.uk/components/text-input/); the numeric keypad "increases the size of each key by 500 %" — [Baymard](https://baymard.com/labs/touch-keyboard-types)). Long-press repeats at 5/s after 500 ms. | | `AppInput` with the attributes; `AppButton` for ±. `lint:ui-adoption` bans raw inputs, so this is a small shared `QuantityStepper` in `@/components` | `NumericField` exists |
| 5.6 | **Out-of-stock chip.** A 48 dp "0" beside the stepper (xtraCHEF's "Out of stock") ([Toast](https://support.toasttab.com/en/article/xtraCHEF-Mobile-Inventory)). Zero is the most typed count and the most fat-fingered. | | part of 5.5 | part of 5.5 |
| 5.7 | **Blind count with reveal.** Expected hidden during the count, shown with the signed delta on review; supervisor toggle; mode logged on the row (§2.6). | | I5 count | — |
| 5.8 | **Delta-gated confirm.** No confirm under max(5, 5 %); above it a consequence-labelled confirm — "Record 0 of 12 / Keep counting", never "Are you sure" ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)); above 10 % the row is flagged for a second counter (§2.8). | 48 dp buttons, verb labels | `window.confirm` is the house control; its text carries the consequence | `ConfirmSheet` |
| 5.9 | **Per-row commit with undo toast.** Save on entry; "Counted 12 · Undo", one action, ~6 s, above the bottom bar. Undo is the category's named gap (Flex Rental users asking for it). | 48 dp single-line | `useToastStore` — an undo action is a small extension | `Toast` |
| 5.10 | **Session progress header.** Sticky "12 of 40 · 3 short" chips (Lightspeed's bar, Cheqroom's "# scanned" + check). Counts, not percent. | 32 dp chips, 20 pt numerals | I5/I9 session | `Progress` exists |
| 5.11 | **Variance badge, not row tint.** Short = critical "−3", Over = warning "+2", Match = success check, Uncounted = neutral outline; yellow tint reserved for "expected changed since you started" (Lightspeed's *QOH Changed*) ([Lightspeed](https://retail-support.lightspeedhq.com/hc/en-us/articles/229129948-Performing-inventory-counts-in-Retail-POS)). Icon + number always; tints kill contrast in sunlight. | ≥ 4.5:1 | `@/lib/badges` tones map 1:1: danger / warning / success / neutral | `Badge` + `tone.ts` |
| 5.12 | **Item history feed.** Sticky day headers, icon badge per event kind, headline + ≤ 3 lines, trailing signed delta and actor; the decorative line hidden from assistive tech (Fiori Timeline, Primer Timeline) ([SAP](https://help.sap.com/doc/f53c64b93e5140918d676b927a3cd65b/Cloud/en-US/docs-en/guides/features/fiori-ui/android/timeline.html), [Primer](https://primer.style/product/components/timeline/)). Table on desktop. | | I8: `CaseTimeline` promoted as the second consumer | — |
| 5.13 | **Keep-awake count session.** Request the wake lock in the "Start count" tap (user activation), re-request on `visibilitychange`, release on close; works in home-screen web apps since iOS 18.4 ([WebKit 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)). | | I5 | — |
| 5.14 | **Connectivity strip in plain words.** "Saving on this phone — will sync when connected", a queued-row count, a toast on reconnect; never block the count; "the word 'offline' often isn't clear enough" ([web.dev](https://web.dev/articles/offline-ux-design-guidelines)). | 32 dp strip | new, small | `OfflineBanner` + `SyncStatus` exist |
| 5.15 | **Fixed label templates + start position + nudge.** Pinned Avery map, "start at position n" (Sortly), preview with X/Y nudge (Avery's own tool), the printed instruction "Scale 100 % / Actual size", and the diagnostic copy: uniform shift → nudge, progressive drift → scaling ([Avery](https://www.avery.com/help/article/not-printing-correctly-print-is-shrunk-misalignment-too-low-on-page-too-high)). No in-app designer — Cheqroom's is "a frustrating version of excel" ([G2](https://www.g2.com/products/cheqroom/reviews)). | | I10 | — |
| 5.16 | **First-run three tiles.** "Add a part · Import CSV · Print first labels" (Shelf's five-step start; Sortly's locked-header CSV with an error report) ([Shelf](https://www.shelf.nu/knowledge-base/getting-started), [Sortly](https://help.sortly.com/hc/en-us/articles/360000735352-Bulk-Importing-New-Items-Folders)). No sample rows in production tables. | | I4 empty state via `DataTable` `#empty` | — |

---

## 6. What not to copy — the complaints that recur

- **Forcing a due date or time on every action** (Cheqroom: "I have to change the due date time every
  single time") — D-INV3 has no due dates; keep it so.
- **Check-out as a folder move with no holder** (Sortly) — reviewers ask for "a transactional procedure".
- **An audit "mode" that only stamps location with no expected list** (GoCodes) — cannot report missing.
- **Calling something Missing before the session ends** — Shelf shipped a fix for exactly this.
- **A status change that silently changes custody** (Snipe-IT v7 Pending → auto check-in) — see §3.9.
- **Mobile without web parity** — the single most repeated complaint across Fleetio, Cheqroom, Reftab,
  UpKeep. The shop's two phone flows must be complete, not a subset.
- **Back button that goes home** (Reftab), **tiny scan button** (Timly), **torch that resets in low
  light** (Sortly), **pixelated auto-cropped photos** (GoCodes), **constant re-login** (AssetTiger).
- **Fixed label sizes** (Sortly "only two sizes"), **misaligned Avery output** (Snipe-IT 5160 issues
  open for years), **consecutive-numbers-only printing** (AssetTiger).
- **Configuration-first products** where check-out is a form you must build (Asset Panda: "configuration
  pages are very confusing"; Snipe-IT: "Configuration is a NIGHTMARE") — D-INV13's fixed fields are the
  right side of this.
- **A signature pad that is bad to draw on** (Cheqroom) — Shelf's omission is the better product.
- **Silently zeroing uncounted lines at close** (Square) — offer zero vs skip as a choice.
- **`type=number` for quantities** — scroll increments the value (GOV.UK).

---

## 7. Decisions this research recommends — numbered to continue the plan's series

| ID | Decision | Source |
|---|---|---|
| **D-INV17** | **The scan page is a standalone shop layout and never changes route while the camera is open.** `layout: "shop"` on the apply layout's model; scan → resolve → verb sheet → write all happen on `/shop/scan`. The reason is a measured WebKit defect (§1 fact 2) and it is also the better product (§4.1). The shop installs the web app to the home screen (durable storage, wake lock), which is only safe because of this rule. | §1, §4.4, §4.5 |
| **D-INV18** | **An asset has two identifiers and no identifier setting.** `tag_code`: the opaque Crockford id in the QR, assigned once, never reprinted. `display_no`: a per-org sequence, auto-assigned, printed as text under the QR and spoken aloud. Shelf's evidence: the QR id and the human number do different jobs. The prefix/format setting stays deleted. | §3.4 |
| **D-INV19** | **A count and a unit check are one session shape.** `stock_count_sessions` (org, location or unit, started_by, blind, status, closed_at) with each entry committed at once as a `counted` movement or an `asset_movements` row carrying the session id. Buckets Found / Not yet / Unexpected while open; Short / Over / Missing only at close. One session component serves parts (I5) and trucks (I8). New table, exempt from ordering, ships with its reader. | §2.7, §3.3 |
| **D-INV20** | **Counts are blind by default; a supervisor can reveal; the mode is recorded on the row.** | §2.6 |
| **D-INV21** | **A variance above max(5, 5 %) gets a consequence-labelled confirm; above 10 % the row is flagged for a second counter and the movement still commits.** The recount is a second `counted` row, not a block — the ledger records both. | §2.8 |
| **D-INV22** | **Decode feedback is tone + flash on the web, haptic in the driver app.** iOS web has no vibration; the plan does not depend on one. | §4.4 |
| **D-INV23** | **WASM is self-hosted and the still-image path is first class.** `barcode-detector` / `zxing-wasm` with `locateFile` pointing at our own origin; `<input capture>` and typed entry are the two fallbacks rendered on the scan page, not error states. | §4.5, §4.6 |
| **D-INV24** | **`in_repair` does not clear the holder.** A tablet in repair is still unit 654's tablet, missing from it. Snipe-IT's opposite rule is its most-hated behaviour. | §3.9 |
| **D-INV25** | **Label presets are Avery 22805, 22816, 5160, 5520 and a roll single, with a start position and an X/Y nudge.** ECC-H, payload ≤ version 4, human-readable `display_no` beside the symbol. The label screen names the materials (§4.7) in plain words. | §3.10, §4.7 |

**Where this lands in the plan:** I1 carries `display_no` and the `BIN` kind; I5 carries
`stock_count_sessions` and the session flow with 5.5–5.11; I6 is the scanner and the tag fabric under
D-INV17/22/23 with the §4 spec as its screen; I9 reuses the session for the unit check; I10 gets the five
presets; I13's kit lives on the Home "Your rig" card.

---

## 8. Sources not linked inline

Fetched but summarised rather than quoted: Fleetio Go release notes 4.3.4–5.20; MaintainX help-centre
updates January 2025; Limble mobile 2026 release ([Plant Engineering](https://www.plantengineering.com/products/limble-mobile-app-2026-release/));
Motive Maintenance launch ([Motive](https://gomotive.com/blog/motive-maintenance-launch/)); Samsara Q3
2025 updates; Cheqroom Quick Check-in (Dec 2024); Shelf changelog August–September 2026; Scandit
MatrixScan Count; Cleverence 2026 cycle-count buyer's guide; SAP Fiori iOS search-bar scanner; Square for
Retail counts; Shopify POS Quick count (2025-10-23). Pages that returned 403 and were used only through
search excerpts: Fleetio Parts v2 blog, Samsara KB Parts Management, Zebra's component-library post,
Scandit's size KB, STRICH pricing, Brady and Metalcraft material pages.
