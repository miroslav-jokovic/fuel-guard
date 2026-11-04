# Handoff — OCR judge (Jev) + training our OCR on Samsara BOL photos (2026-11-02)

Paste this into a fresh chat. Everything below is on branch `claude/ocr-judge-plan` (PR #1915), worktree
`/Users/miroslavjokovic/Projects/FuelGuard-jev`. The plan is `docs/plans/document-reading/OCR-JUDGE-PLAN.md` — read
§7 (progress log) and §8 (training) first. Nothing here is merged; nothing touches production.

## Where we are

1. **Jev researched and tested on the Mac** (J0, plan §7). MiniCPM-OCR Jev picks the true number over a one-digit
   misread 102/103 times (0 of 412 misreads scored ≥ 0.5). Its one real setting is the crop: no margin around the
   printed box lifts its score on correct text a lot (photos: median 0.96). On rows today's OCR already finds it adds
   ~1 value in 48; the real gap is the rows today's OCR never finds (11 of 35 photo lines). Owner question Q-OJ6 is
   open (what next for Jev); the owner then moved to training our own OCR instead.
2. **Owner decision: train our own OCR (PaddleOCR PP-OCRv6) on Samsara driver BOL photos**, filtering out the
   non-BOL photos first. D-OJ10: train only on HUMAN-confirmed numbers (the OCR is the readers' independent witness).
3. **Built and committed (5c841b5):**
   - `apps/api/src/scripts/lib/bolPhotoFilter.ts` — BOL-vs-not filter (local, no spend).
   - `apps/api/src/scripts/measureBolPhotoFilter.ts` — measures it against labelled photos, `--shards N`.
   - `apps/api/src/scripts/pullBolCorpus.ts` (`doc:bol-corpus`) — pulls Samsara "BOL, SECURMENT, PLACARDS",
     judges each photo in memory, saves ONLY BOL pages, logs refused ids.
   - `judgeSpike.ts`, `judgeSpikeScore.ts`, `judgeMutantProbe.ts` (`PAD_X`/`PAD_Y`/`CATEGORY` env) — the Jev tests.
4. **Filter measured** on 277 photos labelled by eye: finds 100/116 BOL pages, lets in 1/161 non-BOL.
5. **Corpus pulled so far: 97 BOL pages (51 submissions), 47 hazmat (print a UN/NA id)**, in
   `/Users/miroslavjokovic/Projects/FuelGuard-jev/packages/capture-engine/fixtures/real/private/bol-corpus/`
   (gitignored — customer papers). Pulls were stopped cleanly for the restart; re-runs skip pulled submissions.

## Next steps, in order

1. **Resume the pull to ~300 BOL pages** — 3 workers, not 4 (4 × ~1.2 GB OCR pushed the Mac into swap):
   ```
   cd /Users/miroslavjokovic/Projects/FuelGuard-jev/apps/api
   for r in "2026-10-17 2026-10-31" "2026-10-03 2026-10-17" "2026-09-04 2026-10-03"; do set -- $(echo $r)
     node --env-file=/Users/miroslavjokovic/Projects/FuelGuard/apps/api/.env --import tsx src/scripts/pullBolCorpus.ts \
       --since $1 --until $2 --max-pages 70 < /dev/null > ~/.cache/silvicom-ocr-judge/j0/pull-logs/$1.log 2>&1 & done; wait
   ```
   (`--env-file` is required: `loadEnv` reads only process.env. Report kept/refused per chunk as they land.)
2. **Draft labels per page**: PaddleOCR boxes (production engine) + MiniCPM-OCR text per box; flag every box where the
   two disagree; mark hazmat rows. No model spend.
3. **Labelling pass** — open question Q-OJ7 for the owner: who confirms (dispatchers/Safety/Admin per Q-RC1) and how
   (a batch sheet vs a small screen). Every hazmat-row number human-confirmed; 20 % held out for testing only.
4. Train PaddleOCR detection + recognition on a rented GPU (~$5–20), export ONNX, pin by sha256 like `ocrModels.ts`,
   ship behind the Settings switch in parallel (plan D-OJ3/D-OJ4); it replaces today's model only if it reads more
   and backs 0 wrong numbers on the held-out set.

## Files that survive the restart (moved out of /private/tmp)

`~/.cache/silvicom-ocr-judge/` — `jev/` and `ocr/` GGUF models (Jev Q8_0 + F16, MiniCPM-OCR Q8_0), and `j0/`:
truth labels (`office-truth.json`, `prod-truth.json`, `photo-class-truth.json` 196 photos, `batch1-class-truth.json`
81 photos, `all-class-truth.json`), run outputs (`office-run2.json`, `prod-run1.json`, probes, `tune/`), the office
BOL renders (`office300/`), the 30 production read photos (`prod/`), the audit photos (`audit/`), pull logs, the
llama.cpp builds (`llama-b12047` for Jev, `llama-b11901` for MiniCPM-OCR), the vendor repo and `Dockerfile.render`.
Docker image `silvicom-jev-render:c0881ac` stays in OrbStack. Truth files' paths were rewritten to `j0/`, but
`photo-class-truth.json` paths are relative to `packages/capture-engine/fixtures/real/private/documents` (main checkout).

## To bring the Jev rig back (only if needed — ~6 GB RAM)

```
J=~/.cache/silvicom-ocr-judge
$J/j0/llama-b12047/llama-b12047/llama-server -m $J/jev/MiniCPM-OCR-Jev-Q8_0.gguf --mmproj $J/jev/mmproj-model-f16.gguf -ngl 99 -c 32768 -np 4 --host 0.0.0.0 --port 18499 &
$J/j0/llama-b11901/llama-b11901/llama-server --model $J/ocr/MiniCPM-OCR-1_0-Q8_0.gguf --mmproj $J/ocr/mmproj-model-f16-4x.gguf -ngl 99 --flash-attn on --ctx-size 8192 --parallel 1 --host 127.0.0.1 --port 18510 --alias minicpm-ocr --jinja --reasoning off &
docker run -d --name jev-render -p 127.0.0.1:18500:18500 --add-host host.docker.internal:host-gateway silvicom-jev-render:c0881ac 18500 http://host.docker.internal:18499
```
Homebrew's llama.cpp cannot compile Metal shaders on this macOS — use these official builds. b11901 does not know
Jev's model type; b12047 does. Start OrbStack first (`open -a OrbStack`).

## Open questions for the owner

- **Q-OJ6** — Jev next step (plan §7): recommended J0b (MiniCPM layout as a second row source), or build the
  parallel lane now, or stop.
- **Q-OJ7** — who labels the ~300 BOL pages, and in what form.
- Plan's Q-OJ1..5 (where the engine runs, switch per org, who sees results, v1 scope, go/no-go bar) still open.

## Side finding worth its own fix

Mayo BOL 14182 (UN1824): today's row window reaches the next line and prints its "2"; the true 8 totes is a
class-8 token the row cannot prove, so a 8-vs-2 reader split would be backed WRONG. Needs a row-window test in the
reader-correctness census, independent of all the above.
