# Tutorials: recorded walkthroughs of the real app

Short narrated videos, with subtitles and a written handout, made by driving the **production bundle**
in Chromium. They are not mock-ups or slides. A run films four dispatcher tutorials: Dispatch board,
Loads, Live map and Placard calculator.

```
pnpm --filter @silvicom/web tutorials                      # all approved tutorials
pnpm --filter @silvicom/web tutorials loads live-map       # some of them
pnpm --filter @silvicom/web tutorials --check              # every step + assertion, no camera (~10 s)
```

The live map needs `HERE_API_KEY` for its basemap. From `apps/web`, read it from the API's env file and
keep it off the command line:
`pnpm exec tsx --env-file=../api/.env tutorials/make.ts`.

Output goes to `tutorials/out/<id>/` (gitignored, regenerated on every run):

| File | What it is |
|---|---|
| `<id>.mp4` | 1920×1080 H.264, 30 fps, narration, soft English subtitles |
| `captions.srt`, `captions.vtt` | the same subtitles as sidecar files |
| `instructions.md` + `steps/*.jpg` | the written handout, with one still per step |
| `raw.webm`, `timeline.json`, `narration.json` | the inputs to compose; keep them to re-compose without re-filming |

## 1. How it works

```
scenarios/<id>.ts ──► make.ts ─1─► vite build (VITE_* pinned) ─► build/
                              ─2─► produce/narration.ts ─► one audio file per line (cached by text)
                              ─3─► record.spec.ts + director.ts ─► raw.webm + timeline.json
                              ─4─► produce/compose.ts ─► mp4 · srt/vtt · instructions.md
```

- **The page is real.** It is the production build, served by the API's own `createApp` with
  production's CSP (`serveWebDist.ts`), on port 4195.
- **The person is synthetic.** `session.ts` stores a Supabase session in the browser for "Dana Reyes",
  a **dispatcher**. Every gate in the app reads that role claim, so the sidebar, routes and permissions
  are a dispatcher's, worked out by the real code. Nothing uses `VITE_DEV_BYPASS`: that mode makes an
  admin, and an admin's screens are not a dispatcher's.
- **The data is synthetic, and so is every backend answer.** `stub.ts` answers every request from
  `fixtures/world.ts`: one invented carrier, "Demo Freight Co." Its customers, drivers and dispatchers
  are invented and its email domain is `.example`; only the cities are real. Answers go through the
  product's own contracts (`dispatchBoardResponseSchema`), its rules (`deriveVehicleState`) and, for
  the calculator, its real hazmat engine (`computeCalc`). Whatever is shown is what the product computes.
- **Nothing can be written.** The build knows no real Supabase and no API origin. Any write a scenario
  does not declare is refused, and the run fails. A request nobody stubbed also fails the run. The one
  outbound call is HERE basemap images, cached in `.cache/tiles/`.
- **The clock is pinned** to Tue 10/27/2026 10:30 CT, so a re-recording differs only where the
  product changed.
- **Every step proves itself.** A step's `expect` must pass before the director moves on, so no video
  is ever produced of a click that did nothing.
- **The pace comes from the voice.** Narration is made first. Each step then holds for its line's
  length, and that timeline places both the audio and the captions.

## 2. Adding a tutorial (any agent: Claude Code, Codex, or a person)

No step in this pipeline calls a language model. An agent's job ends at a scenario file.

1. **Discover.** Open the page as the dispatcher and capture what is on it:
   `TUTORIAL_DISCOVER=/assignments,/loads pnpm exec playwright test -c playwright.tutorials.config.ts discover`
   This writes `out/discover/<page>.aria.yml` (the roles and names that locators are written against),
   a screenshot, and any request the world does not answer yet. Read the page's component and its
   plan in `docs/plans/` to learn what each control is for.
2. **Extend the world** if the page reads something new. Add facts to `fixtures/world.ts` and a
   projection to `fixtures/endpoints.ts`, then route the request in `stub.ts`. Use the endpoint's real
   contract. Most `/api` reads return RAW JSON; the `/api/livemap/*` family returns `{ ok, data }`.
   Getting this wrong does not throw an error: the page shows its loading skeleton for ever.
3. **Propose.** Write `scenarios/<id>.ts` with `status: "proposed"` and add it to `scenarios/index.ts`.
   Each chapter is a few steps, and each step is `{ say, act?, expect }`:
   - `say`: one or two plain sentences for a dispatcher. Write numbers the way a person says them
     ("ten forty-two", "D F two oh four one eight"), because the voice reads the text literally.
   - `act`: `click`, `point` (move and ring, touch nothing), `type`, `press` or `goto`, with locators
     by role and name. Prefer `getByRole`; scope a locator to `main` when the sidebar has the same name.
   - `expect`: what the page must show afterwards. It is required.
4. **Check.** Run `tutorials --check <id>`: every action and assertion runs in seconds.
5. **Approve.** A person reads the script, changes `status` to `"approved"`, and runs `tutorials <id>`.

Never let a scenario press a button that changes a record (Dispatch, Save, Send). Point at it and
say what it does. The stub refuses the write anyway, and the run fails.

## 3. After the app changes

Run `tutorials --check`. CI runs it too, in the `bundle` job, so a PR that moves something a tutorial
points at goes red until the scenario follows. A tutorial that fails names the step and the locator. Fix the scenario, or the
world when the product reads something new, then regenerate only that tutorial. Unchanged lines reuse
their cached audio.

## 4. Voices

`TUTORIAL_VOICE` selects the voice provider. `say` is the default: macOS's built-in voice, free and
offline, good for drafts. `higgsfield` is the voice used in the maintenance proposal video; it needs
the `higgsfield` CLI signed in, and it costs credits. `silent` makes no audio and estimates each line's
length from its word count. `TUTORIAL_VOICE_NAME` picks a voice within the provider.

## 5. Traps already paid for

- **No trace while filming.** A trace runs its own screencast, and the screencast that is already
  running wins, so a 1920×1080 recording comes out as an 800×450 page in a grey frame. The config
  turns tracing off when `TUTORIAL_MODE=record`.
- **The build folder must not start with a dot.** Express's `send` refuses dot-directories, so the
  server answers `/` with a 404.
- **`.env` must not reach the build.** A local `VITE_API_URL` points at an origin the CSP refuses, which
  leaves a blank page with "Failed to fetch". `make.ts` pins every `VITE_*` value.
- **The page-view beacon** (`POST /api/page-views`) fires once a minute, so recordings meet it and
  checks never do. It is answered and discarded by name, in `BACKGROUND_BEACONS`.
- **The Placard calculator starts switched off for every role** (Q-PR2). The demo org grants it to
  dispatchers in its `/api/me` surfaces, the way an admin would under Settings → Permissions.
