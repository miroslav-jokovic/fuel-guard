# HANDOFF: the real-phone walk of the live scanner, all four Part 1 photo screens

The in-page live scanner now handles all four Part 1 photos. It has been proven in Chromium with a fake camera,
but never on a real phone. This session walks it on two real phones with the owner, records what happens, and
fixes anything that fails.

## Where things stand

- main = `7689962` (merge of #1180). Both Railway services were serving it at 2026-09-30 21:32 CDT. Check again
  before starting:

  ```
  curl -s https://fleetguardweb-production.up.railway.app/api/version
  curl -s https://fleetguardapi-production.up.railway.app/api/version
  ```

- #1177 added the live scanner for the CDL. #1179 gave it the owner-approved ID-scanner look. #1180 extended it
  to the medical card and the selfie (owner ruling Q-AW53).
- This was never tested on real phones. The plan's progress log ends with "Still owed on real phones (§9), now
  for all four".

## What each screen should do

- **CDL front:** rear camera, card-shaped corner brackets, "Front — the side with your photo". Taken by the
  shutter after the phone settles.
- **CDL back:** same frame, "Back — the side with the barcode". A sweep line runs while it reads the barcode, and
  it takes the photo itself once the PDF417 reads. The shutter is the fallback for a worn barcode.
- **Medical card:** rear camera, portrait letter-page frame (8.5 × 11), "Your DOT medical examiner's
  certificate". Shutter only. There is no edge detection; the frame is only an aiming guide.
- **Selfie:** front camera, oval frame, "Your face". The preview is mirrored and the saved photo is not. No
  flashlight button. The privacy note and "I can't take a photo of myself" are on the page, not in the scanner.
- **All four:** tips before the first scanner of each kind per visit (document tips once, face tips once).
  "Camera app" and "Upload a photo" are always one press away. After a photo is taken: green brackets with a
  check for 650 ms, then "Use this photo / Retake".

## The walk, on an iPhone (Safari) AND an Android (Chrome), each

The owner holds the phones. Ask for a screenshot or photo for every row, and record each one as pass/fail with
the phone model and OS version.

1. The camera opens inside the page, not as a full-screen player. On iOS the main risk is `playsinline`.
2. The picture clears 1200 px. If the scanner says "too few pixels", note which screen and which phone. On a
   short phone with a 1080p camera, the medical card being refused and sent to the camera app is the expected
   behaviour, not a bug.
3. The CDL back takes itself from a real licence's barcode, and the next screens get filled in ("We read your
   licence's barcode…").
4. The CDL front and the medical card give legible photos. Check them on the "Use this photo" preview: every word
   readable, the page not badly cropped.
5. Selfie: the preview moves like a mirror, and the photo on "Use this photo" is NOT mirrored. Text on a shirt or
   a held card reads the right way round.
6. Lock the phone with the scanner open, then unlock it. The camera comes back.
7. Android only: the flashlight button appears on the rear-camera screens and turns the light on and off; the
   phone buzzes when a photo is taken. The iPhone should show no flashlight button at all, which is correct.
8. Denying camera permission sends the driver to the camera app with a clear message, and "Take photo" then goes
   straight to the camera app.

Then press "Use this photo" on each screen, which tests the #1173 upload fix in production.

You need an application link for a test applicant. §9 item 4 says to use the QA org. Ask the owner how they want
the test invitation created. Don't create applicants or invitations in production yourself.

## After the walk

- Count the stored photos (read-only):

  ```
  supabase db query --linked "select slot, count(*) from application_captures group by slot"
  ```

  It was 0 on 2026-09-30. One row per slot photographed proves the uploads work end to end.
- Record the results as a dated entry appended at the END of the §12 progress log in
  `docs/plans/recruitment/APPLICATION-FLOW-V2-PLAN.md`. Use one line per check per phone, with the device and OS.
  Don't edit table rows.
- Update the memory note `application-flow-v2-position.md`.

## If something fails

- **Code:**
  - `apps/web/src/features/apply/partOne/LiveScanner.vue` — the screen
  - `capture/useLiveScan.ts` — the loop
  - `capture/liveCamera.ts` — getUserMedia, `liveConstraints(facing)`
  - `capture/liveFrame.ts` — `LIVE_SLOTS`, `mirrored`, `viewRectToVideo`, the resolution floor, timings
  - `partOne/PartOnePhoto.vue` — where the scanner is offered
  - `partOne/scannerTips.ts`
- **Setup:** make a fresh worktree from origin/main, then run `pnpm install` and
  `pnpm --filter @silvicom/shared build:rn`, and copy `apps/web/.env` and `apps/api/.env`. Before every commit,
  run `git branch --show-current`.
- **Process:** branch → PR → CI green → read the diff in-session →
  `gh pr merge N --merge --match-head-commit <full sha>` → check `/api/version` on both services.
- **Before pushing:** run every `run:` line in `.github/workflows/ci.yml` and check each exit code, because
  `pnpm -s` hides errors. Run `node scripts/scan-secrets.mjs` after committing. Commit named paths, never
  `git add -A`.
- **Testing:** prove any new test can fail by breaking the code on purpose. Rebuild dist before each browser test
  (`VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=ci-test-anon-key`). Restore files with
  `cp` from a backup, never `git checkout`.
- **Rules that have bitten before:**
  - Use `variant="inverse"` for buttons on the dark scanner, not ghost plus a text class.
  - No `!important` on a primitive.
  - Semantic colour tokens only.
  - Icons come only from `packages/ui/src/icons.ts`.
  - Never `fetch()` a `blob:` URL (CSP).
  - No live "move closer / too dark / glare" prompts (D-SCAN10, Q-AW32).
  - Tailwind 4's `-scale-x-100` sets CSS `scale`, not `transform`.

## Out of scope unless the owner asks

- Q-AW54: a `capture_mode` column so the server can tell scanner photos from camera-app ones. It needs a
  migration, then a separate merge.
- Q-AW53 option (a): edge detection and perspective correction for the medical card.
