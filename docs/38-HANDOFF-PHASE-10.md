# Handoff — FuelGuard EFS card control, Phase 10

**Written 2026-08-17, at the close of Phase 9.** Phase 10 is *Override with amount* — the
`Product/Limit Override` half of the WEX portal's Override Card flow.

Read §1 before planning anything. It contains one vendor fact that decides Phase 10's shape and one
that could permanently damage a card if the phase ships without checking it first.

---

## 1. ⚠ Two things settled this session that change the plan as written

### 1.1 It is ONE `setCard`, not a sequence — guide p194 says so

The portal shows two screens (override → limit picker → amount → *Complete Override*), and the
banner *"Card …7560 has been overridden for 1 time(s)"* appears **before** any limit is chosen. That
looks like a two-phase write with a `partial` outcome to design for. **It is not.** Guide p194,
verbatim:

> *"Do a getCard … Then call setCard and echo back your data from the getCard response **except
> remove the limits** … overrideAllLocations set to True … override will be set from 1 to 9 … **Add
> back the limits array** with the products and limits that you want for the override."*

So **10.1 is one atomic echo write.** Phase 11.3's half-failure machinery is not needed. The portal's
two steps are its own UI convenience.

### 1.2 ⚠ The override REPLACES the card's normal limits — 10.4 is a test of the VENDOR

The same sentence — *"except remove the limits … add back the limits you want for the override"* —
means the card's ordinary product limits are gone for the duration. If EFS does not restore them
when the override is cleared, **a temporary exception has permanently altered the card.**

Step 10.4 already asks for this (*"clear the override and re-read — the card's original limits must
be restored"*). Treat it as a **precondition for shipping**, not a closing check: run it on a QA card
that HAS limits, before building the UI on the assumption that clearing is safe. Nothing in the guide
promises restoration; it is an empirical question about WEX's behaviour.

### 1.3 Decided, so it is not re-litigated

- **`Allow Hand Enter` does NOT go on the override screen**, despite the portal putting it there.
  Miki, 2026-08-17: it belongs in settings. Step 12.1's scoping stands.
- **Do not add a raw-string layer** for `M:1, X:1800`. `docs/37` §6b declines it: the wire carries
  named integers, and the letters are the portal's rendering.

---

## 2. Where things run — settled, stop re-deriving it

| | |
|---|---|
| API host | `@fleetguard/api` → `fleetguardapi-production.up.railway.app`. **The only host WEX allowlists** — nothing else can reach EFS, including a laptop |
| Web host | `@fleetguard/web` → `fleetguardweb-production.up.railway.app`. The SPA **plus a full copy of the API**, which is why it answers `/api/version` too |
| Database | Supabase. `migrate.yml` applies `supabase/migrations/**` on push to `main`, gated on CI green |
| Deploys | Railway, automatic on push to `main` — **but `railway.json` `watchPatterns` exclude `docs/**`, `*.md`, `.github/**`, tests and `apps/driver/**`.** A docs-only commit deploys nothing, and the deployed commit legitimately trails `main`. That is not drift |

⚠ **Deleting a Railway variable does NOT restart the service.** Setting one does. On 2026-08-17
`EFS_CARD_CONTROL_PROBE_ENABLED` was deleted and the running process kept it for five minutes —
config said off, `/prove` was still open. Standing rule 15 needs `railway redeploy` and a check that
the `deploymentId` changed.

⚠ **There is no local route to EFS.** No dev server, no `--api http://localhost`. The web dev server
does not currently start on Miki's Mac at all (`RangeError: WebAssembly.Memory.grow()` inside Vite's
dependency pre-bundler, unrelated to app code) — so **UI work in this repo is currently unverifiable
visually by anyone but Miki.** Say so when you ship UI; do not imply you have seen it.

---

## 3. Standing instructions from Miki — every one earned, none negotiable

1. **Push back.** *"in future push back on my ideas if you think they are not good."*
2. **Fix it now.** *"if we find something that needs fixing even if not blocking we should do that
   immediately, because if we dont do it we can forget."* (Standing rule 16.)
3. **Quality bar.** *"do quality control so we are 100% sure everything is correct and codes are type
   safe and enterprise grade."*
4. **You decide the HOW. He decides SCOPE**, and anything touching his WEX account or production
   secrets.
5. **PANs never enter the repo.** Masked last four only (••••7671). Rule 13. *(The WEX portal masks
   its own PANs too — `708305*********7560`.)*
6. **When he says run the commands and finish it, that includes merging.** CI green, then merge.
7. **A decision-log row attributed to "Claude (PM)" is a RECOMMENDATION**, not a decision, wherever
   it contradicts one of Miki's.
8. **Run the commands yourself.** Git, tests, gates, PRs, merges are yours. Only the vendor CLI is
   his — TTY and token.
9. **Verify the plan before implementing it.** *"don't trust it blindly before implementing any step
   verify our currant situation and counsel it."*

### 3.1 Added during Phase 9, in his words

10. **Mirror the vendor, do not rebuild it.** *"we are not building EFS SecureFuel, we are just
    adding options from our system to override… we dont need to display this data, we are mirroring
    features not recreating EFS Secure fuel."* **This corrected the same screen twice.** The mileage
    override first grew a drift comparison, then a look-up step; both were removed. Before adding any
    read to a write surface, ask whether the operator already knows the number they came to type.
11. **Check the previous handoffs.** *"so we don't miss some rules, patterns and practices we have
    used in implementation of previous 9 phases."* This document exists because of that instruction.

---

## 4. The method — it found five plan errors in Phase 7 and six more in Phase 9

**Read the plan, then verify every claim against the code and the checked-in WSDL BEFORE
implementing.** Phase 9's tally, all of which would otherwise have shipped as green code:

| Found by verifying, not assuming | Would have shipped as |
|---|---|
| 9.1 was HALF done — no endpoint carried `editableInfoIds` to the browser | API accepting 24 prompt ids while the drawer offered 2, silently |
| The same bug a second time, in `readOnlyPrompts` | a prompt the account permits rendering as read-only |
| 9.3's `value` is NOT the accrual — `minimum`/`maximum` are | a schema that refused production's own record (this DID ship, PR #82 fixed it) |
| 9.3's specified sentence asserts a direction the guide never describes | telling operators the pump rejects readings on a rule nobody verified |
| 9.7's blockers had BOTH been resolved a day earlier | a step deferred for reasons that no longer existed |
| `efsMileageOverride.ts` had no unit test at all | the landing verdict — the whole safety property — covered by nothing |

### 4.1 Verify a guard by BREAKING it

`node scripts/mutation-check.mjs --only=<prefix>`. **27 mutations, 27 caught.** Phase 9 added four,
and every new guard should add one. The harness refuses to run on a dirty tree — commit first.

> ⚠ A mutation whose pattern no longer matches is a **failure**, not a skip.

### 4.1b ⚠ `pnpm typecheck` does NOT validate a `.vue` import path — only the build does

`import ComboSelect from "@/components/ui/ComboSelect.vue"` typechecked clean and the file **does not
exist**. `*.vue` resolves through a module shim, so TypeScript accepts any path that ends in `.vue`.
The bundler is the only thing that catches it, and it fails late with `UNLOADABLE_DEPENDENCY` rather
than a type error.

This bit on 2026-08-17 and the commit was already made when the build failed, because the command
chained with `;` rather than `&&`. **Run the web build before committing UI**, and chain gates with
`&&`:

```bash
VITE_SUPABASE_URL="https://example.supabase.co" VITE_SUPABASE_ANON_KEY="ci-test-anon-key" \
  pnpm --filter web build && git commit …
```

The component was `AppCombobox` in `@fuelguard/ui`, aliased as `ComboSelect` at every existing call
site. **`DESIGN-SYSTEM-CONTRACT.md` names a `components/ui/ComboSelect.vue` that does not exist** —
its own header warns it is partly stale, and this is one of those places. Grep an existing call site
before trusting it.

### 4.2 A test that passes against both the bug and the fix is worthless

Phase 9's example: the Edit form can no longer flag a removal, so a test hands it a draft carrying
`remove: true` anyway and asserts it *still* refuses to claim the DRID opt-in. **That assertion is
what makes the split real rather than cosmetic.** Assertions of absence need positive controls beside
them — see `cardControlModel.test.ts`'s odometer block, where four forbidden phrases sit next to four
positive ones.

### 4.3 Say what you expect BEFORE the command runs

That is what made the live runs evidence rather than formality. The `getLastMileage` prediction
("258536 would prove the path end to end against ground truth") held exactly.

---

## 5. What Phase 10 inherits — state, not history

**Phases 0–9 are complete.** Phase 9 is code-complete as of 2026-08-17; `prompts_set` is **proven and
promoted** on QA (proof `14723221-b664-4a22-8197-99ed9b930c68`, `docs/22` H6).

Live-verified this session, against the real account:

- `doesCardPosition` → **QA `false`.** QA does not have SecureFuel and its policies carry no prompts
  at all. **`docs/37` §6c: QA cannot prove the odometer feature.**
- `getLastMileage` unit 688 → **258536**, matching a WEX portal screenshot exactly. First fact in
  this integration checked against something a human watched the vendor display.
- Config scan QA → `nested:header`, 4 match / 0 mismatch / 3 unobserved.

### 5.1 Open findings carried in

| # | Finding | Where |
|---|---|---|
| 9.8 | `emittableValues` declares less than the capability emits — the 9.7 proof sent `NAME`, which is not in the declared set; `validationType` declares 2 of 7 | `docs/28` Step 9.8 |
| — | 9.6's two live add-prompt checks never run | needs Miki + QA card |
| — | 9.4's `POLICY`-source refusal cannot be proven live — **no card on either org is POLICY-sourced** | proven offline only |
| — | `card_unlock` STILL unproven after three voids, outstanding since Phase 8.2 | `docs/28` 8.2 |
| — | §7 Q1/Q2/Q2b/Q2d/Q3/Q4 need WEX; Q2c answered (not this web service). **Q5 added and largely self-answered 2026-08-17** from WEX's portal guides — downgraded to confirming. **⚠ Q6 is the new one and it is a `card_lock` safety question**: all three eManager guides say *"when a card is in override no changes can be made to the card"*, absent from the SOAP guide, and NO capability checks `overrideUses` today | `docs/37` §7, §8 |
| — | ⚠ **Check `docs/37` §8 before opening a WEX ticket.** Three official eManager guides answered two questions this workstream had written down as *"only WEX can answer"*. They do NOT extract through `WebFetch` (it reports corrupted binary) — download and run `pdftotext` | `docs/37` §8 |
| — | Five gates exist that no workflow runs — **and one of them, `mutation-check`, had gone STALE unnoticed**: `efs-mileage-unit-ownership-dropped` stopped matching when commit `ceabbf5` reworded the 404, so it had been asserting nothing. Re-anchored 2026-08-17 on the `!vehicle` refusal alone. **A stale mutation reads as a pass** — worth checking the harness reports `29/29`, not just "no failures" | `scripts/mutation-check.mjs` |
| — | Five gates exist that **no workflow runs**: `lint:comment-claims`, `lint:rls`, `lint:codegen`, `lint:wsdl`, `format:check` | run them by hand |
| — | `format:check` has drifted to ~1295 files; prettier is effectively not the house style | do not "fix" it casually |
| — | 33 remote branches whose tips are not in `main`, incl. `fix/accrual-follows-the-account` (content IS merged) | housekeeping, Miki's call |

---

## 6. Gates — green CI is necessary, not sufficient

```bash
# Session start
pnpm install --frozen-lockfile
git log --oneline -8

# Everything CI runs, plus the five it does not
pnpm lint && pnpm typecheck && pnpm test
pnpm lint:filesize && pnpm lint:funcsize && pnpm lint:tests
pnpm lint:boundaries && pnpm lint:ui-adoption && pnpm lint:tokens-parity
pnpm --filter @fuelguard/web lint:tokens
pnpm lint:comment-claims && pnpm lint:wsdl && pnpm lint:codegen   # NOT in ci.yml
node scripts/mutation-check.mjs                                    # commit first — refuses a dirty tree

# The web build needs placeholder env locally
VITE_SUPABASE_URL="https://example.supabase.co" VITE_SUPABASE_ANON_KEY="ci-test-anon-key" \
  pnpm --filter web build

# LIVE — Miki's Mac only, always with --expect-org
node scripts/efs.mjs inventory --expect-org qa --out docs/efs/account-inventory-qa.json
node scripts/efs.mjs mileage --unit 688 --expect-org production
pnpm efs:prove <capability>          # needs EFS_CARD_CONTROL_PROBE_ENABLED, then UNSET + redeploy
```

⚠ **Use `--out`, never `> file`.** The shell truncates a redirect target before this process starts,
so `--expect-org` cannot protect it. That emptied the 220 KB production inventory on 2026-08-17 during
a run the guard correctly REFUSED. Only git had the contents.

⚠ **CI takes ~4½ minutes.** One `build` check. Do not schedule a 25-minute wait for it.

---

## 7. Phase 10's own shape, as currently understood

| Step | What the plan says | What this session changed |
|---|---|---|
| 10.1 | `grantOverrideSchema` gains `limits[]`; `replaceAll` edit; require `scope.kind === "all"` + step-up | ✅ shape CONFIRMED by p194 — one atomic write. Assert the exact bytes for the guide's own `ULSD 1000` example, **in sequence position** |
| 10.2 | Fix override residue — "Remove exception" renders only when `overrideUses > 0` | unchanged |
| 10.3 | UI: product select, amount with the unit spelled out, confirmation names product/amount/unit/window | ✅ portal confirms: `DSL` shows **GAL**, and "Save and Add Another" means multiple limits per override |
| 10.4 | Prove on QA using the reserved empty-`<limits>` card | ⚠ **promote this — run the restore check FIRST**, see §1.2. And see §7.1: that card is single-use |
| 10.5 | Promote | unchanged |

### 7.1 ⚠ The reserved QA card is a ONE-SHOT resource, and Phase 9 still has a claim on one

`docs/24` §3.3: *"Empty-collection cards are consumed by first use. After S3's first add, that card
has `infos` and the empty case is unreprovable on it forever."*

Two consequences worth planning around rather than discovering:

1. **10.4's proof CONSUMES the empty-`<limits>` card.** Once an override with limits lands on it, the
   "card with no pre-existing limits" case — which 10.1's Verify explicitly names, *"on a card with
   no existing limits places limits before locationGroups"* — cannot be re-proven on that card ever
   again. Get the sequence-position assertion right offline first; the live run is the last look.
2. **Phase 9's outstanding 9.6 check has the same constraint on the empty-`<infos>` card**, and it is
   still unrun. If a Phase 10 session is at a terminal with Miki anyway, closing 9.6 costs one extra
   card write and clears the older debt — but it must be the *add* that goes first, because the card
   stops being empty the moment anything lands.

**Limit ids come from the account** (`getProducts`, already walked by Phase 7): `ACCE`, `ADD`,
`AMDS`, `ANFR`, `APRO`, `ATOM`, `AVGS`, `BDSL`, `BEVR`, `BPRP`, … `DSL`, `ULSD`.

⚠ **`EFS_LIMIT_MAX` is 9999** and the vendor field is 4 digits — the guide's own example is 1000
gallons of ULSD. Gallons for fuel and DEF, dollars otherwise, via `formatLimit`.

⚠ **Watch the `uses` bound: 1–9, a LIST in the portal**, and `EFS_OVERRIDE_MAX_USES` already matches.

---

## 8. Where the documents are

| Document | What it is for |
|---|---|
| `docs/28` | The execution plan. **Phase status rows have been wrong five times** — verify against code |
| `docs/22` | Live findings and OEG records. H5 = first capability proof, **H6 = 9.7** |
| `docs/24` | The QA card roster and reserved fixtures — **the empty-`<limits>` card 10.4 needs** |
| `docs/25` | The account inventory answers |
| `docs/27` | The capability architecture — read §3 before adding a capability |
| `docs/37` | Odometer and SecureFuel. §7 is the open-questions ledger; §6c and §6d are live results |
