# Platform Strategy & HazmatGuard Go-To-Market

**Date:** 2026-08-03 · **Companion to:** `MODULARITY-AUDIT-2026-08-03.md` (the evidence), `MASTER-DATA-PLAN.md` (the build)

---

## Part 0 — The decision, restated

The instinct is right: **four products, different buyers, sold separately.** The instinct that follows — *therefore four codebases* — is the expensive version of the same idea.

The audit settles the empirical question. Turning HazmatGuard off breaks **zero** non-hazmat surfaces. The modularity is real and CI-enforced. What's missing is ~2 days of finishing work on a gate that was 60% built, not a new architecture.

So the recommendation is:

> **One platform. Four products. One codebase. N deployables. Per-tenant entitlements.**
>
> TMS is not a fifth product — **TMS is the platform with every module switched on.**

That last line matters commercially: it means the "master product" is a *packaging decision*, not an integration project. If the four are separate codebases, the master is the hardest thing you ever build, and you pay for it last, when the four have diverged.

Everything below is the concrete plan for getting there, then the business model for the product that goes first.

---

# Part 1 — Solutions

## S1. Extract the platform, not the products

**Problem:** HazmatGuard doesn't depend on FuelGuard — it depends on *the platform*. `0092_hazmat_core.sql` has foreign keys to exactly `organizations`, `auth.users`, `drivers`, `vehicles`, `trailers`. The hazmat router imports six things from outside its domain: auth middleware, `requireModule`, http helpers, `supabaseAdmin`, `appLocals`, `writeAudit`. That's the spine, not fuel.

**Solution:** name the spine and make it a first-class package. Nothing moves physically at first — this is mostly renaming and a boundary rule.

```
packages/
  platform/          ← auth, orgs, roles+RLS vocabulary, entitlements,
                       master data contracts, audit, queue, notifications
  hazmat-engine/     ← already dependency-free  ✅
  hazmat-data/       ← already dependency-free  ✅
  hazmat-placards/   ✅
  hazmat-golden/     ✅
  fuel/              ← extract from packages/shared: anomaly, idle*, recon*,
                       detection*, efsImport, smartFueling, odometer…
  dispatch/          ← loadsContract, loadsLifecycle, dispatchContract, tms
apps/
  api/               ← thin composition root: mounts module routers
  web/ driver/ admin/ admin-api/
```

**Why this and not a split:** the boundary you want already exists and is enforced (`scripts/check-feature-boundaries.mjs` fails the build if `@hazmat/*` imports `@fuelguard/*`). Extend the same fitness function to assert **`platform` may not import any product package** — that's the rule that keeps the spine reusable. One CI check buys you what a repo split claims to buy.

**Sequencing:** do this *after* M3, *before* M5. Right now `packages/shared` is 23k LOC of everything; splitting it while you're mid-master-data would be churn on top of churn.

## S2. Rename the umbrella — and do it now

**Problem:** you diagnosed this yourself. "FuelGuard" as the parent of HazmatGuard is a naming error that will leak into every contract, every repo URL, every `@fuelguard/*` import, and every conversation with a hazmat buyer who does not care about fuel.

**Solution:** a neutral platform name; products keep theirs.

```
<Platform>          the company / the TMS
  ├── FuelGuard     fuel theft detection + fuel planning
  ├── HazmatGuard   hazmat clearance
  ├── Dispatch      loads, drivers, stops
  └── Navigation    commercial routing
```

**Cost, concretely:** `@fuelguard/*` appears across ~12 workspace packages. It's a scoped-package rename — a codemod plus `pnpm-workspace.yaml`, `package.json` names, and import specifiers. Half a day mechanical, plus a docs pass.

**Why now:** this cost is monotonically increasing. Every file M3–M6 adds makes it larger, and it never gets easier. Do it before M3.

**Naming guidance:** avoid a name containing any product noun (`fuel`, `hazmat`, `dispatch`). Avoid one that boxes you into trucking if TMS is the ambition. Prefer something short enough to be a package scope and available as a `.com`.

## S3. Schema blast radius → Postgres schema-per-module

**Problem (yours, and it's fair):** 70 tables in one flat `public`. A hazmat-only customer's data sits in a schema full of fuel tables. That is awkward in a security review and worse in a due-diligence data room.

**Solution:** Postgres schemas as the module boundary *inside* one database.

```sql
create schema if not exists hazmat;
alter table hazmat_loads set schema hazmat;   -- ×6 tables
```

Benefits, all real:

- **`pg_dump --schema=hazmat`** produces a clean, complete, demonstrable carve-out artifact. That single command is what a due-diligence question deserves as its answer.
- **Per-schema grants** — a narrower blast radius than table-level grants, and easier to audit.
- **A genuine seam** for physical separation later: moving a schema to its own database is an operation, not a rewrite.
- The RLS gate from `0103` moves with the tables unchanged.

**Cost, honestly:** Supabase's PostgREST exposes `public` by default; extra schemas need `db-schemas` config, and the web app's direct-PostgREST reads (`useModules.ts:18`, `useHazmatProfiles.ts:43`) would need their schema set. Non-trivial but bounded.

**Recommendation:** don't migrate 70 tables. **Set the convention now** — every new module lands in its own schema — and move hazmat's 6 as the proof-of-pattern during H12 productization. Legacy fuel tables can stay in `public` forever; there's no prize for moving them.

## S4. Release cadence → separate deployables, one codebase

**Problem:** a fuel bug shouldn't be able to take down a DOT compliance product.

**Solution:** you already do this. `railway.json` deploys api+web; `railway.admin.json` deploys admin-api+admin with its own `watchPatterns`. `apps/api/src/worker.ts` is a separate process with per-kind concurrency caps (`hazmat_extract: 2, hazmat_analyze: 4` — bounding Anthropic vision spend).

Add one more: a **hazmat worker deployable** — same image, different entrypoint, `QUEUE_KINDS=hazmat_*`. Now the long-running, expensive, externally-dependent workload has its own process, its own scaling, its own crash boundary, its own alerting.

This is exactly how large modular monoliths run in practice: **one codebase, many deployables.** You get blast-radius isolation at the process level, which is where it actually matters, without paying for it at the source level, where it costs the most.

Combined with `org_modules`, you also have a **per-tenant kill switch** — something four separate codebases would not give you.

## S5. Acquisition optionality → make the carve-out a build artifact

**Problem:** "a clean standalone HazmatGuard is an easier asset to sell." True.

**Solution:** don't *perform* the carve-out — make it **continuously provable**.

The four hazmat packages already have their own `package.json`, own semver (`@hazmat/engine` is at `0.7.0`), own descriptions asserting independence, and a linter enforcing it. Finish the job:

1. **Own `LICENSE` + `CHANGELOG`** per hazmat package — IP provenance is the first diligence question.
2. **A `carve-out` CI job**: build `@hazmat/{engine,data,placards,golden}` + the hazmat route module + `pg_dump --schema=hazmat` in isolation, then run the golden suite against the result. **If that job is green, the carve-out is proven — on every commit.**
3. **Per-module revenue line items** in every contract from the first one. An acquirer buys attributable ARR; a blended invoice is worth less than the same revenue itemised.
4. **Dataset provenance** — `@hazmat/data` is versioned (`2026.07.1`). Keep the CFR sourcing and SME sign-off documented per version. That dataset plus the golden suite *is* the defensible asset.

This gives you optionality without paying the split cost up front — and it's strictly stronger, because "here's a green CI job that builds it standalone" beats "we think we could separate it."

## S6. Multi-tenancy rigor → convert care into CI

**Problem:** this repo carries one company's custom shape; a product needs stricter tenancy guarantees.

**Solution:** you have the bones — `org_id` on 60 of 70 tables, RLS throughout, JWT claims via `custom_access_token_hook`, entitlements, a control plane with impersonation and platform audit. The gap is that all of it is upheld by discipline rather than by a check.

Add `tenantIsolation.test.ts`, in exactly the style of `routeAuth.test.ts`:

```
For every table in `public`:
  1. it has an `org_id` column, AND
  2. `pg_class.relrowsecurity` is true, AND
  3. at least one policy references auth_org_id()
  — unless it is on the GLOBAL allowlist, each entry carrying a written reason.
```

The current legitimate allowlist is exactly 10 tables: `fuel_stations`, `fuel_prices_posted`, `geocode_cache`, `route_geometries`, `weather_cache` (shared reference/cache), `organizations`, `notification_reads`, `migration_markers`, `platform_admins`, `platform_audit_log` (platform-scoped).

Ten known exceptions, each with a reason, enforced on every commit. That's what turns "we're careful about tenancy" into something you can show a security reviewer — and it's the single highest-leverage item in this document, because it protects all four products at once.

Pair it with the three fixes the audit found: the RLS module gate (`0103`, done), the `org_modules` write path, and the entitlement fitness test.

## S7. Summary — what actually gets built

| Your concern | Split-repo answer | Recommended answer | Cost |
|---|---|---|---|
| Sell separately | 4 codebases | `org_modules` (already built) + entitlement write path | ~½ day |
| Schema blast radius | 4 databases | Postgres schema-per-module; convention now, hazmat at H12 | ~1 day |
| Release cadence | 4 pipelines | 4th deployable (hazmat worker), same image | ~½ day |
| Acquisition optionality | pre-split | `carve-out` CI job + per-module LICENSE + itemised ARR | ~1 day |
| Naming | new repo | scoped-package rename, before M3 | ~½ day + docs |
| Tenancy rigor | fresh start | `tenantIsolation.test.ts` + 3 audit fixes | ~2 days |
| **Total** | **~15–20k LOC rebuilt ×4** | | **~6 days** |

---

# Part 2 — HazmatGuard business model

## 2.1 The market gap is the product you already built

This is the strongest finding in the research, and it comes from a **competitor's own comparison page**. FileFlo's 2026 hazmat-software roundup ranks seven platforms and names three gaps across the entire category:

1. **No integrated placard calculation or selection** — "platforms assume users bring classification data from elsewhere"
2. **No automated shipping-paper validation or BOL checking**
3. **Weak specialty-fleet coverage**

FileFlo says of itself, in its own marketing: *"Not a shipping-paper generator"* and *"Not a placard-selection tool — uses your existing classification source."*

Now the build status in `18-HAZMATGUARD-PLAN.md`:

| Category gap | HazmatGuard |
|---|---|
| Placard calculation/selection | `computePlacards` + Table 1 fail-closed gate — **H2 done** |
| Segregation checking | `checkSegregation` — **H2 done** |
| Shipping-paper / BOL validation | `validateBol` + 7 tests — **H3 code done** |
| Automated BOL checking from a photo | dual-pass vision → `BolFields` → cross-validation → verdict — **H6 code-complete** |
| Attestation / audit trail | fail-closed review queue + override/reject — **H7 in progress** |

**The category is document cabinets. You built a decision engine.** The thesis in that same article — *"hazmat carriers must assemble a stack of tools (TMS + shipping-paper generator + compliance platform) rather than buy one integrated solution"* — is the market description of your wedge.

Do not price or position against document management. You are not competing with them; you are the missing piece they tell customers to go find elsewhere.

## 2.2 Market size

- **46,969** carriers registered for interstate hazardous-materials operation (FMCSA data).
- Concentration is high where you'd want it: **54.7% of chemical carriers** and **51.5% of tanker carriers** hold hazmat endorsements, versus low single digits in general freight.
- Hazmat is *"a regulatory overlay, not a cargo type"* — carriers add it to existing operations. **That is why it should be priced as an add-on per hazmat unit, not as a platform replacement.**

## 2.3 The value anchor: what a violation costs

For 2026 (frozen at 2025 levels — the October 2025 appropriations lapse stopped BLS publishing the CPI-U figure agencies needed, so OMB directed them to hold; first freeze since 2016):

| Violation | Maximum |
|---|---|
| Standard hazmat violation | **$102,348 per day, per violation** |
| Resulting in death, serious injury, or property damage | **$238,809 per day, per violation** |
| Failure to provide hazmat training | $102,348 max, **$617 minimum** |

Note *per day, per violation*. A mis-placarded trailer running a five-day lane is not one violation.

**This is the anchor for every pricing conversation.** The competition prices against a filing cabinet; you price against a six-figure daily exposure. A $9k/year subscription is **8.8% of a single day** of one standard violation.

## 2.4 Competitive pricing landscape

| Product | Price | What it is |
|---|---|---|
| Compliance Coach Hazmat | $59–$129/mo | Training/reference |
| HazmatU | $35–$89 per employee/yr | Training |
| Foley HM Compliance | $1,200–$4,800/yr | Registration + document tracking |
| FileFlo | flat tiers by fleet size | AI document classification, expiry tracking, audit packets |
| J.J. Keller Hazmat Encompass | per-user / custom (Encompass $500–$2,000+/mo) | The one incumbent combining shipping papers + documents |
| ChemAlliance | custom enterprise | Chemical-sector compliance |
| *Telematics, for budget context* | Samsara $27–33/vehicle/mo; Motive $25–50; Verizon $20–33 | ELD/GPS |

Two readings:

1. **The category is underpriced** because it sells storage. $59–$400/mo for something that files paperwork.
2. **J.J. Keller proves the ceiling.** $500–$2,000+/mo is payable in this market when the product makes decisions instead of holding files.

Your telematics comparison matters too: a fleet already pays ~$30/truck/month for Samsara. **Price below that line per hazmat unit** and you are never competing for the same budget line — you're a rounding error next to an expense they already approved.

## 2.5 Recommended pricing: hybrid platform + metered verdicts

Hybrid (base fee + usage) is now the dominant SaaS structure — ~43% of companies today, projected 61% by end of 2026 — because it pairs predictability for the buyer with expansion for you. It also matches your cost curve: the vision pipeline has real per-verdict COGS.

**Charge per *hazmat-authorized power unit*, not per truck.** A 100-truck carrier with 30 hazmat units pays for 30. This is the single most important design choice — it makes the buying decision small, honest, and expandable, and it maps precisely to the risk being insured against.

### The four tiers

**Tier 0 — Placard Calculator · Free, no login**

Ship the placard calculator as a **public web tool**. `POST /api/hazmat/calc` already carries no role gate (deliberately, per the H12 note in the code), so this is mostly a matter of an unauthenticated rate-limited route and a landing page.

*Why:* every hazmat compliance officer searches "placard requirements for X" many times a month. A calculator that answers correctly **with a CFR citation** earns the bookmark, the SEO position, and the inbound lead. This is the Website-Grader / Stripe-tools playbook, and this category has no equivalent. It is also the cheapest possible proof that your engine is right.

**Tier 1 — Clear · $22 per hazmat unit/mo · $199/mo minimum**

Load workspace, placard + segregation verdicts, shipping-paper validation, CFR citations on every finding, cargo-tank profiles. Self-serve, card, no sales call.

*A 15-hazmat-unit carrier: $330/mo → $3,960/yr.* Lands mid-range against Foley while delivering a category the incumbents explicitly don't have.

**Tier 2 — Attest · $22/unit + $2.00 per BOL verdict · $749/mo minimum, 150 verdicts included**

Everything in Clear, plus: photo → BOL extraction, cross-validation against declared lines, the review queue, attestation with named human sign-off, override/reject with reason, notifications, and **one-click audit packet export**.

*That 15-unit carrier at 250 loads/mo: $330 + (100 overage × $2) = $530/mo → $6,360/yr.*

*Why metered here:* dual-pass vision has genuine variable cost, and per-verdict pricing is the outcome metric a safety director understands — "$2 to clear a load" against "$102,348 a day if we're wrong." Current best practice is explicit: price AI on work done, not access, and don't bury variable compute in a flat fee.

**Tier 3 — Enterprise · from $2,500/mo**

Custom company policy layer (H8), SME-reviewed configurations, SSO, TMS/API integration, dataset version SLAs, contractual indemnity, named support. Sold, not self-serve.

### Why the minimums

Minimums are what make small hazmat fleets viable without underpricing the engine. A 4-unit carrier pays $199 for something that removes a six-figure exposure — that is a rational trade for them and a sustainable floor for you.

### Land and expand

Free calculator → **Clear** → **Attest** (usage naturally grows with load volume) → **module attach** (Dispatch, Navigation, FuelGuard) via `org_modules`. That last step is where the platform thesis pays: expansion revenue with zero new sales surface, because the entitlement already exists and the customer already has the login.

Target **120–130% NRR**. Per-unit growth + verdict growth + module attach are three independent expansion vectors on one contract.

## 2.6 Go-to-market

**Buyer:** Director of Safety / Compliance. **Not** the fuel or finance buyer FuelGuard sells to. Different budget, different conference, different pain — which is the real argument for selling it separately, and it's a *packaging* argument, not a codebase one.

**Purchase triggers** (compliance software is bought reactively — build the funnel around these moments):

1. A failed DOT audit or an incident. Highest urgency, shortest cycle.
2. A **shipper vendor questionnaire** the carrier can't answer.
3. Insurance renewal.
4. A new hazmat authority or an expanding lane.

**Three channels, in priority order:**

1. **Shipper-led.** Chemical shippers audit their carriers, and a shipper mandating HazmatGuard delivers dozens of carriers per conversation. This inverts the sales motion in your favour and is the highest-leverage channel in the space. It also has a natural product: a shipper-facing dashboard showing which of their carriers are clear.
2. **Insurance broker partnership.** Hazmat liability premiums are severe. A documented, auditable clearance system with attestation trails is a risk story an underwriter can price. Co-selling with brokers puts you in the renewal conversation, which is a recurring, dated, high-intent moment.
3. **Free calculator → self-serve.** SEO on the long tail of "does X need a placard," "can I load X with Y." Converts the practitioner, who then advocates internally.

**What you must not do:** sell HazmatGuard as "a module of FuelGuard." The safety director does not have a fuel problem. Sell HazmatGuard; mention the platform only after they've bought.

## 2.7 Moat

1. **A versioned regulatory dataset with citations** (`@hazmat/data`, `2026.07.1`). Compliance buyers need *"show me why"* — a verdict with a CFR cite survives an audit; a verdict without one is a liability.
2. **Determinism, enforced by a linter.** `@hazmat/engine` may not call `Date.now()`, `Math.random()`, or do I/O — CI fails if it does. A verdict is a pure function of its inputs, so it is **reproducible in a dispute two years later.** Very few compliance tools can say that, and it is worth saying out loud in sales.
3. **The SME-authored golden suite** (`@hazmat/golden`). Accumulated expert judgement, encoded and continuously re-verified. This is the slowest thing for a competitor to copy.
4. **Fail-closed by design** (the Table 1 gate). "We refuse to guess" is a feature to this buyer.

## 2.8 Risks

| Risk | Mitigation |
|---|---|
| **Liability — the big one.** If the engine clears a load that shouldn't have shipped, you're in the causal chain. | Fail-closed defaults (built). **Never auto-clear without a named human attestation** (H7, built — do not "improve" this away). Contract language: advisory, not determinative. E&O insurance before the first paid customer. SME sign-off recorded per dataset version. |
| Regulatory drift — the HMR changes | Dataset versioning exists; add a scheduled diff-and-re-verify against the golden suite. Budget it as ongoing COGS, not a project. |
| Category confusion — buyers search for document cabinets | The free calculator teaches the category. Lead with the gap the incumbents publish about themselves. |
| Long sales cycles / freight downturn | Self-serve tiers keep CAC low; shipper channel is counter-cyclical (compliance pressure rises when margins fall). |
| Design-partner capture — building only for customer #1 | Every requirement passes a test: "is this the HMR, or is this their process?" HMR → engine. Process → the H8 company-policy layer. |
| Vision extraction accuracy | H6 is code-complete but needs a real BOL photo corpus. **Do not sell Attest until measured on real documents.** Ship Clear first. |

## 2.9 Why HazmatGuard is the right first product

- **Highest willingness to pay** — the anchor is a $102,348/day penalty, not a productivity gain.
- **Clearest gap** — competitors publish that they don't do this.
- **Least platform-dependent** — the engine is already dependency-free and CI-proven.
- **Defensible** — regulatory data + SME judgement + determinism compound; a fuel-theft heuristic does not.
- **Different buyer from FuelGuard** — so it validates the multi-product thesis without cannibalising anything.

FuelGuard stays as-is and keeps its customer. HazmatGuard becomes the product you sell to the market. **Same codebase, same platform, different invoice.**

---

## Recommended sequence

| | Work | Why here |
|---|---|---|
| **Now** | Finish M2 identity (commit, migrate, enroll) | The driver app is blocked on it |
| **+2 days** | The 8 audit items — `org_modules` write path, router guard, notify suppression, entitlement fitness test | **HazmatGuard is not sellable until an entitlement can be granted** |
| **+1 day** | `tenantIsolation.test.ts` | Highest-leverage single check; protects all four products |
| **+½ day** | Platform rename | Cost only ever grows |
| **Then** | M3–M4 master data + web screens | Hazmat needs a real driver/tractor/trailer roster underneath it |
| **Then** | Free placard calculator, public | Cheapest lead-gen; the engine is already built |
| **Then** | H6 photo corpus + accuracy measurement | Gates the Attest tier |
| **Then** | `carve-out` CI job + hazmat schema move (H12) | Optionality, once the product is real |

**Two weeks of platform work stands between where you are and a sellable second product.** A repo split is somewhere north of two months before the first hazmat screen renders — and it starts by rebuilding the identity layer that shipped this morning.

---

## Sources

- [PHMSA 2026 civil penalty freeze and current maximums — Hazmat School](https://www.hazmatschool.com/blog/a-first-in-a-decade-why-phmsas-2026-civil-penalty-increases-were-canceled/)
- [Hazmat carrier counts and cargo-type concentration (FMCSA data) — HaulReport](https://haulreport.com/hub/hazmat/)
- [Best Hazmat + Specialty Carrier Compliance Software 2026 — FileFlo](https://www.getfileflo.com/blog/best-hazmat-specialty-carrier-compliance-software-2026)
- [DOT Compliance Software 2026 comparison and pricing — FileFlo](https://www.getfileflo.com/blog/best-dot-compliance-software-2026)
- [Fleet telematics pricing comparison 2026 — Spytec](https://spytec.com/blogs/news/fleet-tracking-pricing-comparison)
- [The Future of SaaS Pricing in 2026 (hybrid and outcome-based models)](https://medium.com/@aymane.bt/the-future-of-saas-pricing-in-2026-an-expert-guide-for-founders-and-leaders-a8d996892876)
- [PHMSA Final Rule: Revisions to Civil Penalty Amounts — J. J. Keller](https://www.jjkeller.com/news/article/PHMSA-Final-Rule-Revisions-to-Civil-Penalty-Amounts-2025_JJ131169-L-1735483799161)
