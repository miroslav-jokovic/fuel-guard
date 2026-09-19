# Handoff — 2026-09-19. Wave C: C1 and C2, the signing surface.

**Written after Wave A closed (#891, #892, #893, #894, main `10b50f0`).** Waves A and B are both
complete, §8 has no open questions, and **no migration is owed** — 0345 is the head and is applied.
Wave C is C1 then C2, and then everything left is Wave D.

⚠ **This document is a snapshot and goes stale; `HIRING-MODULE-PLAN.md` §10 does not.** The dated log
at the END of §10 says what is done — not §9's table, and not this file. If they disagree, the log
wins. Read §0 (the continuity protocol) before starting.

⚠ **Everything below was measured on 2026-09-19 against the code on `origin/main` and against
production.** Four claims in the plans did not survive that. They are in §1, and one of them decides
where C1's first line of code goes.

---

## 0. Where the programme stands

| | |
|---|---|
| Waves A and B | **COMPLETE** |
| §8 questions | **none open** |
| Migration head | **0345**, applied and served. Wave C needs no schema — measured, see §4 |
| Never started | **C1, C2** · all of Wave D |
| Recommended order | **C1 first.** C2 is the adoption dialog and edits the same files |
| ⚠ A clock | **2026-10-01** — see §2 |

---

## 1. ⚠ Four claims that did not survive being checked

Each one would have cost a session an hour or sent it to the wrong file. They are corrections to the
plans, not to the code.

### 1a. ⚠ `meta.fullBleed` (D-HUI6) is the WRONG LEVER for this screen, because the ceremony is not an `AppShell` page

§9's C1 row says *"`meta.fullBleed` (D-HUI6) — ⚠ **not** a new `meta.layout`"*. That advice is right
about `AppShell` and **inapplicable here**. Measured:

- `/apply/:token` is declared in `apps/web/src/router/routes/auth.ts` with
  `meta: { public: true, layout: "apply", … }` — so `resolveLayout` returns `"apply"` and `App.vue`
  renders **`ApplyLayout.vue`**, never `AppShell`.
- `meta.fullBleed` is read in exactly one place: `isFullBleed()` in `lib/layout.ts`, called by
  **`AppShell.vue`** and nothing else. Setting it on the apply route is a no-op.
- `ApplyLayout.vue` is 42 lines and hard-codes the width: `<main class="mx-auto w-full max-w-3xl
  flex-1 px-6 py-8">`.

So the real question is what `ApplyLayout` has to grow, and the answer is smaller than it sounds.
⚠ **`max-w-3xl` is 768px, and D-HUI9 measured the packet as fully readable at 765px** — the layout is
already, by accident, within three pixels of the width the measurement blessed. What the signing
screen needs from the layout is **vertical room and permission to escape the padding**, not width.

**Recommendation:** an opt-in prop or slot on `ApplyLayout` (`wide` / `fill`), argued in its header,
rather than a sixth `LayoutName` or a `meta.fullBleed` that nothing reads on this route. ⚠ D-HUI6's
*reasoning* survives intact — do not add a `layout: "canvas"` — only its named mechanism is wrong for
this surface. **Write the correction into §10 when C1 lands**, or the next reader follows the row.

### 1b. ⚠ Q-HUI2 is ANSWERED, and §9 still lists C1 as gated on it

§9's C1 row ends *"· after B8, **Q-HUI2**"*. `HIRING-UI-PLAN.md` **D-HUI9** answers it, measured
2026-09-17 by rendering packet page 15 at each viewport's true scale (`pdftoppm -r 46` = a 390px
phone at 1x, `-r 90` = 765px):

| Viewport | Body text | Verdict |
|---|---|---|
| **390px** | **~6 CSS px** | the page is recognisable as a **shape** — heading, paragraphs, signature lines, page number — and the body **cannot be read** |
| **765px** | ~12 CSS px | fully readable |

⚠ **None of Q-HUI2's three candidates was right, and D-HUI9 is what ships: BOTH, ALWAYS.** The page
renders at every width — that is what tells the driver *where they are on the carrier's paper* — and
beside it **the stop's own sentence in real type**, which the current ceremony already serves as
`stop.what` and is the one thing it got right. Pinch-zoom stays enabled. ⚠ Never `user-scalable=no`.

⚠ **And the fact that makes this safe rather than a compromise:** six of the twenty-two stops sit on
pages whose instrument the driver has already read and signed in full, readable type on their phone —
page 15's past-employment release, page 20's FCRA disclosure, page 22's urinalysis notification. On
those the packet line is a countersignature of something already read. The other sixteen are where
the sentence has to carry it. **C1 is not blocked. Do not re-open this; implement D-HUI9.**

### 1c. ⚠ "Q-PKT9's remaining half" is not open work — D-PKT18 shipped and A4 used `pinnedKinds`

Both of the previous two handoffs list, under *what is open*: *"Q-PKT9's remaining half — a resumed
SIGNATURE carries the hazard `needsInitials` solves only for initials. A4's `pinnedKinds` is the
machinery and nobody has used it."* Measured, that is no longer true:

- `GET /:token` serves `packetAdopted` (`publicApplication.ts`, via `adoptedPacketMarks`), and
  `ApplyPage.vue` passes it down as `:adopted-marks`. That is D-PKT18 / candidate (a), built.
- `usePacketAdoption.ts` computes `alreadyAdopted` from **the served pin**, not from the input refs —
  `Boolean(pin.signature?.trim()) && (!needsInitials || Boolean(pin.initials?.trim()))` — which
  covers the resumed **signature** as well as the initials.
- `pinnedKinds` exists and **is** used: `canChange(kind) => !pinnedKinds.has(kind)`, and `adopt()`
  refuses when neither kind can change.

⚠ **Re-derive it before treating it as work.** If something is still owed here it is narrower than
the sentence claims, and C2 is where it would show up — but do not start C2 by building machinery
that is already there and wired.

### 1d. ⚠ The server half is NOT "entirely reusable" — nothing serves the packet to the applicant

§9's C1 row says *"Server half is entirely reusable: `packetTemplate`, `packetMarkGeometry`,
`packetFieldGeometry`, `packetOverlay`, `packetGrid`"*. Those five all exist
(`apps/api/src/modules/recruiting/applicationPdf/packet/`) and the claim is true **of the geometry**.
It is not true of delivery, and delivery is what C1 needs. **This is C1's one real server gap.**

Measured — the nine public routes on an application link are:

```
GET  /:token            POST /:token           POST /:token/review     POST /:token/consent
POST /:token/unlock     POST /:token/capture    POST /:token/release
POST /:token/mark       GET  /:token/document
```

⚠ **`GET /:token/document` is post-submission only.** `applicationCopy.ts` returns `not_submitted`
(409) before filing, and its header argues that bound deliberately: *"Before that there is no filed
document, and the draft is already reachable through the endpoint that exists for it."* **So today
there is no way for an applicant to read the packet they are about to sign** — which is exactly the
defect C1 exists to fix, and it needs a tenth route.

**The renderer is already written.** `applicationPreviewPdf(admin, orgId, invitationId)` in
`applicationPdf/preview.ts` renders the carrier's packet with `marks: []` and a DRAFT band — A2 built
it and pinned it against the filing path. A public route can resolve the token to an invitation and
call it. ⚠ **Do not reach for `render.ts`** (the §391.21 summary, for already-filed records) and ⚠ do
not copy `permissionsDocument.ts` — A2's whole lesson is that two renderers of the same document
diverge silently and no gate can see it.

⚠ **The new route's bar is `applicationCopy.ts`'s own header, and it is a good one:** ask what the
holder of the credential can see that they could not see before. Here: nothing. The same token
already reads the draft — a date of birth, an address history, an employment history — and has
already signed four federal authorizations in this person's name. Serving them the document assembled
from their own answers is not an escalation. **But copy the bounds too**: audited, and refused once
the link is dead. Two open questions about its shape are in §4.

---

## 2. ⚠ The clock on C1, and it is the same invitation A1 saved last night

Measured against production, 2026-09-19:

```
application_packet_marks:  20 marks · 1 walk · invitation f2b142e4-8a8a-4b0d-bbfb-bad69fde901a
   approved_at 2026-09-17 22:19Z · last mark 2026-09-17 22:21Z
   submitted_at NULL · revoked_at NULL · expires_at 2026-10-01 22:14Z
documents(kind='employment_application'):  1, created 2026-09-14 — PRE-DATES every mark,
   so it is render.ts's §391.21 summary and NOT a filed packet
```

Three things follow, and they pull in the same direction:

- ⚠ **No packet has ever been filed, so how the packet PRINTS is still free to change.** The freeze is
  at filing ([[a-filed-document-is-frozen]] / §0 of the plan). **Anything in C1 or C2 that changes
  printing must land before somebody finishes that walk.**
- ⚠ **That walk is the only live one, and its link dies 2026-10-01.** It is 20 of 22 marks in, on a
  link that still works — the best possible test fixture for C1, and after 1 October the only way to
  get a partially-signed packet is to walk a fresh one in the QA org.
- ⚠ **It is the same invitation A1 rescued.** It was ~18 hours from having its token rotated out from
  under it when `APPLICATION_NUDGE_ENABLED=false` stopped the clock; A1 now excludes it in the fold
  and the sweep is back on. **Do not finish this walk to "test" C1 in Silvicom** — that files the
  packet and freezes the format. Walk the **QA org**, as A0 did.

---

## 3. C1 — what to build, and what is already there

**Done when:** *a driver can read the page they are about to sign, on the page they are about to sign
it.*

### 3a. The four pieces

| | |
|---|---|
| **A tenth public route** | serve the unsigned packet for a token. §1d — this is the only part with no code behind it |
| **A canvas viewer** | `pdfjs-dist`, page-addressable. §3b |
| **The rail + START/NEXT/FINISH** | the walk, which `usePacketCeremony.ts` already owns. §3c |
| **A layout escape** | §1a — `ApplyLayout`, not `meta.fullBleed` |

### 3b. ⚠ C1 cannot inherit B8's viewer, and the viewer's own header says so

`DocumentPreview.vue` is an `<iframe>` on a blob. Its header, written by B8:

> *The plan's B8 row says this viewer is "shared with C1". ⚠ **The read-only half is shared; the
> signing half is not, and C1 should not open expecting it.** C1 needs a page rail, START/NEXT and tap
> targets over 22 named places — and an `<iframe>` on a blob gives none of that: you cannot address a
> page inside it, you cannot draw over it, and you cannot know which page the driver is looking at.*

**Build on `lib/pdfWords.ts` instead.** It already dynamically imports `pdfjs-dist` and already solves
the worker URL, which is the fiddly half — and it is deliberately thin, so read it for the recipe
rather than extending it: its job is words-with-positions for vendor statements, and a page renderer
is a different job in the same library. ⚠ It is dynamically imported *because* pdfjs is large and only
an upload should pay for it. The same argument applies here: an applicant reaching screen three of
eight should not download a PDF engine.

### 3c. What the client already has, so C1 does not re-derive it

- **`ApplyPacketStop` = `PacketPlacement & { signedAt }`**, and `PacketPlacement` carries
  `{ id, page, party, mark, anchor, what }`. ⚠ **`page` is the carrier's own page number and `what` is
  the sentence** — so the rail and the sentence beside the page both already have their data. Nothing
  new has to be served for them.
- ⚠ **`id` is the only identifier, written out rather than derived from array order.** Page 19 carries
  two driver lines identical in every other field. An index would silently re-point every signature
  filed before the change.
- **`usePacketCeremony.ts` (268 lines) owns the WALK** and composes `usePacketAdoption.ts` (326). Its
  public surface is spread (`{ ...adoption, …walk }`), so a consumer cannot tell the halves apart —
  **keep it that way** (Q-PKT11).
- ⚠ **`current` is derived, never a stored cursor** — it is the first stop nobody has filed. A4 fixed a
  defect where a `refetchOnWindowFocus` refetch stranded the walk past the 11th mark
  ([[a-cursor-into-a-refetched-list-strands-the-walk]]). **C1 must not reintroduce a page index that
  is stored rather than derived**, which is the same shape one level up.
- ⚠ **The progress count is of the whole packet, not of the work left** — *"7 of 22"* includes stops a
  previous session collected. Renumbering under a returning driver is the failure that comment exists
  to prevent.

### 3d. ⚠ The limiter is sized for a ceremony, and C1 must not outgrow it

A0b gave `POST /:token/mark` its own bucket: **`PACKET_CEREMONY_LIMIT = 60` per 60s, keyed per LINK**
(`applicationLinkKey` — a SHA-256 of the token, not the address), while the intake bucket stays at
**20** and skips marks. Before that, 22 POSTs against a 20-request budget meant **nobody could finish a
walk** ([[packet-ceremony-outruns-the-rate-limiter]]).

⚠ **A page-by-page viewer that fetches per page would be a new request pattern on this prefix.** If
the document is fetched once and rendered client-side, nothing changes. If C1 fetches per page, it
lands in the **intake** bucket (the ceremony limiter skips anything that is not `POST …/mark`) and a
31-page document blows a 20-request budget on the first scroll. **Fetch the bytes once.**

### 3e. Budgets, measured today

| File | Lines | Budget |
|---|---|---|
| `PacketCeremony.vue` | **434** | 500, warn 450 — ⚠ **16 lines of headroom** |
| `usePacketCeremony.ts` | 268 | fine |
| `usePacketAdoption.ts` | 326 | fine |
| `pages/ApplyPage.vue` | 456 | warn 450 — ⚠ already over the warning line |
| `routes/publicApplication.ts` | 460 | 500 — ⚠ **40 lines**, and C1 adds a route |

⚠ **Two of the files C1 must touch are within a step of the gate.** The repo's answer is settled and
has been applied three times (#883, #888, #893): **split first, in its own behaviour-preserving PR,
then build the feature.** A waiver is how gates die, and a refactor bundled into a feature step is a
diff in which nobody can see which lines were the feature. Expect C1 to be **two or three PRs**.

---

## 4. Open questions C1 must answer, with recommendations

Per `CLAUDE.md`'s *no workarounds*: these are recorded rather than routed around. Answer them in §10
with a decision id when C1 lands.

- **Q-HUI10 · Does the applicant's reading copy carry the DRAFT band?** `applicationPreviewPdf` bands
  it, and the band is honest — nothing is filed. But a DRAFT stripe across the page somebody is being
  asked to sign may read as *this is not the real document*, which is the opposite of what C1 is for.
  **Recommendation: no band on the signing surface, band on the office preview.** They are already two
  call sites of one renderer, and `preview.ts` already takes the band as an option that `file.ts`
  never passes. ⚠ If the band is dropped, say in the route's header why a document that is not filed
  is nonetheless shown unbanded to the person signing it.
- **Q-HUI11 · Does the reading copy show the marks already collected?** A2 ruled that the office
  preview always renders `marks: []`, because a preview happens before signing and a marks-based
  switch would render the wrong document for ever. ⚠ **The applicant's case is genuinely different**:
  a driver resuming at stop 8 of 22 has seven signatures on that paper and every commercial product
  shows them. **Recommendation: yes, render the collected marks** — the renderer already takes them —
  and state plainly in the header that this is NOT A2's rejected switch, because the input is the real
  mark set rather than a proxy for *has this been signed*.
- **Q-HUI12 · Is the route keyed on the token alone, or does it refuse before approval?** `POST
  /:token/mark` answers `packet_not_yet_approved` (409) while the office is still reading. Reading is
  not signing. **Recommendation: serve it whenever the link is live**, so a driver can read what they
  will be asked to sign before they are asked — and refuse with the same neutral `invalid_link` the
  session uses, never a code that distinguishes *expired* from *no such invitation*.

---

## 5. C2 — after C1, same files

**Done when:** *a driver can adopt a signature, see it, and change it before it is on 22 pages.*

DocuSign's three tabs — **Choose a style / Draw / Upload** — with signature and initials adopted
**separately** and changeable while the envelope is open. The machinery exists: `usePacketAdoption.ts`
holds `style`, `markBlob`, `adopted`, `confirmed`, `drawnMarkFailed`, `pinnedKinds`, `canChange`,
`markFor`. ⚠ **`canChange` is the half that makes the initials pin survivable** and it is already
wired — see §1c before building anything that looks like it.

⚠ **Upload is the only genuinely new tab**, and A3 left a warning next to it: the staged-drawing
failure is *recorded* in `drawnMarkFailed`, which **withdraws the promise as well as raising the
notice** — a stop whose drawing did not stage previews the typed name, because that is what lands.
Whatever upload does on failure must do the same, or the screen shows one thing and files another.

---

## 6. The traps, all still live

| | |
|---|---|
| **⚠ Rendering finds what tests cannot** | **ten consecutive steps** shipped a defect every test was green for; B7 was the first that did not, because it was walked at 390 and 1440 before the PR was opened. B2 found `field()` overprinting a wrapped label by rasterising. **Open the page. Rasterise the document.** |
| **⚠ The apply-flow browser recipe** | `preview:local` (it takes whatever port is free), then Playwright with `route.fulfill` of **RAW** bodies — never `{ok,data}`. To reach the ceremony the bundle needs `phases.approvedAt` set, `submittedAt` null, `consentedAt` + `releasesCompletedAt`, `releases: []`, `draft.locked: false`. ⚠ `pnpm build` will NOT work — it needs the two `VITE_` vars as real env vars. Full recipe in §10's A3 entry |
| **⚠ Headless Chromium renders no PDF** | blank iframe, no error. Use channel `"chrome"` for any PDF screenshot |
| **A green mutation usually means the TEST is at fault** | six times now. The cause is always a fixture too uniform to discriminate — **write the partial case** |
| **A mutation that merely breaks the build proves nothing** | write it so it compiles and only the assertion can catch it |
| **`supabaseRecorder` returns whole fixture rows whatever was asked** | so an end-to-end test is blind to a `select` or a filter. Assert the recorded query when the query IS the change |
| **⚠ `lint:tokens` reads a hash plus three hex digits as a colour** | so the ordinary way of citing a PR number in a comment fails the build |
| **A plan-file conflict is NORMAL** | two sessions appending dated §10 entries collide at the `## 11. Sources` boundary. **Keep both** |
| **⚠ A conflicting PR gets NO CI at all** | `gh pr checks` says *"no checks reported"* rather than failing. Check `mergeStateStatus` first |
| **`native-android` is the slow check** | six jobs go green in ~3 minutes and the android one lands minutes later. `mergeStateStatus` is `BLOCKED` until it does |
| **`RecruitmentPage.test.ts` flakes at ~5,000 ms** | under full `pnpm test` parallel load only; green targeted, per-package and on CI. Undiagnosed, and not your change |
| **⚠ `main` may be held by a worktree** | `.claude/worktrees/mcleod-loads-plan` has it checked out, so `git checkout main` fails here. Branch from `origin/main` |

---

## 7. The protocol, unchanged

One step, one PR, one branch off `origin/main`. ⚠ Several chats share this working tree — check
`git branch --show-current` before every commit and push. Record progress by **appending a dated line
to §10**; never tick a row in §9. Run the gates before pushing — ⚠ `pnpm lint` is not the gate set:
`lint:filesize`, `lint:funcsize`, `lint:boundaries`, `lint:comment-claims`, `lint:table-writers` and
`--filter web lint:tokens` all pass and fail independently. **Prove a test can fail** by mutating the
line it covers — and if a mutation comes back green, **suspect the test before the code.**

⚠ And the one every wave keeps proving: **the suite being green is not the verification.**

---

## 8. What is left after Wave C

All of **Wave D** — D1 (MVR / Clearinghouse / drug test as recorded acts), D2 (road test), D3
(orientation + handbook), D4 (re-found `DRIVER-TRAINING-PLAN.md`, then its Phases 0–3), D5 (live
sessions). ⚠ **Three of the five are `∥`** and unblocked today.

⚠ **`readyToTravel.ok` is false for everybody until D4 ships**, and says so by name. Exactly three of
the fourteen steps have no evidence table — orientation videos, live orientation, handbook — which is
D3/D4/D5. That is the medical-certificate lesson working as designed, not a bug.

⚠ **`∥` means *open a second chat NOW*, not *do it later*.** Wave A drifted for four sessions because
nobody did, and **a parallel step has no moment at which it announces itself as late** — a blocked
step announces itself when its blocker lands.

**Not builds, and nobody has done them:** send the counsel package · buy a Clearinghouse query plan +
IDEMIA verification · three Railway variables for Resend · point `silvicom360.silvicominc.com` at
Railway.
