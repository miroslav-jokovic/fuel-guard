**2026-11-18 · Track W · V2r, second part: the swipe file, the Researcher and the Swipe reader (D-AD36)**

What a recruiter saves of other carriers' recruiting — a job page or a picture of an ad — is now read into
evidence a campaign's plan may cite.

- **Table** `ads_swipe_entries` (0632, RLS on, no client policy): a page's address or a picture's stored asset, the
  note, the reading written in place, the attempt, the drops. Removed by archive (`delete_anything` is never).
- **Fetch** (`research/pageFetch.ts`): `lib/ssrfGuard.ts` on every hop, redirects by hand (at most 3), HTML or text,
  2 MB, 10 s; a page drawn by script with under 200 characters of text is refused with words telling the
  recruiter to save a picture instead; a schema.org JobPosting the page embeds is written out first.
- **Researcher** (`workers/researcher`, `researcher@1`, Opus 5.5): items with a verbatim quote; `checkPageReading`
  (shared) keeps an item only when its quote is on the fetched text and every figure of its sentence is in its
  quote. A replay is checked against the text stored with its request.
- **Swipe reader** (`workers/swipeReader`, `swipeReader@1`, Opus 5.5): hook and scene from the plan's closed lists,
  the printed words, one sentence. Fixture pictures are our own finished-ad and Checker fixtures, whose words are
  known exactly.
- **Read job** `ads_swipe_read` (cap 1), written only onto the same attempt of a waiting entry. **Routes**
  `/api/ads/swipe` (list: view; save page, save picture, read again, remove: manage — `save_to_swipe_file: person`).
- **Pack**: read entries of the last 180 days, newest first, only in the room our own items leave (120).
- **Recordings** (said before each, owner's key, fixture data only): Researcher 9 of 9 twice; Swipe reader 7 of 7
  twice; Strategist on two new openings holding BLS pay, page facts and saved ads, 2 of 2 on three runs, baseline
  now 12 of 12. 38 calls in all, inside the stated $4 + $2.
- Scorecard: Researcher L2, Swipe reader L2 (entered at L0 today). Their L3 is the office's reading of real saved
  pages and ads, which needs the swipe file's screen — that comes with the Ads workspace (V6), not before it.
- Mutations: the attempt guard on the write, the pack's room, the check of a redirect's hop and the figure check
  each fail a test when removed.
- Found on the way: the route sweep's fake database answered an update with the table filtered AGAIN after the
  change, so an update that moves a filtered column (Read again moves `read_attempt`) answered no row. Real
  PostgREST answers the rows it updated; the fake now does too.

**Not built, said plainly:** the screen. The swipe file has its API and nothing on the web yet — its place is the
Ads workspace's Creative studio (Q-APX18 (a)), built with V6. Until then nothing can be saved by a person, so no
pack holds a swipe item in practice.
