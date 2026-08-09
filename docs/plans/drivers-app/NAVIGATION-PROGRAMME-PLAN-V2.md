# Commercial Navigation Programme — v2

**Status:** decided; supersedes `NAVIGATION-PROGRAMME-PLAN.md` (2026-08-07)
**Decision date:** 2026-08-08
**Scope owner:** Navigation module · packages `@nav/*`
**Parent decisions:** `DRIVER-APP-PLAN.md` D52 · `PLATFORM-STRATEGY-AND-HAZMATGUARD-GTM.md`

**What changed and why.** v1 chose HERE SDK Navigate Edition and specified an excellent safety
programme on top of it. Three findings force a revision:

1. **The market moved.** Samsara shipped Commercial Navigation on 2025-11-12; Motive on 2026-05-27.
   Both do dimensions, hazmat and HOS. Samsara also does fuel-price rerouting. Our customer already
   pays Samsara. "Ours is safer" is not a purchasable claim before GA.
2. **The economics of v1 are unbounded.** HERE publishes included-transaction volumes and overage
   rates but *not* the price of a MAU or an asset, and Navigate Edition is not available on the
   self-serve Base Plan at all. We cannot commit to a cost we cannot see, and the hard constraint is
   that navigation must not cost more than the Samsara feature it replaces.
3. **The one thing nobody in this market does is citation.** Trimble's own docs disclaim their hazmat
   data currency. HERE does not publish sourcing. There is no open, national, citation-linked truck
   restriction dataset anywhere — public or commercial. That absence is the product.

**The revision in one line:** we stop buying a navigation engine and start building the compliance
layer that no engine has, on an open substrate that costs ~$2/truck/month instead of an unquotable
per-MAU licence.

---

## 1. What we are actually selling

Not "another truck GPS." Every incumbent has one now, and we would be the fourth.

**We are selling the only truck routing in the market where every restriction cites its source.**

When Samsara routes a truck around a bridge, the driver sees a detour. When Trimble does it, the
driver sees a detour, and Trimble's documentation says to go check the tunnel rules yourself. When
we do it, the driver sees:

> **US-1 at MM 43 — 13'2" clearance, your combination is 13'6"**
> FHWA National Bridge Inventory 2025, structure 084521, Item 54B (measured), inspected 2024-06.
> *Measured clearance. The posted sign governs — obey it.*

and dispatch can export that as evidence, and the verdict is reproducible bit-for-bit two years
later in a deposition because the engine is deterministic and the dataset is versioned.

That is the same asset we already built in HazmatGuard — a versioned regulatory dataset, a pure
deterministic engine, CFR citations, an SME-signed golden suite — applied to the road network. It
is the slowest thing in this document for a competitor to copy, and it is the only part that is not
a commodity.

**Corollary:** the routing engine is a replaceable substrate. The compliance layer is the product.
Every architectural decision below follows from that sentence.

---

## 2. The stack

```
┌─ Buyers ─────────────────────────────────────────────────────────────────┐
│  Free lookup tool · Owner-operator app · Fleet + dispatch ·              │
│  White-label API · Shipper route assurance                               │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
┌─ @nav/compliance ── THE MOAT ─┴───────────────────────────────────────────┐
│  Deterministic verdict engine. No Date.now(), no Math.random(), no I/O.  │
│  Inputs: geometry + combination profile + @nav/restrictions@version      │
│          + policy@version                                                 │
│  Outputs: verdicts, each carrying an EVIDENCE TIER and a citation        │
│  @nav/restrictions  — versioned dataset (NBI · NHMRR · authority table · │
│                       eCFR rules · state GIS · permits)                  │
│  @nav/golden        — SME-signed golden route corpus                     │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
┌─ Routing substrate (swappable) ──────────────────────────────────────────┐
│  PRIMARY: self-hosted Valhalla, truck costing, on tiles built from OSM   │
│           PBF enriched with our restriction layer                        │
│  ORACLE:  HERE Routing v8 — independent second opinion, sampled          │
│  (interface: RoutingProvider — Valhalla, HERE, Trimble all implementable)│
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
┌─ Planning plane (server) ────┴───────────────────────────────────────────┐
│  Combination profile · fuel objective · locked stops · route publication │
│  versioning · immutable events · audit · facility entrances              │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │
┌─ Guidance plane (device) ────┴───────────────────────────────────────────┐
│  Ferrostar (BSD) core + MapLibre RN 11.x · PMTiles offline basemap       │
│  valhalla-mobile for offline routing · expo-speech for voice             │
└───────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Why Valhalla, concretely

| Requirement | Valhalla | Verified |
|---|---|---|
| Truck costing with real parameters | `height` 4.11m, `width` 2.6m, `length` 21.64m, `weight` 21.77t, `axle_load` 9.07t, `axle_count` 2–20, `hazmat`, `use_truck_route`, `hgv_no_access_penalty` | `src/sif/truckcost.cc` |
| Inject our own restriction data | Two paths: conflate into the PBF as OSM-schema tags (837 documented tags in `taginfo.json`, incl. the full truck set) + forked `mjolnir.graph_lua_name`; **and** `linear_cost_factors` at request time, budget **50,000 edges** | PR #5584 (v3.6.2), PR #5942 (v3.8.0) |
| Turn-by-turn narrative | Native, 33 language tags, plus OSRM-format `bannerInstructions` / `voiceInstructions` that Ferrostar consumes directly | route API reference (verified 2026-08-08) |
| Lane guidance | `turn_lanes: true` → per-maneuver `lanes[]` with `directions`/`valid`/`active` | route API reference |
| Map matching | Meili — `trace_route` / `trace_attributes`, server-side | valhalla docs |
| Offline on device | `valhalla-mobile` (Rallista) — Valhalla 3.6.3 as iOS xcframework + Android AAR on Maven Central, v0.5.1 Apr 2026 | github.com/Rallista/valhalla-mobile |
| Cost | Infrastructure only. No per-MAU, no per-trip, no per-driver. | — |

**And the strategic tell:** Samsara's own launch release says Commercial Navigation "leverages …
millions of Samsara devices, global service providers, and **multiple open source platforms**."
The incumbent did not buy a premium nav SDK either.

### 2.2 The three honest weaknesses of Valhalla, and what we do about each

| Weakness | Consequence | Our answer |
|---|---|---|
| **OSM truck-attribute coverage in North America is weak and unmeasured.** `prop2osm` exists commercially precisely because of this. | If we relied on OSM tags for restrictions we would ship an unsafe product. | **We do not rely on them.** `@nav/restrictions` conflates FHWA NBI (624,193 structures, public domain), NHMRR, the authority table and state GIS into the tiles. OSM supplies *geometry and topology*; our layer supplies *restrictions*. NP0.1 measures OSM coverage against our lane network before we commit. |
| **Valhalla has no `notices` mechanism.** It will not tell you why it avoided a road. `trace_attributes` does not return restrictions either. | v1's entire safety policy was built on parsing HERE notices. That mechanism does not exist here. | **This becomes an advantage.** Because *we* inject the restriction, *we* know exactly which one bound and why — so we emit a better explanation than HERE's opaque notice codes: the restriction, the value, our vehicle's value, the citation, the tier, and the detour cost it caused. Implemented in `@nav/compliance`, not borrowed from a provider. |
| **`hazmat` in Valhalla is a single boolean.** `lua/graph.lua` collapses `hazmat:A`–`E` into one flag with an in-source `TODO`. No DOT class 1–9. | Insufficient for US regulatory hazmat routing. | `@nav/restrictions` carries per-class and per-facility hazmat prohibitions and applies them via `linear_cost_factors` and tag injection, keyed to the load's actual classified goods from HazmatGuard. |

### 2.3 Guidance plane — what exists and what we build

| Component | Licence | State as of 2026-08 | Work required |
|---|---|---|---|
| **Ferrostar** core + MapLibre UI | **BSD** | In-tree `react-native/` monorepo at v0.53.0 — four workspaces, Expo Router example with `newArchEnabled: true`. **Not published to npm.** | Vendor the monorepo, run `build-android.sh`/`build-ios.sh` for UniFFI bindings. Real work, bounded. |
| Voice guidance in RN | — | **Missing.** Two `TODO`s in `react-native/core/src/FerrostarCore.ts` (lines 289, 409). iOS/Android/Web have TTS; RN does not. | Wire `expo-speech` off the spoken-instruction field. Small. Contribute upstream. |
| `@maplibre/maplibre-react-native` | BSD | **11.3.6**, RN ≥ 0.80, New Architecture only, native PMTiles incl. `pmtiles://file://` | Already in our stack. |
| Offline basemap | — | PMTiles on disk. Must be written to `filesDir` — bundled assets don't support byte-range reads. | Corridor/state extracts, not CONUS in one blob. |
| Offline routing | MIT/BSD | `valhalla-mobile` behind Ferrostar's documented `CustomRouteProvider` interface | Bindings integration. |
| On-device map matching | — | **Not available** — `valhalla-mobile` exposes only `route()`. | Not needed: Ferrostar's Rust core does live snapping, deviation detection and step advance itself. Meili stays server-side for post-hoc trace matching. |

**Risk and hedge.** Ferrostar RN is further along than its own docs admit but is not `npm install`.
NP-G0 is a two-week spike with a defined fallback: if the RN bindings prove unworkable, we render
guidance as a **native full-screen Activity / ViewController that RN launches** — a far smaller
bridging surface than embedding a map view — using the mature Ferrostar iOS/Android SDKs directly.
Either way we are on BSD-licensed code we can fork and fix, not a closed SDK with a support ticket.

### 2.4 Cost model — the hard constraint

Silvicom: 186 power units, ~300 monthly-active drivers, ~13,200 trips/month.

| Line | Config | $/month | $/power unit/mo |
|---|---|---|---|
| Valhalla serving | 2 × Hetzner AX52 (64 GB) @ €64 | ~$139 | $0.75 |
| Tile build (amortised) | AX162-R (256 GB) spun up for builds | ~$100 | $0.54 |
| Basemap tiles | Self-hosted PMTiles on object storage | ~$25 | $0.13 |
| **HERE oracle** | ~20% sampling ≈ 21k routing req/mo @ $0.88–2.92/1k | $18–61 | $0.10–0.33 |
| **Total** | | **~$282–325** | **≈ $1.52–1.75** |

Sensitivity: doubling trip volume moves this by pennies — the substrate is fixed-cost. A per-MAU
model does the opposite: Mapbox's $0.30/MAU + $0.08/trip would be **$5.57/unit/mo** today and grow
linearly with every tenant, and it cannot route trucks at all.

**Against the constraint.** Samsara's Commercial Navigation price is **not published anywhere** — not
on their site, not in the Sourcewell 2024 award (which no longer itemises SKUs), not in any of 898
analysed public-sector contracts. It sits in the paid "Fleet Application Suite," and enabling it
requires an account rep. Samsara's *base* telematics licence is $23–39/vehicle/month list
(Sourcewell 020221-SAM). Observable standalone truck-nav pricing runs $3.75–$30/driver/month.

→ **Action NP0.0: get the Commercial Navigation line from Silvicom's actual Samsara quote, in
writing.** That is the only number that survives scrutiny. Until then the constraint is satisfied
against any plausible value with roughly a 3–10× margin.

**Caveat stated plainly:** this table is infrastructure and licences. Engineering time is the
dominant cost of this programme and is estimated separately in §10.

---

## 3. `@nav/compliance` — the moat

### 3.1 Evidence tiers

Every restriction the router applies carries a tier. This is the central concept of the product and
it is what makes "citation-grade" a testable claim rather than a slogan.

| Tier | Source | Citable as | Example |
|---|---|---|---|
| **T1 — Regulation** | Statute / CFR / state administrative code, parsed from eCFR API and state code publishers | Section + effective date | 49 CFR 397.101(b); 23 CFR 658.17; COMAR 11.07.01; 21 NYCRR 1025 |
| **T2 — Federal dataset record** | FHWA NBI, National Tunnel Inventory. Public domain. | Dataset + edition + record ID + field + inspection date | NBI 2025, structure 084521, Item 54B = 4.01 m, inspected 2024-06 |
| **T3 — Authority publication** | Toll/bridge authority tariff or rule; state DOT GIS layer | Document + retrieval date | MDTA Tunnel Restrictions, retrieved 2026-08-01; ODOT TransGIS layer 108 |
| **T4 — Conflation (our work product)** | Geometry *we* attached to a T1/T2/T3 textual restriction | Our method + version + confidence. **Labelled as ours.** | NHMRR TX row "IH 35 [Bexar County] from the IH 35/IH 10 interchange to…" matched to way IDs, confidence 0.91 |
| **T5 — Provider assertion** | OSM tag, or HERE/Valhalla said so | Not citable. Advisory only. | `maxheight=4.1` on OSM way 123456 |

A route carries a **compliance grade**: `T1–T3 clean` (every binding restriction is
citation-backed), or `contains T4`, or `contains T5`. Dispatch sees it. The API returns it. The
shipper certificate states it. **Nobody else in this market can produce that sentence.**

The tier system is also the honesty mechanism. We will *never* claim a route is guaranteed legal.
We will say precisely how good our evidence is, restriction by restriction — which is both more
defensible in court and more useful to a safety director than a green checkmark.

### 3.2 The dataset build

Governed by the same rules as `@hazmat/data`: semver, changelog, CFR/source provenance per version,
SME sign-off, and a golden suite that re-verifies on every release.

**A. Hazmat — 49 CFR 397 and the NHMRR**

- **The legal hook that makes this tractable: §397.73.** A state hazmat designation is *not
  federally effective or enforceable against an interstate carrier until published in the NHMRR.*
  That lets us make a confident **negative** claim ("no federally effective designation exists on
  this segment") which is often more defensible than a positive one, and it bounds the dataset.
- **The registry is per-state PDF and XLSX with no geometry.** Columns: effective date, designation
  code (A / B / I / P), route order, free-text route description, city, county, restriction code
  (0 = all hazmat, 1–9 = DOT class, i = PIH). ~50 parsers with format detection; per-state as-of
  dates currently range Apr 2024 – May 2025. Publication lags state designation by up to ~20 months.
- **The federal GIS version is dead** — NTAD dropped it after 2016 and it was a 2004 TIGER
  conflation. **All geometry we produce is T4, and is labelled T4.**
- **§397.67 is a judgement standard, not a dataset** — absent a designation, avoid heavily populated
  areas, crowds, tunnels, narrow streets. No engine discharges that. We surface it as a driver-facing
  advisory on undesignated hazmat movements, cited to the reg, and we do not pretend to satisfy it.
- **§397.101 Class 7 / HRCQ**: default preferred route is the Interstate System absent a state
  alternative; deviation limited to shortest route, or an alternative not exceeding the shortest by
  25 miles or 5×. This is closed-form and fully automatable — a genuine T1 capability.

**B. The tunnel and bridge authority table — the highest-value item in the programme**

There is **no consolidated federal list** of tunnel/bridge hazmat prohibitions. The famous ones are
imposed by bi-state and toll authorities that are not "State routing agencies" under §397.71, so
they never enter the NHMRR. The only consolidated compilations that exist are the copyrighted
Rand McNally *Motor Carriers' Road Atlas* and PC\*MILER's opaque internal database.

~100–200 facilities, hand-curated, each linked to its governing instrument: MDTA (COMAR 11.07.01),
PANYNJ Traffic Rules, MTA B&T (21 NYCRR 1025), NJDOT Route 29 (N.J.A.C. 16:49-4), CBBT, VDOT Hampton
Roads, NYC Fire Code, and so on. Every row T3, every row with a retrieval date and a re-check
cadence.

**This is the single most defensible artefact we can build.** It is pure curation, the engineering
is trivial, and it does not exist anywhere in open form.

**C. Physical restrictions — FHWA NBI**

624,193 highway bridges, annual (2025 posted 2025-06-20), ~51 MB zipped, explicitly public domain.
Fields: `MIN_VERT_CLR_010`, `VERT_CLR_OVER_MT_053`, `VERT_CLR_UND_054B`, `OPERATING_RATING_064`,
`INVENTORY_RATING_066`, plus Items 41/70 posting status.

**Its limitations must be encoded in the product, not hidden:**

1. **Measured ≠ posted.** Item 54B is the surveyed clearance; the enforceable value is the sign,
   which states set 3–6 inches lower by policy. Our UI and API say "measured clearance; posted sign
   governs" on every NBI-derived warning. We never assert legality from NBI alone.
2. One value per structure — no lateral position, no per-direction split on divided highways.
3. >20 ft span threshold: excludes parking canopies, private overpasses, sign gantries — many real
   strike locations are not in NBI.
4. Up to 24-month inspection cycle; overlays change clearance between inspections.
5. ~1% of records geolocate >100 m from any road (~6,000 structures). Conflation must reject, not
   guess.
6. Operating/inventory ratings are engineering capacities, not enforceable GVW-by-axle limits.
7. **Schema break: SNBI replaces the 1995 Coding Guide and NBTIS arrives January 2026.** Build the
   ingest behind a schema adapter from day one.

**D. Weights — the cheapest T1 win in the programme**

23 CFR 658.17 (80,000 lb / 20,000 single / 34,000 tandem) plus the Federal Bridge Gross Weight
Formula `W = 500 × [ (L·N)/(N−1) + 12N + 36 ]`. A closed-form equation and a regulation — no data
licensing, no conflation, pure T1. We compute it per combination and cite it. Grandfathered
over-80k operations live in 23 CFR 658 Appendix C (text).

State posted weights have **no machine-readable national source**; FHWA's compilation is ~2015-era
HTML with no update commitment. Oregon and Washington publish GIS; most states publish PDFs or
nothing. Scope honestly: T1 federal everywhere, T3 state where GIS exists, gap declared elsewhere.

**E. Truck access network**

23 CFR 658 Appendix A (the National Network) is a **text table** — `US 43 | I-65 N. of Mobile |
Sunflower.` The NTAD GIS version explicitly disclaims being the official network and forbids
navigation use, so it is T5 at best. **Do not conflate NHFN with the National Network** — NHFN is a
funding-eligibility network under 23 U.S.C. 167, not an access network. 53' trailer access and
§658.19 reasonable-access boundaries have no national dataset. Declared gap.

**F. What we explicitly will not claim in v1**

Posted (signed) clearances · posted weight limits by axle configuration · seasonal frost/thaw
restrictions · toll rates by axle class (no open dataset exists; TollGuru/Tollsmart are commercial
with undisclosed sourcing) · Canadian TDG routing · 53' access networks. Each is a named gap in the
product, visible in the UI, not a silent absence.

### 3.3 Determinism, enforced

`@nav/compliance` gets the `@hazmat/engine` treatment, CI-enforced: **no `Date.now()`, no
`Math.random()`, no I/O.** A verdict is a pure function of

```
(geometry, combinationProfile, restrictionsVersion, policyVersion) → Verdict[]
```

Reproducible bit-for-bit in a dispute two years later. Very few compliance tools can say that; it is
worth saying out loud to an insurer, an underwriter, and opposing counsel.

### 3.4 The curation flywheel

An attested override on a T4 restriction (§5.2) automatically opens a curation ticket against
`@nav/restrictions`. A driver's "wrong entrance / bad restriction" report does the same. **Every
time a human corrects us, the dataset improves and the correction is auditable.** That compounding
is the moat's growth mechanism, and it is why the override path in §5.2 is a feature rather than a
safety hole.

---

## 4. Dual-source validation — the safety mechanism that replaces HERE notices

v1's safety policy rested on parsing HERE's route notices. Valhalla has no equivalent. Rather than
recreate it, we build something stronger and turn it into a marketable property.

**Mechanism.** The primary route comes from `@nav/compliance` + Valhalla. An **oracle** route comes
from HERE Routing v8 with the same combination profile. We compare geometry overlap and restriction
verdicts.

| Outcome | Route state | Shown to |
|---|---|---|
| Both engines agree | `dual_source_validated` | Badge on preview; recorded in audit |
| Disagreement | `single_source` + structured diff | Dispatcher sees the exact segment, both opinions, and our citation for ours |
| Oracle unavailable | `single_source_degraded` | Labelled; does not block |

**Sampling policy** (cost control, and the numbers are the policy):

- 100% of hazmat loads
- 100% of routes containing any T4-derived binding restriction
- 100% of first-time lanes for an org
- 100% of routes where our engine and the driver's report have previously disagreed
- 10% random sample of everything else
- Cached by `(laneHash, profileHash, restrictionsVersion)`

**Why this matters commercially.** The obvious objection to a small company's routing is "how do I
know your data is right?" Every competitor answers with brand. We answer: *it is continuously
cross-checked against a commercial engine, and we show you every disagreement instead of hiding it.*
No incumbent offers that, and disagreement rate becomes a published quality metric we can improve.

**And it is a curation engine.** Every disagreement is triaged into: our conflation error (fix the
dataset), HERE's data error (report to HERE, keep evidence), or a legitimate policy difference
(document it). The oracle pays for itself in dataset quality alone.

---

## 5. Resolved gaps

### 5.1 Fuel becomes a first-class routing objective

v1 had one clause. This is the capability we are already best in the world at and it becomes a
headline.

Today's solver inserts stops along a fixed route. v2 makes cost a routing objective:

```ts
objective: {
  fuelWeight:  number,   // 0..1, driver/org setting
  timeWeight:  number,
  tollWeight:  number,
  hosWeight:   number,
}
```

1. Request N alternatives from the substrate (`alternates`).
2. Run the existing fuel solver on each — contract net prices, 20% usable-capacity reserve
   including detour + idle + reefer burn, weight-legal fill cap to 80,000 lb, HOS-segmented legal
   drive, CARB/LCFS base-price premium.
3. Score **total landed cost** = fuel + tolls + driver-time cost + HOS-feasibility penalty.
4. Return the cheapest **legal** option, never the cheapest option.
5. Present `$ saved vs fastest route` on the preview.
6. After completion, reconcile planned vs actual against the EFS transaction feed → **actual dollars
   saved**, per driver, per lane, per month.

**Nobody else can close that loop**, because nobody else owns both the routing and the fuel
transaction side. Samsara's shipped feature is a threshold trigger — "reroute to a preferred merchant
when fuel drops below X." Ours is a constrained optimizer with a stated safety invariant:

> FuelGuard will never plan a fill that violates a 20% reserve including detour, idle and reefer
> burn — and if no legal plan exists, it says `INFEASIBLE` loudly rather than suggesting a bad one.

That invariant is a sales asset. A threshold trigger cannot make that promise.

### 5.2 Attested override — replaces v1's NAV-3 absolutism

v1 said a critical notice blocks and dispatch can never waive. That fails in the field at 2am and
pushes the driver to Google Maps — the exact outcome the document exists to prevent. It also
contradicts HazmatGuard H7, which we built deliberately and warned ourselves not to undo.

Resolution — the escape hatch is graded by evidence tier, which is coherent:

| Tier | Behaviour |
|---|---|
| **T1 / T2 / T3** (law, federal dataset, authority rule) | **Blocks. No attestation clears it.** Only a *permit* clears it — an OS/OW permit number or a hazmat routing permit, recorded against the route with issuing authority and expiry. You cannot attest away federal law. |
| **T4** (our conflation) | Blocks by default. A **named safety manager** (role-gated, not any dispatcher) may attest an exception against **that specific restriction ID and route version**, with reason, expiry ≤ 72 h, and an audit row. Never reusable across route versions. Automatically opens a curation ticket. |
| **T5** (provider/OSM assertion) | Warns. Dispatcher may dismiss with reason. Recorded. |

Attestation rate by tier is a first-class SLO metric, so abuse is visible rather than silent. This is
strictly safer than v1: a policy people can comply with beats a policy they route around.

### 5.3 Driver-initiated routes

v1 had no path for a driver to create a route. That breaks owner-operators, scale detours, repair
shops, HOS breaks and deadheads — and it forecloses the self-serve tier entirely.

`POST /v1/routes` with `initiatedBy: "driver"`. Identical profile validation, identical compliance
engine, identical evidence tiers. If a load is active, its locked stops are auto-inserted and cannot
be removed. Emitted to dispatch as a visible event, never silently. Same audit record.

Route lifecycle gains a parallel entry point:

```
dispatcher:  draft → validating → validated → published → acknowledged → active → completed
driver:                validating → validated ──────────────────────────→ active → completed
                                 \→ rejected                 \→ superseded  \→ degraded
```

### 5.4 SLOs — four hard gates, everything else an objective

v1 made ten SLOs release gates, several of which we do not control (99.9% including a third-party
provider) or cannot hold on current infrastructure. A gate that gets quietly relaxed is worse than
no gate — `LOADS-PLAN.md` L0.3 says exactly this: *never by weakening the assertion.*

**Hard gates — binary, inside our control, block GA:**

1. Zero activated routes containing an unresolved T1/T2/T3 blocking restriction. **0.**
2. Zero activated routes missing a required safety-profile field. **0.**
3. Route/event audit completeness and verdict reproducibility. **100%.**
4. Offline golden-route corpus completion with preloaded tiles. **100%.**

**Monitored objectives — alert, incident review, do not block GA:** activation latency p95,
reroute-decision latency, crash-free sessions, session restore rate, control-plane availability,
dual-source disagreement rate, T4 attestation rate, false-arrival rate.

Note on infrastructure: Railway is our development and testing environment. Production hosting for
the routing substrate and control plane is a separate decision, taken at NP4, sized against these
objectives rather than against Railway's limits.

### 5.5 Driver desirability — the risk v1 did not have in its register

Drivers run consumer Google Maps *knowing* the bridge risk. If our app is stricter, slower to start
and dispatcher-gated, it ends up on the paperwork while something else is on the windshield mount.

Committed v1 features that answer "why would a driver choose this":

- **The explanation.** "Why am I being sent 40 miles around?" — answered with the restriction, the
  numbers and the citation. Every other app shows a silent detour. This is the most-requested and
  least-served thing in the category, and our architecture produces it for free.
- **Parking at the HOS-forced stop.** We already compute HOS-legal drive time; predicting where the
  driver will run out and what parking exists there is a natural extension. Parking is drivers'
  loudest complaint and Trucker Path's entire moat.
- **Tolls in the objective**, with the cost shown, not "tolls if available."
- **Fuel savings shown as dollars**, to the driver, not just to the controller.
- **The free lookup tool** (§6, Tier 0) — drivers find us before their fleet does.

**Gate NP2.9: put a clickable preview in front of five real drivers and ask what would make them
stop using their current app.** If the answer is not in this plan, this plan is wrong. This runs
before any guidance-plane spend.

### 5.6 Legal and liability

- **E&O insurance bound before the first pilot truck moves.** Our own HazmatGuard risk table already
  requires this before the first paid hazmat customer; routing a 70-foot combination is a larger
  exposure, not a smaller one.
- **Terms:** advisory, not determinative. Never "guaranteed legal." Always "obey signs, law
  enforcement, facility instructions and current conditions."
- **The evidence-tier system is our best legal artefact.** Stating precisely how good our evidence is
  per restriction — and labelling our own conflation as our work product — is a materially stronger
  posture than a green checkmark. Trimble's own docs disclaim currency; we disclaim with precision.
- **Dataset provenance and SME sign-off per version**, as `@hazmat/data` already does.
- **Legal-hold path** for preserved evidence bundles.
- **Regulatory direction:** H.R. 6531 (*Bridges Not Bumpers Act*, Dec 2025, ATA-endorsed) directs DOT
  to convene a working group on truck-specific information in GPS tools and to build a national
  bridge-strike clearinghouse. No vendor liability today — but a clear signal that this software is
  entering regulatory scope, and an opportunity: a vendor that already cites its sources is the one
  that thrives under a disclosure regime.

### 5.7 Everything from v1 that survives unchanged

The safety design in v1 was its strongest part and is carried forward verbatim: the verified
combination profile with per-field provenance and `verifiedAt`; deleting the silent weight cap;
locked stops surviving traffic optimization; the single guidance lease per driver/load; in-motion
distraction lockouts with motion state as one shared service; facility entrances with moderation
state; dual-source position fusion with disagreement as an event rather than an average; no consumer
nav labelled truck-safe; location collection bound to an active duty/load session; the immutable
event log; and the reproducibility requirement.

---

## 6. Packaging — one engine, five products

| Tier | Buyer | What | Pricing shape |
|---|---|---|---|
| **0 — Lookup** *(free, no login)* | Any driver | "Is this road legal for my height / my hazmat class?" Bridge and hazmat-route lookup with citations. | Free. SEO on the long tail — *low clearance bridges [route]*, *hazmat route [state]*, *can I take [class] through [tunnel]*. Same playbook as the free placard calculator, larger funnel. |
| **1 — Drive** | Owner-operator, small fleet | Driver-initiated truck-safe routing, guidance, offline, explanations with citations, fuel plan. | Per truck/month, self-serve, card. |
| **2 — Fleet** | Carrier with dispatch | Everything in Drive + route publication and versioning, locked stops, exceptions, ETA and milestones, audit, fuel reconciliation vs EFS. | Per power unit/month. |
| **3 — Hazmat Route Assurance** | Safety / compliance director | NHMRR + 49 CFR 397 validation, per-class facility prohibitions, permit tracking, route certificates. **Sells attached to HazmatGuard, to the same buyer.** | Per hazmat unit/month — matches HazmatGuard's per-hazmat-unit model. |
| **4 — Compliance API** | TMS, telematics and freight platforms | `POST /v1/route/validate` → verdicts + citations + evidence tiers. They keep the driver relationship; we are the compliance layer inside their product. | Per call, volume tiers. Highest margin, no cab war. |
| **5 — Route Assurance Certificate** | Shipper, broker, insurer | A signed, deterministic, reproducible artefact: this load moved on a route with this compliance grade, here is the evidence. | Per certificate or per shipper seat. |

Tiers 4 and 5 are only possible because the compliance layer is separable from the guidance app.
That separability is the argument for this architecture over v1's, independent of cost.

**Carve-out discipline, same as HazmatGuard S5:** `@nav/{compliance,restrictions,golden}` get their
own LICENSE, CHANGELOG, semver and a CI job that builds and golden-tests them in isolation. If that
job is green, the standalone product is provable on every commit rather than asserted.

---

## 7. Locked decisions

Carried from v1 where still correct, renumbered where changed. **Bold = new or changed in v2.**

| ID | Decision |
|---|---|
| **NAV-1** | **The compliance layer is the product; the routing engine is a swappable substrate. All routing goes through a `RoutingProvider` interface. Valhalla is primary; HERE is the oracle; Trimble remains implementable.** |
| **NAV-2** | **Primary routing is self-hosted Valhalla truck costing on tiles built from OSM PBF enriched with `@nav/restrictions`. Restriction data is never sourced from OSM tags; OSM supplies geometry and topology only.** |
| **NAV-3** | **Every applied restriction carries an evidence tier (T1–T5) and a citation. A route carries a compliance grade. T1–T3 block; T4 blocks with a named-attestation escape; T5 warns.** |
| **NAV-4** | **A permit — not an attestation — is the only thing that clears a T1/T2/T3 block.** |
| **NAV-5** | **Attested T4 exceptions are role-gated to a named safety manager, bound to one restriction ID and route version, expire ≤72 h, are audited, and automatically open a curation ticket.** |
| NAV-6 | No silent vehicle defaults in active guidance. Defaults may create a dispatcher draft marked `profile_incomplete`; a driver cannot start it until every safety-critical field is verified. |
| NAV-7 | The effective profile is the physical combination actually in service: tractor + trailer + load + hazardous goods + permits/policy, anchored to the accepted load's duty-session equipment. |
| NAV-8 | Stable route intent persists; live traffic, closures and ETA do not. Revalidate at activation. |
| NAV-9 | Mandatory load stops and dispatch-locked fuel stops survive optimization. A reroute may alter the corridor between locked stops, never delete or reorder them silently. |
| **NAV-10** | **Fuel, tolls, time and HOS are a weighted routing objective, not post-hoc stop insertion. Total landed cost selects among alternatives; the cheapest *legal* route wins, never the cheapest.** |
| **NAV-11** | **The 20% usable-capacity reserve — including detour, idle and reefer burn — is a stated product guarantee. `INFEASIBLE` is a loud state.** |
| **NAV-12** | **Dual-source validation: HERE Routing v8 as an independent oracle under the §4 sampling policy. Disagreements are surfaced with both opinions and our citation, never averaged or hidden.** |
| **NAV-13** | **Drivers may initiate routes. Identical validation, identical engine, `initiatedBy: driver`, visible to dispatch as an event.** |
| NAV-14 | Location collection begins at duty/load navigation start and ends at completion, under a disclosed carrier policy. No covert always-on tracking. |
| NAV-15 | Fuse device position and Samsara/ELD position. Device position drives guidance; telemetry corroborates asset identity. Disagreement produces a confidence event, never an averaged fictitious point. |
| NAV-16 | In motion, voice/glance-first. Text entry, messaging, capture, route editing and browsing locked; emergency contact and safety warnings always available. Motion state is one shared, tested service. |
| NAV-17 | No consumer car navigation is labelled truck-safe. On failure: preserve the last validated route, announce degraded mode, offer safe-stop and dispatch, continue only on available offline data. |
| **NAV-18** | **`@nav/compliance` is pure and deterministic — no `Date.now()`, no `Math.random()`, no I/O — CI-enforced. A verdict is reproducible from `(geometry, profile, restrictionsVersion, policyVersion)`.** |
| **NAV-19** | **`@nav/restrictions` is versioned with per-source provenance and SME sign-off, and every release re-runs `@nav/golden`.** |
| NAV-20 | Every active route is reproducible from its audit record: profile + provenance, stops, policies, engine and dataset versions, restrictions and dispositions, route version, publisher, acknowledgements. |
| NAV-21 | One device holds the active guidance lease per driver/load. Takeover is explicit, audited and visible to both driver and dispatch. |
| NAV-22 | Staged entitlement rollout with a remote kill switch independent of the ordinary UI flag. The kill switch stops new guidance without erasing active-trip evidence. |
| **NAV-23** | **Declared gaps are product features, not silent absences: posted clearances, posted axle-configuration weights, seasonal restrictions, toll rates, 53' access, Canadian TDG. Each is visible in the UI and stated in the API.** |
| **NAV-24** | **We never claim a route is guaranteed legal. We state, per restriction, exactly how good our evidence is.** |

---

## 8. Delivery phases

### NP0 — Prove the substrate *(3–4 weeks)*

- **0.0 Get Silvicom's Samsara quote line for Commercial Navigation, in writing.** Fixes the ceiling.
- **0.1 Measure OSM truck-attribute coverage** on our actual lane network: pull Geofabrik NA, count
  `maxheight` / `maxweight` / `hgv` / `hazmat` on highway ways against our real miles. **This number
  decides whether the open substrate is viable.** Publish it internally either way.
- 0.2 Stand up Valhalla with truck costing; build NA tiles (budget a large transient build box — NA
  builds have OOM'd 128 GB machines). Benchmark route latency and quality against our real lanes.
- 0.3 Prove restriction injection end-to-end on **one** case: take one NBI structure with a
  sub-13'6" clearance on a lane we actually run, conflate it into the PBF, rebuild tiles, and show
  the router avoiding it **and explaining why with a citation**.
- 0.4 Prove `linear_cost_factors` at scale — synthetic 50k-edge overlay, measure latency.
- 0.5 HERE Routing v8 oracle harness + the comparison/diff engine.

**Exit:** a truck route on our own infrastructure that avoids a real bridge for a cited reason, and
a measured statement of how far OSM alone would have got us. **Kill criterion:** if OSM geometry
quality on our lanes is materially worse than HERE's, we re-open the substrate decision here — not
after building on it.

### NP1 — `@nav/compliance` v1 *(6–8 weeks)*

- 1.1 The pure engine, evidence tiers, verdict contract, determinism linter.
- 1.2 **NBI ingest behind a schema adapter** (SNBI/NBTIS lands January 2026), conflation pipeline
  with rejection rather than guessing on the ~1% mislocated records.
- 1.3 **The tunnel/bridge authority table** — the highest-value artefact. Start with the ~40
  facilities on our actual lanes, expand to the national ~150.
- 1.4 NHMRR parsers, prioritised by our real lane footprint — top 15 states first, not all 50.
- 1.5 eCFR-sourced T1 rules: 23 CFR 658.17, Federal Bridge Formula, 49 CFR 397.101 Class 7 preferred
  routing.
- 1.6 `@nav/golden` seed corpus with expected safety *properties*, not brittle polylines.
- 1.7 Combination profile contract; **delete the weight cap** (carried from v1 — it is a live bug).

**Exit:** no route with an unresolved T1–T3 restriction can be produced, and every restriction on
every route names its source.

### NP2 — Route Intelligence, shipped *(4–6 weeks, parallel from NP1.5)*

The first thing a customer can use, with no safety-critical execution path.

- 2.1 Parked route review in the driver app: validated route, compliance grade, restriction
  explanations with citations, locked stops, **fuel plan with projected dollars saved**, verified
  truck entrance, offline readiness.
- 2.2 Dispatcher route review, publication, versioning, supersede.
- 2.3 Driver-initiated routes (§5.3).
- 2.4 **Handoff to whatever guidance the fleet already runs**, with our stop sequence pushed in,
  explicitly labelled as a third-party handoff — never as truck-safe by us.
- 2.5 Arrival / dwell / milestones from our events fused with Samsara telemetry.
- 2.6 Fuel reconciliation: planned vs actual against the EFS feed.
- **2.9 The driver desirability test (§5.5).**

**Exit:** dispatch and drivers using it daily; a real dollars-saved number; five drivers have told
us what would make them switch.

### NP3 — Tier 0 and Tier 4 *(3–4 weeks)*

- 3.1 The **free public lookup tool**. Cheapest lead generation we have and it proves the engine.
- 3.2 The **Compliance API** — `POST /v1/route/validate`, verdicts + citations + tiers. Rate-limited,
  keyed, metered.
- 3.3 Carve-out CI job for `@nav/*`.

**Exit:** the compliance layer is sellable without a driver app existing.

### ── GUIDANCE GATE ──

Proceed only if **all** are true:

- [ ] NP2 is in daily use and the dollars-saved number is real and reconciled.
- [ ] Drivers have said, specifically, that they would use our guidance.
- [ ] The measured OSM/substrate quality from NP0.1 supports active guidance on our lanes.
- [ ] The Samsara ceiling is known and our modelled cost sits comfortably under it.
- [ ] Dual-source disagreement rate is measured and trending down.
- [ ] E&O insurance is quoted and bindable.

### NP4 — Guidance vertical slice *(8–12 weeks)*

- 4.0 **Ferrostar RN spike, two weeks, with the native-screen fallback defined up front** (§2.3).
- 4.1 Vendor the Ferrostar RN monorepo; UniFFI bindings; guidance screen on MapLibre RN 11.x.
- 4.2 Voice: wire `expo-speech` to spoken instructions; contribute the observer upstream.
- 4.3 Lifecycle, permissions, screen wake, session restore across process death.
- 4.4 Motion service and in-motion locks.
- 4.5 Production hosting decision for the substrate and control plane (Railway is dev/test only).

**Exit:** a guided route completes on both platforms with process-restart recovery.

### NP5 — Offline and reliability *(6–8 weeks)*

- PMTiles corridor/state packages written to `filesDir` (bundled assets cannot serve byte ranges);
  `valhalla-mobile` behind Ferrostar's `CustomRouteProvider`; download, resume, update and storage
  UX; battery, thermal, memory and network-flap qualification.

**Exit:** the offline golden-route suite and the all-day device test pass.

### NP6 — Security, operations, field rollout *(6–8 weeks)*

MASVS assessment and mobile pen test · credential rotation drill · SLO dashboards and on-call ·
degraded-mode and kill-switch drills · retention and sharing policy · simulation → shadow →
guided → fleet pilot.

### NP7 — GA and packaging

Tiers 1, 2, 3 and 5 · independent safety review of the golden-route diff and field evidence ·
`nav.preview.released: true` · remove all sample data from production paths.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **OSM geometry/topology quality on our lanes is worse than commercial data.** The single largest technical risk, and currently unmeasured — taginfo blocks automated queries. | **High** | NP0.1 measures it before we commit. Kill criterion at NP0. Restrictions never come from OSM. Dual-source oracle catches systematic gaps. `prop2osm` + a licensed attribute layer is the paid fallback if the measurement is bad. |
| Conflation (T4) errors route a truck wrongly | High | T4 is labelled and blocks by default; dual-source oracle; attestation opens a curation ticket; golden corpus; rejection over guessing on bad geolocation. |
| Curation is ongoing COGS, not a project | Medium | Budget it as COGS from day one, as `@hazmat/data` already is. Scope by our real lane footprint, not nationally, in v1. |
| Ferrostar RN is pre-alpha and unpublished | Medium | Two-week spike with a defined native-screen fallback. BSD licence means we can fork and fix — the opposite of a closed-SDK dependency. |
| SNBI / NBTIS schema break, January 2026 | Medium | Schema adapter from the first commit. |
| NA Valhalla tile builds OOM large machines | Medium | Transient large build box; `valhalla_build_extract --region` for per-region packages; ship tarballs to small serving nodes. |
| Samsara/Motive add citations | Low–Medium | They would have to build the curation, and their incentive is to disclaim rather than assert. Our dataset and golden suite compound; the first mover in citation owns the category vocabulary. |
| Liability from a routing error | High | Evidence tiers, never claiming guaranteed legality, E&O bound before pilot, determinism for reproducibility, preserved evidence bundles, legal-hold path. |
| This displaces HazmatGuard GTM | Medium | It does not — Tier 3 *is* HazmatGuard's expansion revenue to the same buyer, and the free lookup tool feeds both funnels. Sequence NP0–NP3 alongside HazmatGuard, gate NP4+ on revenue. |
| Solo engineering capacity | **High** | NP0–NP3 is ~4 months and is mostly server and data work, where our velocity is proven. NP4–NP7 is 6–9 months of device work that is not AI-accelerable — which is exactly why it sits behind a gate. |

---

## 10. Effort

| Phase | Estimate | Nature |
|---|---|---|
| NP0 | 3–4 weeks | Infra + measurement |
| NP1 | 6–8 weeks | Data engineering + curation |
| NP2 | 4–6 weeks (partly parallel) | Server + app, no safety-critical path |
| NP3 | 3–4 weeks | API + web |
| **To a sellable compliance product** | **~4 months** | **Mostly server/data — our strong suit** |
| NP4–NP7 | 6–9 months | Native, offline, device matrix, field pilots — **not AI-accelerable** |

---

## 11. Open questions

1. **The Samsara Commercial Navigation line on Silvicom's quote.** Everything in §2.4 is bounded by
   a number only they have. Ask this week.
2. **Curation capacity.** The tunnel/authority table and the NHMRR parsers are the moat and they are
   human work. Is that Miki, a contractor, or an SME on retainer? The answer changes NP1's length
   more than any engineering decision in this document.
3. **Canada.** Silvicom runs ~0.1% Canadian miles. v1 scope is US-only with TDG declared as a gap —
   confirm that is acceptable.
4. **Platform name.** `@nav/*` is a placeholder. The rename in `PLATFORM-STRATEGY` §S2 should land
   before NP1 creates a dozen new packages, exactly as that document argued.
5. **E&O carrier and timing.** Needs to be quoted before NP2 ships to anyone outside Silvicom.

---

## 12. Sources

**Competitive**
[Samsara Commercial Navigation](https://www.samsara.com/products/telematics/commercial-navigation) ·
[Samsara launch, 12 Nov 2025](https://www.businesswire.com/news/home/20251112311160/en/Samsara-Launches-Leading-Commercial-Navigation-Solution-to-Boost-Safety-and-Compliance-for-U.S.-Trucking-Fleets) ·
[Samsara Fleet Application Suite](https://www.samsara.com/pages/fleet-application-suite) ·
[Sourcewell Samsara 020221-SAM pricing sheet](https://files.sourcewell.org/public/Shared%20Documents/Solicitations/10351/00003137/Additional%20Documents/Samsara%20020221-SAM%20Pricing%20Sheet.pdf) ·
[Motive Truck-Safe Navigation, 27 May 2026](https://gomotive.com/blog/commercial-navigation-motive-driver-app/) ·
[Trimble hazmat routing](https://developer.trimblemaps.com/restful-apis/appendix/hazmat-routing/) ·
[Trimble CoPilot licensing](https://developer.trimblemaps.com/copilot-navigation/feature-guide/operating-features/copilot-licensing/)

**Pricing**
[HERE commercial terms — Asset & MAU plans](https://www.here.com/get-started/pricing/commercial-terms) ·
[HERE 2026 pricing changes](https://placematic.com/here-technologies-api-pricing/) ·
[Mapbox pricing](https://www.mapbox.com/pricing) ·
[Stadia Maps pricing](https://stadiamaps.com/pricing/) ·
[Hetzner AX matrix](https://www.hetzner.com/dedicated-rootserver/matrix-ax/)

**Substrate**
[Valhalla truck costing source](https://github.com/valhalla/valhalla/blob/master/src/sif/truckcost.cc) ·
[Valhalla route API reference](https://github.com/valhalla/valhalla/blob/master/docs/docs/api/route/api-reference.md) ·
[taginfo.json — tags Valhalla reads](https://github.com/valhalla/valhalla/blob/master/taginfo.json) ·
[PR #5584 linear_cost_factors](https://github.com/valhalla/valhalla/pull/5584) ·
[PR #5942 ignore_access_restrictions](https://github.com/valhalla/valhalla/pull/5942) ·
[Discussion #4772 — no restriction warnings](https://github.com/valhalla/valhalla/discussions/4772) ·
[Valhalla map matching](https://valhalla.github.io/valhalla/api/map-matching/) ·
[Ferrostar](https://github.com/stadiamaps/ferrostar) ·
[Ferrostar RN wrapper issue #116](https://github.com/stadiamaps/ferrostar/issues/116) ·
[Ferrostar route providers](https://stadiamaps.github.io/ferrostar/route-providers.html) ·
[valhalla-mobile](https://github.com/Rallista/valhalla-mobile) ·
[MapLibre RN](https://github.com/maplibre/maplibre-react-native) ·
[MapLibre Android PMTiles](https://maplibre.org/maplibre-native/android/examples/data/PMTiles/) ·
[prop2osm](https://github.com/gis-ops/prop2osm-public)

**Compliance data**
[FMCSA NHMRR](https://www.fmcsa.dot.gov/regulations/hazardous-materials/national-hazardous-materials-route-registry) ·
[NHMRR by state](https://www.fmcsa.dot.gov/regulations/hazardous-materials/national-hazardous-materials-route-registry-state) ·
[Federal Register NHMRR update, 8 Dec 2025](https://www.federalregister.gov/documents/2025/12/08/2025-22192/national-hazardous-materials-route-registry) ·
[49 CFR 397 subpart C](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-397/subpart-C) ·
[49 CFR 397 subpart D](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-397/subpart-D) ·
[FHWA NBI downloads](https://www.fhwa.dot.gov/bridge/nbi/ascii.cfm) ·
[NTAD NBI feature service](https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/NTAD_National_Bridge_Inventory/FeatureServer/0) ·
[FHWA SNBI transition](https://www.fhwa.dot.gov/bridge/snbi.cfm) ·
[NBIS final rule 2022](https://www.federalregister.gov/documents/2022/05/06/2022-09512/national-bridge-inspection-standards) ·
[National Tunnel Inventory](https://www.fhwa.dot.gov/bridge/inspection/tunnel/inventory/download.cfm) ·
[23 CFR 658](https://www.ecfr.gov/current/title-23/chapter-I/subchapter-G/part-658) ·
[23 CFR 658.17](https://www.ecfr.gov/current/title-23/chapter-I/subchapter-G/part-658/section-658.17) ·
[FHWA bridge formula](https://ops.fhwa.dot.gov/FREIGHT/publications/brdg_frm_wghts/index.htm) ·
[MDTA tunnel restrictions](https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits) ·
[PANYNJ traffic rules](https://www.panynj.gov/content/dam/bridges-tunnels/traffic-rules-and-regulations/TBT%20Traffic%20Rules%20%20Regulations.pdf) ·
[21 NYCRR 1025](https://www.law.cornell.edu/regulations/new-york/title-21/chapter-XXI/subchapter-B/part-1025) ·
[BTS NTAD](https://www.bts.gov/ntad)

**Legal**
[Bridges Not Bumpers Act, H.R. 6531](https://latimer.house.gov/media/press-releases/reps-latimer-bresnahan-introduce-legislation-prevent-bridge-strikes-large) ·
[OWASP MASVS](https://mas.owasp.org/MASVS/) ·
[FMCSA mobile phone restrictions](https://www.fmcsa.dot.gov/driver-safety/distracted-driving/mobile-phone-restrictions-fact-sheet)
