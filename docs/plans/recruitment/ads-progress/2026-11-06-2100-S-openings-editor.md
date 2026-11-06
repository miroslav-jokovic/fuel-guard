**2026-11-06 · Track S · openings-editor (Q-AD43 (b), Q-AD44 (a) — built)**

Two PRs, as the step asked for anything over ~500 lines:

- **#2111 (merged `f0f31b6`) — place search.** `GET /api/recruitment/place-suggest`, recruiting's own route
  (`modules/recruiting/routes/placeSuggest.ts`) under `requireSection("recruitment", "view")`, calling routing's
  `geocodeSuggest` through routing's index: one HERE client, the same Nominatim fallback, the same general `/api`
  limiter as the fueling door, whose `dispatch: view` gate is unchanged. `recruiting -> routing` added to
  `API_ALLOW` with its why. Pinned by `placeSuggest.test.ts` (a role with `dispatch` but no `recruitment` is
  refused before the geocoder is asked) and the ledger's "recruiting's place search asks the recruitment section,
  not dispatch". `PlaceSuggestion` is the shared answer type (`opening.ts`).
- **This PR — Recruitment › Openings.** A tab between Leads and Campaigns (`/recruitment/openings`, surface
  `recruitment.openings`, parent Applicants). List: title, status badge, version, last saved by/at; kebab moves the
  status over `POST /:id/status` (manage only). Drawer: "Save as version N" over `POST /openings`; fields and
  bounds from `openingSaveSchema` / `adAreaSchema` (radius hint reads `adAreaSchema`'s 15–500), pay typed in
  dollars and sent in cents, the point only from the place search. Hiring-profile step: offers each live
  profile's newest version; with none, shows the `defaults` the API sent read-only and "Save as the first hiring
  profile" over the existing POST, the saved version then picked. Shared `OpeningView` / `HiringProfileView` type
  the two list answers (additive).
- **Checks:** 16 mutants, each one exact string, all killed and every file restored byte-identical; browser pass
  fail / empty / saved at 1280 + 390 (plus the drawer and an open place search), no page errors;
  `surfaceCatalogue.ts` 495 lines.
- **Next:** the staging walk (G-walk 10–17) through this screen.
