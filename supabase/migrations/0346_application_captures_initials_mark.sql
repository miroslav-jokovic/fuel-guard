-- Let a driver's INITIALS be a picture too (Q-HUI14, answering it with candidate (a)).
--
-- ── WHAT C2 LEFT HALF-DONE, AND WHY IT COULD NOT BE FINISHED THERE ────────────────────────────
-- C2 (D-HUI14, PR 899) made every adopted SIGNATURE a picture: the driver's chosen hand, drawn or
-- uploaded, rasterised in the browser, staged into `application_captures.slot = 'signature_mark'`
-- and drawn onto the carrier's packet by `renderPacketOverlay`'s `embedPng`. The three initials
-- lines — p05, p06, p09 — were left printing typed `StandardFonts.HelveticaOblique`, because
-- `takesDrawing` in that renderer is `mark === 'signature'` and this CHECK had nowhere to put a
-- second picture.
--
-- That exclusion was not an oversight either. A3 added it after a driver who chose to draw got their
-- full autograph stamped at 141pt into a box the carrier had captioned `Initials`. ⚠ **The rule it
-- encodes stays exactly as it is** — D-PKT6: initials are a SECOND adopted mark and not an
-- abbreviation of the first, so the SIGNATURE picture must never land on an initials line. What
-- changes is that the initials get a picture of their OWN, and the renderer chooses between the two
-- by `PacketPlacement.mark` rather than choosing between one picture and nothing.
--
-- ── ⚠ WHY THIS IS ITS OWN MERGE, WITH NO CODE IN IT ───────────────────────────────────────────
-- `lint:migration-ordering` **cannot see this one**: it tracks added COLUMNS and renames, and
-- widening a CHECK adds neither, so it passes this PR either way. The hazard is real and points the
-- other way from the #430 outage that gate was built for — that was a READ against a column the
-- database did not have yet; this would be a WRITE of a value the CHECK does not accept yet.
--
-- Railway serves a merge about 2m44s in while `migrate.yml` waits for CI green, so a merge can be
-- served against the previous schema (`docs/MIGRATION-DISCIPLINE.md` §the-deploy-window). Ship the
-- staging call in the same merge and, for that window, every applicant who adopts a mark gets a 500
-- from Postgres on the initials upload — on the one screen in this product whose entire job is to be
-- believed. So: this merge widens the constraint and names the value nowhere else; the writer
-- follows once `/api/version` reports `schema.state = "current"`. The discipline is applied by hand
-- here precisely because no gate is watching.
--
-- ── AND WHY A SEVENTH SLOT RATHER THAN REUSING `other` ────────────────────────────────────────
-- ⚠ `application_captures` holds ONE ROW PER SLOT (0230's unique constraint, which is what makes a
-- re-shoot a replacement rather than a fourth row in a qualification file). `other` is already the
-- escape hatch and the signature mark already maps to the `other` document kind, so putting the
-- initials there would make the two marks compete for a single row: adopting initials would silently
-- delete the signature picture, and the packet would file with nineteen typed lines and three drawn
-- ones. The slot vocabulary is closed on purpose and this is what adding to it is for.
--
-- ⚠ It is NOT added to `APPLICATION_CAPTURE_REQUESTED` in the follow-up either. That list is what the
-- capture screen asks a driver to photograph, and 0230's own comment plus
-- `applicationCaptureContract.ts` both say why `signature_mark` is absent from it: a slot inviting
-- somebody to photograph a signature collects a photograph of a piece of paper. The initials mark is
-- written by the signing ceremony, like its sibling, and by nothing else.

alter table public.application_captures
  drop constraint if exists application_captures_slot_check;

alter table public.application_captures
  add constraint application_captures_slot_check
  check (slot in (
    'cdl_front','cdl_back','medical_card','ssn_card','signature_mark','initials_mark','other'));

comment on column public.application_captures.slot is
  'The closed slot set. ''signature_mark'' and ''initials_mark'' are written by the signing ceremony '
  'rather than by the capture screen (D-HUI14, Q-HUI14): each holds the PNG the driver adopted for '
  'that kind of mark, and `renderPacketOverlay` picks between them by the placement''s own '
  '`PacketPlacement.mark`, so a signature can never land on one of the three initials lines. The '
  'other five are photographs; ''other'' is the escape hatch and must not be used for a third mark, '
  'because one row per slot means two marks sharing a slot would overwrite each other.';
