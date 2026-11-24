# Driver safety videos and quizzes: analysis (2026-11-24)

**Status:** ANALYSIS. Nothing is built and no decision has been taken. §7 lists the open questions.
**Asked (owner, 2026-11-24):** *"In our Silvicom360 videos we have created a set of videos for drivers,
Safe driving. Now it is time to create new pages and a system for distributing videos, with a
quiz/test after every section in a video. Analyze: all finished videos, separate sections, research
how to create this quiz."*

Sources read: `~/Projects/Silvicom-360-Videos` (output/, docs/PROGRESS.md, SEGMENT-PLAN.md,
VO-SCRIPT-0*.md, video/scripts/assemble-0*.sh), `~/Projects/SILVICOM360 Defensive Driving/*.docx`,
and in this repo `docs/plans/DRIVER-TRAINING-PLAN.md`, `docs/plans/silvicom360/MODULE-0*.md`,
`packages/shared/src/orientationVideosContract.ts` and `featureCatalog.ts` on origin/main.

---

## 1. The finished videos

Every runtime below was measured with ffprobe on 2026-11-24. All are h264 1920×1080 at 24 fps with AAC audio.

| # | Film | File to distribute | Runtime | Size | State |
|---|---|---|---|---|---|
| 01 | Following Too Close | `output/Locked/FILM-01-FOLLOWING-TOO-CLOSE-v13.mp4` | 3:24 | 11.3 MB | **Locked** |
| 02 | Eyes Up | `output/Locked/FILM-02-EYES-UP-v3.mp4` | 3:13 | 11.4 MB | **Locked** |
| 03 | Boxed In | `output/Locked/FILM-03-BOXED-IN-v2.mp4` | 3:16 | 11.3 MB | **Locked** |
| 04 | Four Times | `output/Locked/FILM-04-FOUR-TIMES-v4.mp4` | 3:34 | 17.6 MB | **Locked** |
| 05 | Plain Sight | `output/Locked/FILM-05-PLAIN-SIGHT-v10.mp4` | 3:37 | 15.9 MB | **Locked** |
| 06 | Crossings | `output/FILM-06-CROSSINGS-review-v2.mp4` | 3:17 | 10.3 MB | **In review, not approved.** v1 was rejected on six counts (D-231). |

- **Five films are finished: Act I, about 17 minutes in total.** Each film earns one token of the "Principle Bar":
  **SPACE · VISION · POSITION · SPEED · SEEN**.
- **Do not distribute the files in `output/*-v1.mp4`.** They are the original renders, kept only as a
  record of what was shipped. `plain-sight-v1.mp4` cuts one narration line short (D-203).
- The rest of the series is a proposal: films 07–14 (Act II places, Act III conditions, Act IV one
  trip). `SEGMENT-PLAN.md` estimates about 51 minutes for all 14 films. The same plan proposes
  remastering 01–05 after 06.
  **The system has to expect a film to be replaced by a newer version.** See §5, versions.
- **No captions or transcripts exist** (no .srt or .vtt files anywhere). Captions are needed for
  accessibility (WCAG 1.2.2) and for any Spanish version. Each film's narration is in its
  `VO-SCRIPT-0N.md` file, but those files also hold lines that never made the final cut. Example:
  film 05's locked cut plays n1–n5, n7–n9, n11, n12, n14, n16 and n17. n6, n10, n13 and n15 are
  in the script but **not spoken**. So captions should be transcribed from the locked file, as
  D-72 did with mlx-whisper, and not copied from the script.

### ⚠ Three curricula disagree

| Source | Shape |
|---|---|
| `Silvicom360_Defensive_Driving_System_Plan.docx` (Aug) | 10 modules, 8–12 min each, six **SILVIC** principles |
| `docs/plans/silvicom360/MODULE-01…06.md` (repo) | Detailed specs for those 10 modules (planning baseline, not approved) |
| **The films that actually exist** | 14 films of 3–4 min, five principles **SPACE/VISION/POSITION/SPEED/SEEN** |

The films are the thing that exists and was approved. **Recommendation:** the training system's
catalogue follows the films (course = act, lesson = film), and the SILVIC module documents are
treated as design input only. That needs the owner's word (Q-TR1).

---

## 2. Sections in each film

Every film is built from 14–15 rendered sequences that are joined with 0.5 s dissolves. The start
times below are computed from the sequence files, and they add up to each locked runtime to within
0.1 s. Film 06 is 1 s off because its v2 was rebuilt (D-231).

Each film already has the same three-part shape: **the problem → why it happens (the manual's
numbers) → the habit (three steps)**. Those three parts are the natural **chapters**.

| Film | Chapter 1 | Chapter 2 | Chapter 3 |
|---|---|---|---|
| **01 Following Too Close** | 0:08 **Why space**: the gap; 419 ft stop at 55; empty is worse | 1:26 **Count it**: see the lane, mark, count, where 8 s comes from | 2:25 **What it costs**: time, momentum, someone takes the gap → rebuild · end 3:16 |
| **02 Eyes Up** | 0:08 **Fixated**: what a bumper tells you, and late | 0:52 **How far**: 12–15 s / a quarter mile, picking the point, reach vs cushion, the lights ignite | 1:35 **The habit**: pick the point · work it back · call it early; then 2:16 heavy traffic, read around, the early lift · end 3:04 |
| **03 Boxed In** | 0:08 **The box**: four sides; "you may be trapped"; the pedal is not the answer | 1:26 **How it forms**: nobody moves, you drift | 1:49 **The habit**: see the box · open a side · keep it open; which side; what the fix costs · end 3:06 |
| **04 Four Times** | 0:08 **Speed and distance**: 419 ft assumes ideal; 2× speed = 4× braking | 1:11 **Traction**: wet −⅓, snow −½, ice = park, water at 30 mph, empty | 2:29 **The habit**: read the surface · take it off early · stop in what you see · end 3:24 |
| **05 Plain Sight** | 0:08 **Telling them**: signal early, before you move, brake taps, don't wave through | 1:40 **Checking**: mirror blind areas, the curved mirror, four checks, don't sit alongside | 2:51 **Night and the habit**: headlights at dawn, dusk and in rain; the three steps · end 3:28 |
| **06 Crossings** | not approved, so no chapters until it is locked | | |

The exact sequence start times, which become the chapter marks in the player:

```
01  Intro 0:00 · A 0:08 · Stop 0:37 · Empty 1:10 · Bridge 1:19 · Sight 1:26 · Mark 1:34 · Count 1:48 · Standard 2:12 · Time 2:25 · Momentum 2:50 · Taken 3:06 · Rebuild 3:12 · End 3:16
02  Intro 0:00 · Fixated 0:08 · Bumper 0:24 · Standard 0:38 · Point 0:52 · Reach 1:07 · Ignition 1:21 · Method 1:35 · Sweep 1:43 · Call 1:59 · Heavy 2:16 · Around 2:25 · Lift 2:42 · Compare 2:56 · End 3:04
03  Intro 0:00 · BoxA 0:08 · BoxName 0:25 · Manual 0:43 · Why 0:55 · Pedal 1:11 · Form 1:26 · Drift 1:38 · Method 1:49 · Steps 1:57 · Sides 2:22 · Fix 2:39 · Out 2:50 · Red 2:55 · End 3:06
04  Intro 0:00 · Scale 0:08 · Ideal 0:23 · Ladder 0:39 · Square 0:58 · Traction 1:11 · Wet 1:24 · SnowIce 1:40 · Water 1:56 · Empty 2:13 · Method 2:29 · Drill 2:38 · See 3:04 · End 3:24
05  Intro 0:00 · Sight 0:08 · TwoWays 0:26 · Tell 0:40 · Before 0:55 · Wall 1:10 · Wave 1:24 · Mirrors 1:40 · Lies 2:02 · Checks 2:18 · Unseen 2:35 · Night 2:51 · Habit 3:06 · End 3:28
```

---

## 3. Where to put the quiz: research

**Short quizzes placed between parts of a video measurably improve learning.** This is called
"interpolated testing".

- Szpunar, Khan & Schacter: memory tests placed between parts of an online lecture **reduced mind
  wandering and improved learning**. The usual study design has segments of about 5 minutes with a
  short quiz after each.
- The quiz must be **about the part just watched**. Review slides or unrelated tasks between
  segments did not help ([Behavioral Sciences 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12109270/)).
- Online, with 703 learners, in-lecture quizzes beat review slides, and the benefit shrank when
  other things on screen distracted the learner
  ([Communications Psychology 2025](https://www.nature.com/articles/s44271-025-00234-5)).
  For a driver, that means a full-screen player with nothing else on screen.
- Another study found a benefit from quizzing after each segment, but **not** when a learner only
  watched a short portion before being quizzed
  ([APA, J. Exp. Psych: Applied](https://www.apa.org/pubs/journals/features/xap-xap0000087.pdf)).

**What this means for our films.** Each film is 3:13–3:37 long, so **one film already is one "segment"**.
Splitting a 3.5-minute film with three quizzes would put a quiz roughly every minute. That is
more interruption than the studies tested, and it breaks films that were edited to play straight through.

**Recommendation (Q-TR2):**
1. **A quiz after every film:** 5 questions drawn from a pool of about 10. Pass with 4 of 5 (80%,
   the owner's July rule, R1/R2 in `DRIVER-TRAINING-PLAN.md`).
2. **One "checkpoint" question at the start of the habit chapter**, with the video paused. It asks
   the question the film is about to answer, for example *"What would you do first?"* This matches
   the template the docx plan already specified ("Pause for a driver decision question"). It is
   ungraded and only primes the driver for the answer.
3. **Each question is tagged with its chapter.** A miss sends the driver to rewatch **that chapter**,
   not the whole film. The July rule R2 resets the whole segment, which is too punishing for a
   3-minute film. This loosens an owner rule, so the owner has to approve it (Q-TR3).
4. **An end-of-course test after the act** (Act I: 10 questions, scenario-heavy, pass 80%). The docx
   plan's "Silvicom360 Qualified Driver" record is written from that test.

### Question types that suit these films

| Type | Use | Example |
|---|---|---|
| **Scenario + still frame** (most of the pool) | The boards are drawn in Remotion, so a still is **rendered from the same composition**, with no new art | still from 03 Form: *"Nobody changed lanes. What happened?"* |
| Single choice, 3–4 answers | Numbers and rules the film says out loud | *"At 55 on a dry road, from seeing to stopped?"* → 419 ft |
| Put in order | The habits and the four checks | 05: room → after signal → right after beginning → once across |
| Tap the spot (v2) | Blind areas and the far point | Tap where the flat mirror shows nothing |

True/false is left out on purpose: a driver gets half of those right by guessing.

### Rules every question must follow (from the videos project's own rules)
- **It may only ask about something the locked cut actually SAYS or SHOWS.** It must quote the
  narration line ID and timestamp. See film 05 in §1: lines in the script are not always in the film.
- **No new facts.** Every number comes from the film, which already traced it to the CDL manual or
  FMCSA (the facts pass, D-220).
- Each wrong answer is a mistake drivers really make, so it teaches something. Every answer has a
  one-line "why" and a link that plays the chapter it comes from.

### Sample questions (every one taken from a spoken, locked line)

| Film | Question | Correct | Wrong answers | Source |
|---|---|---|---|---|
| 01 | Loaded truck, dry road, 55 mph. How much road from seeing a hazard to stopped? | 419 ft | 200 ft · 300 ft · 600 ft | m2 · 0:37 |
| 01 | You're running empty. Your stop is… | Longer: less weight, less traction | Shorter · The same | m3 · 1:10 |
| 01 | The car ahead passes a sign. You count to 6 before your bumper reaches it. You… | Ease off until you reach 8 | Keep going, 6 is fine · Change lanes | m6–m7 · 1:34 |
| 01 | A car cuts into your gap. You… | Rebuild the space | Close up so it can't happen again · Flash your lights | m11–m12 · 3:06 |
| 02 | How far ahead do most good drivers look? | 12–15 s, about a quarter mile at highway speed | 4 car lengths · 3 s | n3 · 0:38 |
| 02 | Heavy traffic, a trailer fills the windshield. You… | Read around it: the lanes beside you, under it, the shoulder | Watch its brake lights · Nothing to see | n11 · 2:25 |
| 03 | Why does the manual say a box is dangerous? | You may be trapped when you need to change lanes | You might get a ticket · Sideswipes | n3 · 0:43 |
| 03 | The cheapest way to open a side is… | Come off the throttle and let the pack go | Change lanes · Speed up | n9 · 1:57 |
| 04 | You go from 20 to 40 mph. Braking distance is… | 4× longer | 2× longer · The same | n3 · 0:39 |
| 04 | The road turns wet at 55. You slow to about… | 35 | 50 · 45 | n6 · 1:24 |
| 05 | When does the signal go on for a lane change? | Before you move | As you move · Once you're across | n4 · 0:55 |
| 05 | Put the four lane-change checks in order | room → after signal → right after beginning → once across | ordering | n11 · 2:18 |
| 05 | A car in the curved mirror is… | Closer than it looks | Exactly where it looks · Farther than it looks | n9 · 2:02 |

The full pool, about 10 questions per film or 50 for Act I, is the next written work product. A
safety person has to sign it off before release (docx plan §11, phase 3).

---

## 4. What already exists in Silvicom 360

| Fact (origin/main, 2026-11-24) | Meaning |
|---|---|
| `training` is in `featureCatalog.ts` with `released: false`, labelled "Courses and quizzes under More" | The driver-app switch exists. **Build behind it and turn it on at the end.** |
| The `training` module entitlement exists (`entitlements.ts`) | No new product key |
| **Orientation videos (0539):** links in Settings → Recruiting, the applicant ticks "I watched these", and the step gates hiring when `videos_block_hire` is on | A hiring step already **wants** these films, but it can only see "Opened", never "Watched" (its own comment says so). That comment calls the micro-LMS "the later version". This analysis is that later version. |
| `DRIVER-TRAINING-PLAN.md` (July, "LOCKED with Miki") | Good rules: immutable published versions, server-side grading, watched ranges, question pools, append-only events, 3-year retention, watermark. **Stale parts:** migration numbers 0079–0081 (we are at 0642), a Vue-only player (the driver app is Expo now), Supabase Storage for video (we are on AWS) |
| No `expo-video` in the driver app, no training tables, routes or pages | Everything else is new |

---

## 5. Proposed system (for the owner to react to, not yet a build plan)

**Three surfaces, one record.**

1. **Driver app → More → Training** (the main channel, behind the `training` switch). It shows the
   course list and each film with chapter marks, plays the video, asks the checkpoint question, then
   gives the quiz and shows the result. The player has no forward-seek on a first watch but
   **resumes where the driver left off**. Watching is allowed **only while parked**
   (49 CFR 392.80 and the Module 1 spec both ask for this). How the app knows the truck is parked,
   from Samsara or from phone motion, is not verified yet and has to be checked before building.
2. **Office web → Safety → Training:** assign a course or one film to drivers (new hire, annual,
   after an event), see progress per driver ("watched 3:12 of 3:24 · quiz 4/5 · passed 11/24"),
   see overdue drivers, export the completion record.
3. **Applicant link** (a driver who is not hired yet and has no app): the same player on the web,
   on the invitation's link. **This replaces the orientation-video tick** with a measured "watched +
   passed". That is the hiring step's own stated next version.

**Versions.** A lesson points to a **published film version** (for example `FILM-01 v13`). A remaster
publishes v14 and never edits v13, so a record always says which cut and which questions a driver
passed. This is also why the remaster planned in `SEGMENT-PLAN.md` is not a problem.

**Video delivery.** The files are small (10–18 MB for each 1080p film). The plan is private S3 on
the AWS account we already run, with short-lived signed CloudFront URLs, plus a 720p rendition for
weak phone signal. Rough cost: 200 drivers × 6 films × 2 views × ~15 MB ≈ 36 GB a month, which is
a few dollars on CloudFront.
Cloudflare Stream is the managed alternative ($5 per 1,000 minutes stored, $1 per 1,000 minutes
delivered: ~20 stored minutes and ~8,000 delivered minutes a month comes to about $13). It adds a
vendor, though, and we are AWS-only (Q-TR5).

**Grading on the server only.** Correct answers never reach the phone. The exact questions served
and their order are stored with each attempt (R5/R6 from the July plan).

---

## 6. Build order, if approved

0. **Content first, no code:** captions/transcripts from the locked cuts, chapter marks (§2),
   question pool for 01–05, and stills rendered from the boards. Safety person signs off.
1. Schema migration: courses, versions, lessons, chapters, questions, assignments, attempts, events.
   All with RLS, evidence tables append-only and listed in `RETENTION_FORBIDDEN`.
2. API: office authoring, assignment and reports; learner progress and grading.
3. Driver app player (`expo-video`, native rebuild) and quiz.
4. Office web pages.
5. Applicant web player, and the orientation step reads it.
6. Pilot with a few drivers, then turn on `training`.

---

## 7. Open questions for the owner

| # | Question | Candidates | Recommendation |
|---|---|---|---|
| Q-TR1 | Which curriculum does the system follow? | (a) the films: acts and films · (b) the docx 10 SILVIC modules | **(a)**. The films exist and the modules do not. |
| Q-TR2 | Quiz after each **film** or after each **chapter**? | (a) after each film + 1 ungraded checkpoint · (b) graded quiz after every chapter (3 per film) | **(a)**. The films are already the length the studies use for one segment. |
| Q-TR3 | What happens on a fail? | (a) rewatch only the chapters missed, then retake · (b) July R2/R3: rewatch the whole film, reset after 3 fails | **(a)** for 3-minute films. It loosens a rule you locked in July. |
| Q-TR4 | Ship film 06 now, or only 01–05? | | **01–05.** 06 is not approved. |
| Q-TR5 | Where the video lives | (a) AWS S3 + CloudFront · (b) Cloudflare Stream | **(a)**: AWS-only rule, small files |
| Q-TR6 | Languages | English only · English + Spanish (narration re-recorded or subtitles only) | Needs your answer. Captions are needed either way. |
| Q-TR7 | Who must take it, and when | new hires before first dispatch · all drivers yearly · after an event | Needs your answer |
| Q-TR8 | Does a hire wait on it? | Replace the orientation-video tick with "watched + passed" | Yes, behind the existing `videos_block_hire` switch |

---

## 8. Owner's direction, 2026-11-24 (second message), and the design that follows

> *"We will store these videos on our storage (the one we use for documents). We need this quiz to be
> highly manageable on pages, so we can select a driver (from our database) and use his phone number
> to send a link with a portal where this will be played. Also we need the UI/UX on portal pages to
> be easy to use, and we need to make sure this is optimized for low internet signal. Also the system
> should be created so we can easily add more videos and sections."*

**Rulings this records:**
- **D-TR1:** videos live in **our Supabase Storage**, the same storage `compliance-docs` and
  `document-intake` use, in a private bucket of their own (`training-media`). That settles Q-TR5 and
  replaces the CloudFront option. A separate bucket gets its own size limit (the films are 10–18 MB and
  `document-intake` caps files at 25 MB) and stays out of the evidence buckets' retention rules.
  Supabase Storage is S3 in us-west-2, so this still runs on AWS.
- **D-TR2:** the primary channel is **a link texted to the driver's phone that opens a web portal**,
  with no app and no login. That reverses §5's "driver app first": the driver app becomes a later,
  optional door to the same portal.
- **D-TR3:** the office picks drivers from **our own `drivers` table** on a Training page.
- **D-TR4:** the portal is built for **weak signal** first.
- **D-TR5:** the catalogue is **data, not code**. Courses, videos, chapters and questions are added
  on the page with no developer, the July plan's D3.

### 8.1 ⚠ The blocker: texting company drivers is not allowed today

This has to be settled before "use his phone number" can work for **hired** drivers. It is the
same blocker the dispatch text has (`dispatchToDriver.ts`, LOADS-MIRROR Q-LMR9):

- **No number may carry it.** The recruiting toll-free number is verified for *applicant* texts
  only ("HR / Staffing", HOME-TIME-PLAN §7.1). A text outside a number's filed use is how a number
  gets blocked for everyone on it. The `staff_alerts` number is for office staff alerts.
- **No consent covers it.** `SMS_CONSENT` is worded "messages about your own application". A driver
  on the roster has agreed to nothing for training texts.
- **Applicants are fine today.** Orientation videos are part of the application, and
  `smsOrientationVideos` already exists in `applicantMessages.ts`. An applicant can be texted the
  portal link on the existing number and consent, exactly as the current link list is.

**Q-TR9: how hired drivers get texts.** Candidate answers:
- **(a)** A third toll-free number, verified for "driver operations: training, dispatch, safety
  notices", plus a driver consent collected once. This also unblocks dispatch texts (Q-LMR9).
  It costs about $1 a month and roughly a week of verification.
- **(b)** Send the link by email, or let the office copy the link and send it themselves, until (a)
  is done.
- **(c)** Text it from the applicant number anyway. **Refused:** that is the workaround the number's
  filing forbids.

**Recommendation:** (a), with (b) as the meantime path. It is built so that when (a) arrives the
Send button starts texting with no other change. The mockup shows exactly this: a "Can we text?"
column and a notice above the list.

### 8.2 Low signal, measured

Film 01 (3:24) was re-encoded on 2026-11-24 (H.264 main profile, mono AAC, `+faststart`):

| Version | Whole film | Average rate | Text on the boards |
|---|---|---|---|
| Locked master 1080p | 11.3 MB | ~440 kbps | sharp |
| **720p** | 4.4 MB | 170 kbps | sharp |
| **540p** | 3.0 MB | 115 kbps | sharp (checked on a frame at 2:20) |
| **360p** | 2.1 MB | 84 kbps | readable, small print soft (same frame) |

The films are flat, drawn boards, so they compress very well. **Even 360p is enough to read the
numbers.** On 3G of about 400 kbps, 540p plays without stopping. On 2G-like edges (about 100 kbps)
360p does.

**The portal's rules for weak signal:**
1. **Three MP4 versions per film, made on upload.** The API image already has ffmpeg with libx264
   and AAC (`infra/image/Dockerfile`, for motion ads), so no new dependency. Plain MP4 with
   `+faststart` instead of HLS: a 2–4 MB file does not need adaptive streaming, every phone plays it,
   and it is one object per version in Storage.
2. **The portal chooses the version** from `navigator.connection` where the browser has it, and
   from how fast the first seconds arrived where it doesn't. The driver can switch with
   "Low data / Normal".
3. **The page itself is tiny.** One small HTML and JS bundle with no web font (system fonts) and no
   map or chart libraries, a poster image of about 9 KB, and the video only when they press play.
   It is not the main web app bundle. **Budget: under 100 KB before the video**, checked by a gate
   (Q-TR10).
4. **Resume to the second.** Progress is saved every 10 s and on pause or close. Tapping the link
   tomorrow starts where they stopped.
5. **No signal does not lose work.** Answers and progress queue on the phone and are sent when the
   signal returns. The server grades. If the driver closes the page while offline, the attempt
   continues from what reached the server.
6. **The whole film can be saved for a dead zone.** A "Download for offline" button is allowed only
   on the portal's own cache, never as a file. This is optional and for later.

### 8.3 Easy to add more: the catalogue model

```
course (e.g. "Defensive driving · Act I")      ← add on the page
  └─ lesson = one video, in order               ← add on the page: upload MP4
        └─ version (immutable once published)   ← re-upload = new version; records keep the old one
              ├─ chapters  [{title, starts_at}] ← click on the film's timeline to mark
              ├─ files     360/540/720 + poster + captions (made by the server)
              └─ questions (pool) → each tagged with its chapter, 1 right + 2–3 wrong + "why"
assignment  (driver × course or single lessons, due date, link token)
attempt     (served questions + order, answers, score, watched ranges) — append-only, never deleted
```

**Adding film 07 is four steps on one page:** upload, mark chapters, write questions, publish. A
course is a list, so Acts II–IV are new courses or new lessons in the same course. When a remastered
01 is published as v14, drivers who passed v13 keep that record, and it names v13.

### 8.4 The link

The same pattern as the applicant links, and it reuses their rules: a **per-driver token**, stored
**only as a hash**, with an end date, revocable, and re-sending replaces the token
(`applicationLink.ts`). It opens only that driver's training, nothing else.
The path is `/t/<token>`, kept short because SMS characters count. Video files are reached only
through signed Storage URLs that last minutes. The token grants nothing else. A copied link shows
the driver's name on the first screen, which discourages sharing.

### 8.5 Updated open questions

| # | Question | Status |
|---|---|---|
| Q-TR1 | Follow the films, not the 10 SILVIC modules | Open. Your message assumes films; please confirm |
| Q-TR2 | Quiz after each film + one checkpoint, chapters for rewatch | Open (recommended) |
| Q-TR3 | A fail means rewatch only the missed chapters | Open (recommended) |
| Q-TR4 | Publish 01–05 only | Open (recommended) |
| Q-TR5 | Storage | **Ruled D-TR1: our Supabase Storage** |
| Q-TR6 | Languages | Open |
| Q-TR7 | Who must take it, and when | Open |
| Q-TR8 | Hiring waits on "watched + passed" | Open (recommended yes) |
| **Q-TR9** | How hired drivers get texts (§8.1) | **Open, blocks texting hired drivers** |
| Q-TR10 | Portal size budget as a CI gate | Open (recommended yes) |

### 8.6 Build order (revised for D-TR1…5)

1. **Migration:** the catalogue, assignment and attempt tables, plus the `training-media` bucket.
   RLS deny-all (API only), and attempts plus events in `RETENTION_FORBIDDEN`.
2. **API, office side:** upload with signed upload URL; transcode to three versions and a poster with
   ffmpeg in the worker; chapters, questions and publish; assign and send (email/copy now, SMS when
   Q-TR9 lands, applicants by SMS today).
3. **API, portal side:** resolve the token, then lessons, progress heartbeat, a quiz served without
   answers, and server-side grading.
4. **Web, office:** Safety → Training with Videos, Send and Progress (the mockup's three tabs).
5. **Web, portal `/t/:token`:** its own small entry, the low-signal rules in §8.2, and Playwright
   specs against a stubbed API (the `e2e-apply` pattern).
6. **Content:** captions from the locked cuts, the question pool for 01–05, a pilot with 3–5 drivers.
7. **Hiring step** reads "watched + passed" instead of the tick (Q-TR8).

**Mockup:** `docs/plans/training/mockups/training-mockup.html`, checked in Chromium on 2026-11-24.
It has the office's Videos, Send and Progress tabs, and the driver's phone: list, player with
chapters, quiz with the reason after each answer, and a fail that sends the driver back to the
missed chapters. The signal switch is included. Its `media/` folder (posters and a 360p film 01) is
gitignored, because the repo is public.

---

## 9. Owner: "Ok proceed as proposed" (2026-11-24)

Each question takes the recommended answer above:

| # | Ruling |
|---|---|
| **D-TR6** (Q-TR1) | The catalogue follows the **films**: course = act, lesson = film. The SILVIC module documents are design input only. |
| **D-TR7** (Q-TR2) | **A quiz after each film**: 5 questions drawn from the film's pool, plus one ungraded checkpoint question at the habit chapter. Chapters exist so a driver can rewatch them. |
| **D-TR8** (Q-TR3) | **Pass = 4 of 5 (80 %)**. A fail reopens only the chapters of the missed questions. The quiz unlocks again once those chapters are watched. This loosens July R2/R3 for these films; nothing ever resets a whole course. |
| **D-TR9** (Q-TR4) | Publish **01–05**. 06 is added on the page once it is approved. |
| **D-TR10** (Q-TR8) | Hiring's orientation step reads **"watched + passed"**, behind the existing `videos_block_hire` switch. |
| **D-TR11** (Q-TR9) | **(a)** a driver-operations texting number plus a driver consent. Until both exist, **(b)**: email, or the office copies the link. Applicants are texted today, on their own number and consent. |
| **D-TR12** (Q-TR10) | The portal's size budget becomes a gate. |

Q-TR6 (languages) and Q-TR7 (who must take it, when) had no recommendation, so they are **not**
ruled. The build does not need them: v1 is English, and the office assigns by hand. A version row has
a `language` column, so a Spanish cut is a second version and not a schema change.

### 9.1 Progress log

- 2026-11-24 — Rulings recorded. Build starts with this plan PR, then schema + contract, API, office page, portal.
