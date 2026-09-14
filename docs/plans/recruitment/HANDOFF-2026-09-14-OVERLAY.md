# Handoff — the ceremony is built, the carrier's form draws, two things stand between them

**Supersedes `HANDOFF-2026-09-14-PACKET.md`.** That document is still right about the architecture
and the owner's flow; it is out of date on everything it lists as "next", and its claim that
coordinates exist was corrected in #784.

`main` `6396bcb`, plus **#788 open** (the overlay renderer). Eight PRs merged this session.
Migration **0339** is live in production and verified at the database.

---

## 1. What the owner asked for, and where it now stands

> *"When driver fills out the application link and sends it back we review it as this PDF form, and
> resend it to the driver for signing — the driver needs to be navigated precisely from place to
> place and sign all places. Similar to DocuSign."*

| step | state |
|---|---|
| send link → driver fills it remotely | **works** (proved 2026-09-14, first application filed) |
| go through it together in the office, fixing employment | **works** (#778) |
| approve | **works** |
| **driver is walked to all 22 places and signs** | **works** (#781 server, #783 web) |
| the packet joins the DQF **as the carrier's own form** | ⚠ **NOT YET — see §3** |

⚠ **A filed application still renders our §391.21 summary, not the carrier's form.** `file.ts` calls
`render.ts`. `renderPacket.ts` and the new `packetOverlay.ts` both have no production importer.

---

## 2. What shipped, in order

| PR | |
|---|---|
| **#780** | `packetWording.ts`'s 33 page numbers were one too low — measured off the carrier's footers |
| **#781** | P5 server: migration **0339**, `application_packet_marks`, `record_packet_mark`, `POST /:token/mark`, stable placement ids |
| **#782** | CI unblocked repo-wide — Google withdrew the `tools` SDK package and broke `setup-android@v3`'s default for everyone |
| **#783** | P5 web: the 22-stop walk, adoption drawn-or-typed (D-PKT13) |
| **#784** | The carrier's PDF is a repo asset; a test reads **their paper** — closes §2.5 |
| **#785** | **D-PKT15** — the walk IS the certification; the server refuses a form that is not signed through |
| **#786** | The page coordinate system, resolved and proved by landmark |
| **#787** | The hand-verified mark table — 22 coordinates, each **looked at** |
| **#788** | *(open)* `packetOverlay.ts` — draws the marks onto the carrier's pages |

**Production right now:** 1 application filed, **0 packet marks** (nobody has walked the new
ceremony), 4 live invitation links.

---

## 3. ⚠ THE TWO THINGS BETWEEN HERE AND THE OWNER'S DOCUMENT

### 3.1 Q-PKT8 — the initials are not collected, and the server would refuse them

**This is a defect in the ceremony that shipped in #783, found by the overlay.**

`p05`, `p06`, `p09` are `mark: "initials"`. D-PKT6 has always been explicit — initials are a **second
adopted mark**, *"not an abbreviation of the first… a ceremony that derived them from the typed name
would be inventing a mark the signer never made"* — and `adoptedMarkKinds()` returns two.

**The ceremony adopts one.** The renderer is handed a full name for the three places that ask for
initials, which are also the three narrowest lines in the table (89–141pt).

⚠ **Worse than cosmetic:** `record_packet_mark` pins one `signed_name` per link (`DR035`), so a client
that correctly sent initials is **refused at the third stop**. It only works today because the walk
sends the same string everywhere.

**The fix is three parts:**
1. **A migration** making the pin per `(invitation_id, mark)` rather than per invitation. The RPC's
   `select signed_name … limit 1` becomes `… where mark = p_mark`.
2. **Adoption** collects initials as well as the signature — one more field on the same screen.
3. **The walk** sends the initials for a stop whose `mark` is `initials`.

⚠ The renderer needs **no** change: it draws `signed_name`, which becomes the initials.

### 3.2 The field values are not drawn

Pages **1, 2, 12, 15 and 16** carry applicant data; `packetOverlay.ts` draws only marks. Wiring it
into `file.ts` today would file **a signed form with empty answers**, which is worse than the summary
it replaces.

⚠ **The method is established and is the same one that produced the mark table** (§4). What does not
exist is the coordinate table for the data fields.

---

## 4. ⚠ HOW TO MEASURE A COORDINATE IN THIS DOCUMENT — the method, because it is not obvious

A heuristic was built first and **does not work**; it is written up in `APPLICATION-PACKET-PLAN.md` §8
so nobody rebuilds it. The packet uses **four layouts for the same act**, and two are
indistinguishable by geometry (p13's caption sits under its line; p25's is boxed with the line to its
right — both are "a label with a rule above it", with opposite answers).

**The loop that works:**

1. `readPacketTemplate()` gives text runs and ruled lines **in page coordinates**.
2. Draw every candidate rule onto the carrier's page in colour with `pdf-lib`, numbered.
3. `pdftoppm -f N -l N -r 85 -png marked.pdf out` and **look at it**.
4. Record the chosen line with a `source` and a `note` saying what the page looks like.

Minutes per page, not seconds, and there is no substitute. `packetMarkGeometry.test.ts` then holds the
choice still by asserting the line **exists in the template at that position** — it cannot check that
the right line was chosen, and says so.

---

## 5. Decisions taken this session

| | |
|---|---|
| **D-PKT13** | The driver adopts ONE mark, **drawn or typed**, once, applied at every stop (owner). ⚠ Does not reverse D-APP8 — the typed name stays the record on every row. "Once" is enforced by `record_packet_mark`, not by the UI. |
| **D-PKT14** | Page 16's blank education/reference lines print a **filler**, not empty paper (owner). They stay optional. **Not built** — it lands with the page fill, because the only code drawing page 16 is in the renderer being replaced. |
| **D-PKT15** | **The walk IS the certification** (owner). `CertifyFields` removed; `certified`/`signed_name` still written to the filed payload but derived from the adopted mark; the server refuses a submission that is not signed through or whose name disagrees with the marks. ⚠ **Counsel still owns whether the packet's own certification language satisfies §391.21(b)(12) on its own.** |

---

## 6. ⚠ Traps this session found, each one measured

- **A guard scoped to our own files cannot check a fact about the carrier's paper** (§2.5, third
  instance). `packetWording.ts` had 33 page numbers one too low under a test that asserted the
  constant against itself. **Closed by #784** — the PDF is in the repo and a test reads it.
- **`streamOf` inflated the CONCATENATED bytes of a multi-stream page**, yielding only the first.
  Invisible because every carrier page has exactly one stream; `pdf-lib` makes four, and the page read
  back **completely empty** — indistinguishable from a renderer that produced nothing.
- **A font with no `ToUnicode` decodes to nothing.** `pdf-lib`'s standard-14 faces carry none.
- **A regex alternative added in the MIDDLE renumbers every capture group after it** — silently turned
  `l` into an operator the reader ignored and emptied every ruled line on every page. Append, never
  insert.
- **A fixture read from `packages/shared/dist` is a fixture from a different commit.** `dist` is built
  only by `build:rn`; the packages resolve to `./src/index.ts`. Cost a false "21 places" alarm.
- ⚠ **Two of my own tests asserted presence and proved nothing** — "shrinks a long name to fit" passed
  with the fitting removed entirely. Mutate every new test.
- **`lint:comment-claims` caught a comment quoting a test title that did not exist.** It works.
- **CI:** `native-android` failures were two different things wearing one name — first a network
  reset, then Google withdrawing the `tools` SDK package. Read the log before retrying.

---

## 7. Owner actions still open

1. **A1 at Resend** — `silvicominc.com` still unverified. Until then invitations go through **Brevo,
   which keeps every live token in a click-tracking log that can be read back**.
2. **A3 is still unexercised** — the one filed application had **zero** document captures, so phone
   capture has never run.
3. **Counsel:** does the packet's own certification language (pages 11, 13, 17) satisfy
   §391.21(b)(12) on its own? (D-PKT15.)
4. **Counsel:** the FMCSA disclosure promises an adverse-action sequence R10 does not perform.

---

## 8. The queue

1. **Q-PKT8 — initials** (§3.1). Migration + adoption + walk. Blocks a correct ceremony.
2. **The field coordinates for pages 1, 2, 12, 15, 16**, by the §4 method.
3. **Wire `packetOverlay` into `file.ts`**, replacing the §391.21 summary for new submissions
   (D-PKT5: `render.ts` is NOT deleted — already-filed records must keep rendering).
4. **D-PKT14's page-16 filler**, with the page fill.
5. Then the owner's device test with a test user.
