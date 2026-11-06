**2026-11-06 · Track S · openings-editor (BLOCKED before building; PR below)**

Q-AD43 ruled (b): Track S builds the Openings editor. The step's rule 1 was to read the doors first, and to stop if
they lack something the screen needs, without extending recruiting's API. They do, so nothing is built, and the
reading is recorded as Q-AD44.

- **What the doors give:**
  - `GET /api/recruitment/openings` (`recruitment: view`) returns each opening's full newest version: title,
    facts, headcount, area, version, who saved it. This is wider than the shared `OpeningListItem` type, which
    names only `title`.
  - `POST /api/recruitment/openings` (`recruitment: manage`, `openingSaveSchema`) saves the next version.
  - `POST /api/recruitment/openings/:id/status` (open / paused / filled / closed) changes the status.
- **What they don't give:**
  - A place search a recruiter may use. The area is a latitude/longitude point (`adAreaSchema`), and the app's
    only geocoder, `/api/fueling/geocode-suggest`, needs `dispatch: view`, which a recruiter and a safety manager
    don't hold.
  - A hiring profile. One is required by `profile_version_id`; the profile door exists, but nothing calls it.
    Staging has 0 profiles and 0 openings.
- **Rec (Q-AD44 a):**
  - a recruitment-gated place search in `modules/routing` (needs an owner);
  - then the editor, offering the existing profiles, or saving the owner's v1 defaults as the first one over the
    existing door.
- **Not done:** the editor, its browser pass and mutants, and the staging walk of G-walk lines 10–17. They all wait
  on Q-AD44.
- **Unclear in the brief:** the step arrived compressed by the shell's output filter. Its last lines ("RELEASE
  WINDOW: HOLD, PR RELEASED. loud-config (stash@{0} loud-config-trackS.patch)") could not be recovered (`rtk
  recall` had no entry). Followed the standing rules there: merge a green PR to main, touch no release, and leave
  the loud-config stash as it is.
