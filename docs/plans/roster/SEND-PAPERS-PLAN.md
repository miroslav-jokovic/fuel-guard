# Send a unit's papers to its driver by email: plan (2026-11-23), **OPEN — waits on Q-PS1..Q-PS6**

The owner asked on 2026-11-23 whether drivers' email addresses are in the system (from McLeod's
"Spouse's Name" field) and whether the office can send a trailer's paperwork straight from Silvicom 360.
The request was to analyse what we have and plan the feature **without assumptions**.

Every fact below was either read on `origin/main` at `055c38273`, or measured in production on
2026-11-23 with read-only queries scoped to the fleet org (`86d6…769b`). Each one says which.
`file:line` means *check the call site again before building on it*.

Prefixes: decisions are **D-PS**, steps are **PS**, questions are **Q-PS**.

---

## 1. What exists, measured

### 1.1 The address

- **Source.** McLeod `driver.name_of_spouse` holds the driver's email, by the carrier's own convention.
  - The agent reads it in `tools/mcleod-agent/queries.mjs:60` and filters it with `usableEmail`
    (`roster.mjs:65`).
  - The column is `char(28)`. A value exactly 28 characters long is kept only if it still ends in a TLD;
    otherwise it is treated as truncated and dropped.
  - `driverPatch` writes `drivers.email` (`apps/api/src/modules/mcleod/rosterFields.ts:69`), and only
    when McLeod sends a non-empty value.
- **Coverage (production).**

  | Status | Drivers | With email |
  |---|---|---|
  | Active | 191 | 182 |
  | Terminated | 106 | 33 |

  - 9 active drivers have no address.
  - 7 active addresses are exactly 28 characters long: at McLeod's limit, and kept only because they end
    in a TLD.
  - **Not measurable from 360:** how many of the 9 are empty in McLeod and how many were rejected as
    truncated. The agent drops a rejected value without counting it.
- **Contract and API.** `email` is in the roster list and detail schemas
  (`packages/shared/src/rosterContract.ts:157`, detail extends it at `:236`).
  - Create accepts it (`:201`) and PATCH accepts it (`:305`).
  - `DRIVER_DETAIL_COLS` selects it (`apps/api/src/modules/roster/routes/drivers.ts:50`).
- **Web.** The address is **not shown and not editable anywhere**.
  - `DriverForm.vue:76-89` has name, employee ID, phone and status.
  - `DriverContactSection.vue` edits only `DRIVER_INLINE_EDITABLE`, which has no email.
- **An office edit would not survive.**
  - The sweep skips a row only when `identity_source = 'manual'` (`rosterIngest.ts:33-37`).
  - An edit claims the row only for `DRIVER_IDENTITY_FIELDS` (name parts and phone;
    `rosterContract.ts:360`), both in `resolveDriverUpdate` and in the trigger in
    `0241_identity_provenance_claim.sql`.
  - So an email typed in 360 is replaced at the next sweep whenever McLeod has a usable value.
  - **And McLeod cannot hold an address longer than 28 characters at all.** "Fix it in McLeod" is
    therefore not a complete answer → **Q-PS1**.

### 1.2 The papers

- **Where they live.** Unit papers are `documents` rows with `subject_type` **`tractor`** or `trailer`
  (`complianceContract.ts:113`; `equipmentFileCatalogue.ts:15`), in bucket `compliance-docs`.
- **Production originals by kind** (`derived_from is null`):

  | Subject | Kind | Count | Avg KB | p95 KB | Max KB |
  |---|---|---|---|---|---|
  | trailer | annual_inspection | 285 | 1,033 | 1,671 | **5,907** |
  | trailer | registration | 234 | 669 | 1,172 | 1,602 |
  | trailer | irp | 2 | 202 | 317 | 329 |
  | tractor | irp | 726 | 550 | 1,168 | 1,607 |
  | tractor | annual_inspection | 296 | 772 | 1,393 | 1,574 |
  | tractor | registration | 15 | 288 | 572 | 575 |

  - Content types are PDF, plus some JPEG and PNG on annual inspections.
- **Coverage of active trailers (234).**
  - 212 have a registration and 223 have an annual inspection.
  - **14 have two or more registrations.** So "which one" must come from the unit-file rollup's chosen
    `documentId` per requirement, not from "latest row" → **D-PS3**.
- **The roadside set already exists** as a catalogue fact (`roadside: true` in
  `equipmentFileCatalogue.ts`): registration/IRP cab card, permits, lease, insurance, IFTA (tractor only)
  and annual inspection.
  - What to pre-tick is therefore read from there, not written as a list → **D-PS3**.
- **Reusable server code.**
  - `downloadDocumentBytes(admin, orgId, documentId)` (`apps/api/src/modules/evidence/documentBytes.ts:20`)
    returns the bytes, sha-checked.
  - It does not return `content_type` or `kind`; the caller selects those.
  - `GET /api/compliance/unit-files` gives each requirement's chosen `documentId` and good-until date.

### 1.3 Who should receive them

- **What the code has.** `readTrailersOnLoads` (`apps/api/src/modules/loads/liveLoadReads.ts:286`) gives
  trailer → truck → load, one load per truck, by the map's rule (`isLoadOnTruck`).
  - **It does not return the driver**, although `loads.driver_id` exists.
  - The trailer page builds trailer → truck → seated driver **client-side**
    (`UnitRelationStrip.vue:54-80`).
  - No server function answers "who is the driver of trailer X".
- **Production, loads on a truck now:**
  - 111 loads, all with a trailer and all with a `driver_id`. No truck has two such loads.
  - The load's driver matches the truck's seated driver (`vehicles.assigned_driver_id`) on **108**;
    **3 differ**.
  - **4** trucks are team trucks (`co_driver_id` set).
  - **106 of 111** load drivers have an email.
  - So the default answer is right about 95% of the time, which is why the dialog still lets the
    sender choose → **D-PS2**.
- **Trucks.** 177 of 220 active tractors have a seated driver.

### 1.4 Sending

- **The mailer cannot attach today.**
  - `OutgoingEmail` is `{to, subject, html, text, replyTo}` (`apps/api/src/lib/mailer.ts:4-14`).
  - Neither the Resend body nor the Brevo body sends attachments.
- **The providers' own documentation** (read 2026-11-23):
  - **Resend:** `attachments: [{ filename, content (base64 or buffer) | path, content_type? }]`, at most
    **40 MB per email after base64**.
  - **Brevo:** `attachment: [{ name, content (base64) } | { url }]`. `pdf`, `jpg`, `jpeg` and `png` are
    allowed. **The API reference states no size limit** → **Q-PS5**.
- **Which provider production uses is not verified.**
  - `envMail.ts` picks Resend first, then Brevo, by which key is present.
  - The SSM read needed to check was refused on 2026-11-23 as credential exploration, correctly. The owner
    can read it, or `GET /api/version`-style diagnostics can say.
- **Size in practice.** From the table above, a trailer's registration plus annual inspection is about
  1.7 MB on average and 7.5 MB in the worst case. A truck and trailer roadside set is about 4 MB on
  average and about 11 MB worst case before base64 (≈ 14.7 MB after).
- **Links are not an option here.** The mailer header records that Brevo rewrites every link and keeps it
  in its event log (measured 2026-09-14).
  - A signed download link in this email would be readable by anyone holding the Brevo key, until it
    expires.
  - Attachments carry no link → **D-PS1**.
- **Nothing in the product sends a document by email today.**
  - Driver message threads are text only (`messagesContract.ts:90-94`).
  - SMS has no media (`lib/sms.ts:45-51`).
  - Office chat has files, but it is office-to-office.

### 1.5 Permissions

- **Matrix** (`SECTION_ACCESS`, `packages/shared/src/auth.ts:136`):
  - `equipment`: admin and fleet_manager **manage**; dispatcher, safety_manager and auditor **view**.
  - `dispatch`: admin, fleet_manager and dispatcher **manage**; auditor **view**.
- **Per-paper reading.** `fileSectionFor` maps tractor and trailer papers to `equipment`
  (`packages/shared/src/fileSections.ts:24-35`), and `mayFile` applies it
  (`apps/api/src/modules/evidence/routes/fileAccess.ts:11`).
- **The question.** Sending papers to a driver is an act on the driver's day, and the person who does it
  must be allowed to read the paper → **Q-PS2**.

### 1.6 Record

- **There is no outbound email log.**
  - `notification_deliveries` is tied to office `user_id` (`0598`).
  - `sms_outbox` is recruiting texts.
  - Both are prunable.
- **Audit.** `writeAudit` (`apps/api/src/lib/audit.ts`) is the pattern. Existing actions include
  `compliance.document_downloaded` and `compliance.documents_link_sent`.
- **Retention.** `audit_logs` and `documents` are in `RETENTION_FORBIDDEN`.

### 1.7 What is already planned nearby

- **UNIT-FILES-PLAN D-UF9 / UF10, ruled 2026-10-19 and not built:**
  - the driver app gets **Truck papers**: the seated truck's and its trailer's roadside set, saved on the
    phone for use without signal;
  - served by `GET /api/me/truck-papers`.
- This plan does not replace it. Email reaches a driver today without an app release. UF10 makes the
  sending unnecessary for drivers who have the app → **Q-PS6**.

### 1.8 Fixed alongside this analysis: the hover card under the rows (PR #2628)

- **Problem.** The File column's hover card was an `absolute` child of the table cell, so the table's
  scroller clipped it and later rows' sticky cells painted over it.
- **Fix.** `components/ui/HoverCard.vue` (teleported to body and placed with `@floating-ui/vue`, the
  dropdowns' recipe) now draws both of `FileCell`'s cards.
- That is the only place the pattern existed. The "Send papers" dialog below uses no hover card.

---

## 2. Decisions this plan takes (reversible at review)

- **D-PS1: attachments, not links.** See §1.4.
  - The papers stay readable in the driver's inbox with no signal at a roadside stop.
  - The email itself carries no credential.
- **D-PS2: the recipient is proposed, never silent.**
  - **Default:** the driver of the load the truck is hauling now (§1.3).
  - **Also offered:** the seated driver and co-driver when different.
  - **Any active driver** can be picked with the roster's own picker.
  - A driver without an address is listed but disabled, with the reason "No email on file" and the fix
    (Q-PS1).
- **D-PS3: what is ticked is derived.**
  - Pre-ticked: the subject's **roadside** catalogue items that have a paper, using the rollup's chosen
    `documentId` per requirement (§1.2: 14 trailers have two registrations).
  - Each item shows its good-until date.
  - Expired and not-dated papers are shown **unticked**, with a warning chip. They can be ticked
    deliberately.
  - Non-roadside papers (title, lease, other) are listed under "More papers", unticked.
- **D-PS4: one dialog, three entry points.**
  - The **Trailer page** and **Truck page** header gets a "Send papers" action.
  - The **Driver page** gets "Send papers" for their current truck and its trailer, both sections
    pre-ticked.
  - The dialog is a `SlideOver` (the list stays visible beside it; contract §1.2).
- **D-PS5: every send is recorded.**
  - **New append-only table `paper_sends`:** org, actor, recipient driver, address used, subject(s),
    document ids, sha256s, provider result, sent_at.
  - It goes in `RETENTION_FORBIDDEN`, because "did we send the driver the current registration on
    11/23?" is evidence.
  - It also gets an `audit_logs` row `equipment.papers_sent`.
  - The unit page shows "Last sent to M. Petrović 11/23 by Miki".
- **D-PS6: the email.**
  - From the system sender, with Reply-To going to the office (`MAIL_REPLY_TO`, ruled 2026-11-17).
  - **Subject:** "Papers for trailer 5312" or "Papers for truck 687 and trailer 5312".
  - **Body:** one line per paper with its good-until date and the sender's optional note.
  - **Attachment names:** `trailer-5312-registration.pdf`, and so on.
  - **No tracking pixel and no links.**
- **D-PS7: a size cap before sending.**
  - The dialog shows the total.
  - The API refuses above a cap, `PAPER_SEND_MAX_BYTES`, set from the live provider's documented limit
    (Q-PS5) and never higher than Resend's 40 MB.
  - An image paper is attached as-is. No conversion in this plan.

---

## 3. UI

```
Trailer 5312                                     [ Send papers ]  [ Notes ]

┌ Send papers ─────────────────────────────── SlideOver, md ┐
│ To                                                         │
│ ● Marko Petrović  marko.p@…   driver on load 48213 (687)  │
│ ○ Ana Whitfield   ana.w@…     seated on truck 687          │
│ ○ Other driver…                                            │
│                                                            │
│ Roadside papers                                            │
│ ☑ Registration / IRP cab card   good until 03/31/2027     │
│ ☑ Annual inspection             good until 08/14/2027     │
│ ☐ Annual inspection 2025        Expired 08/14/2026  ⚠     │
│ ▸ More papers (2)                                          │
│                                                            │
│ Note (optional) ________________________________           │
│ 2 files · 1.8 MB                                           │
│                                   [ Cancel ]  [ Send ]     │
└────────────────────────────────────────────────────────────┘
```

- On success, a toast says "Sent to Marko Petrović". The unit page's File section header gets
  "Last sent … by …".
- On failure, the dialog stays open with the provider's reason (`SendResult.detail`). Nothing is
  recorded as sent.
- On the driver page, the email is shown in the contact section, read-only, with a source tag
  "from McLeod". A driver with no address shows the fix ruled in Q-PS1.
- The Drivers list gets a **"No email"** filter. A list of 9 is something the office can clear.

---

## 4. Steps (each one merge, in order)

| Step | What | Layer | Migration |
|---|---|---|---|
| PS0 | Show the driver's email (read-only) and the "No email" filter | web | — |
| PS1 | Whatever Q-PS1 rules about editing the address in 360 | shared, API, maybe migration | maybe |
| PS2 | `OutgoingEmail.attachments` for Resend and Brevo, with mailer tests per provider body | API | — |
| PS3 | `paper_sends` table (RLS on, no client policies, retention-forbidden) | migration | yes |
| PS4 | `GET /api/equipment/:type/:id/send-papers` (proposal: recipients + items, derived) and `POST …/send-papers` (re-checks every document's subject and org, `mayFile`, cap, sends, records). Driver-for-unit becomes a server read (§1.3), so web and API cannot disagree | API | — |
| PS5 | `SendPapersPanel.vue` and the three entry points; "Last sent" line | web | — |

PS3 ships before its first reader (PS4), per the migration-ordering rule.

**Tests that must exist:**
- The derived pre-tick follows the catalogue's `roadside` flag.
  - Mutating that flag must change the ticked set.
- `POST` refuses a document from another unit or another org (`expectOrgScoped`).
- The cap refuses before any provider call.
- A failed provider call writes no `paper_sends` row.
- An auditor or safety manager is refused, per Q-PS2.

---

## 5. Open questions (owner)

- **Q-PS1: what happens when McLeod cannot hold the address?** (9 active drivers with none, 7 at the
  28-character limit.)
  - (a) **Recommended.** The office can type the address in 360, and that claims **the email field
    only**: a per-field claim, recorded like the identity claim but not freezing names. The sweep stops
    writing email for that driver, and the page shows "edited in 360".
  - (b) Keep McLeod as the only source. Addresses longer than 28 characters can then never be stored, so
    those drivers can never be sent anything.
  - (c) Use a longer McLeod field. This needs Alex to name one free field of at least 64 characters, and
    the agent query changes.
- **Q-PS2: who may send?**
  - (a) **Recommended.** `dispatch: manage` plus `mayFile` view on each paper: admin, fleet manager and
    dispatcher. Sending a driver his papers is dispatch work, and both halves are read from the matrix.
  - (b) `equipment: view`. This adds the safety manager and the **auditor**, a read-only role, which
    would then send mail.
  - (c) `equipment: manage`. Admin and fleet manager only, so dispatchers could not.
- **Q-PS3: send to the driver only, or also copy the office?**
  - **Recommended:** driver only, with Reply-To the office. The record in `paper_sends` is the office's
    copy.
- **Q-PS4: should a send also go to a driver's personal phone by SMS?**
  - **Recommended: no.** SMS cannot carry a PDF (§1.4), only a link, and D-PS1 rules links out.
- **Q-PS5: the size cap.**
  - The owner checks which provider production runs (SSM `MAIL_PROVIDER`).
  - If it is Brevo, we ask Brevo support for its attachment limit; their API page states none.
  - **Recommended until answered:** a 20 MB cap, half of Resend's documented limit. That is above the
    measured worst case of 14.7 MB for a truck plus trailer after base64.
- **Q-PS6: build order against UF10 (Truck papers in the driver app).**
  - **Recommended:** this plan first. It needs no app release, and the store route is still being set up
    (STORE-TESTING-ROUTE, 2026-11-23).
  - UF10 next. It reuses PS4's server read of "this driver's truck and trailer".

---

## 6. What this plan does not do

- **No write to McLeod.** The `name_of_spouse` convention stays read-only on our side, per
  `docs/plans/mcleod/mail.md`.
- **No public or shareable link to a paper** (D-UF9 refused one too).
- **No bulk "send to every driver".** It is one unit or one driver at a time, until someone asks with a
  reason.

---

## 7. Progress log

- 2026-11-23: Plan written from the owner's request. Facts measured in production and read on
  `055c38273`. The hover card bug the owner reported in the same message was fixed separately in
  PR #2628. Waits on Q-PS1..Q-PS6.
