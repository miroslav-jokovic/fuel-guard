# Edge detection benchmark — how to build the photo set and score it

Step L1 of `docs/plans/drivers-app/LIVE-EDGE-DETECTION-PLAN.md`. Every candidate document-edge
detector is scored here, on the same photographs, by one definition (`src/edges/`). macOS only.

## 1. Take the photographs

About **300**, the way drivers actually photograph paperwork. Aim for variety more than volume:

| Vary | Examples |
|---|---|
| Document | BOL, POD, fuel receipt, CDL front and back, a multi-page form, a folded or crumpled sheet |
| Surface | dashboard, truck seat, steering wheel, desk, a stack of other papers, white paper on a white table |
| Light | daylight, night with the cab light, direct sun glare, shadow of the phone across the page |
| Framing | page filling the screen, small and far, tilted steeply, one corner under a thumb |
| **No document** | **~30 photos of an empty seat, a dashboard, a hand.** The bar allows zero outlines on these. |

⚠ **Real paperwork is PII.** It goes only where step 2 puts it (`fixtures/real/private/`, gitignored),
never into a commit, a chat or a ticket. Read `fixtures/real/README.md` first.

## 2. Import them

```sh
pnpm --filter @silvicom/capture-engine edges:import -- ~/Desktop/edge-photos
```

Copies them into `fixtures/real/private/edges/photos/`, **renamed by content hash** (a file name can
carry a load number), and converts iPhone HEIC to JPEG.

## 3. Mark the corners

Open `tools/edges/label.html` in Chrome or Safari, straight from the file system (it uses no network).
Choose the `photos` folder.

- Click the four corners in any order. A magnifier follows the pointer. Drag a corner to fix it.
- Enter saves and moves to the next photo. N marks "no document". Number keys 1–8 set the kind.
- Fill in Surface and Light; they stay set between photos, and the report breaks results down by them.
- **Download labels.json often** and save it as `fixtures/real/private/edges/labels.json`. To carry on
  later, load that file back with "Existing labels.json".

## 4. Score

```sh
pnpm --filter @silvicom/capture-engine edges:score -- --labels fixtures/real/private/edges/labels.json --by surface
```

Scores Apple's document segmentation (what the L0 camera runs), Apple's rectangle detector, our
`findDocument`, and DocAligner's corner network if its model is in `~/.cache/silvicom-datasets/models/`
(see `docaligner.ts` for the download and checksum). Columns:

- **JI**: the SmartDoc 2015 Jaccard index (1 = perfect). Comparable with published numbers.
- **corner / p95**: the worst corner's error in pixels at a 1,568 px long edge, typical and 95th percentile.
- **missed**: photos with a document where nothing was found. **false**: outlines on photos with none.
- ✓ / ✗ against the proposed bar (Q-LED3): 2 px, 6 px, 2 %, 0.

## The public check: SmartDoc 2015

```sh
mkdir -p ~/.cache/silvicom-datasets/smartdoc15/frames && cd ~/.cache/silvicom-datasets/smartdoc15
curl -LO https://github.com/jchazalon/smartdoc15-ch1-dataset/releases/download/v2.0.0/frames.tar.gz
echo "3acb8be143fc86c507d90d298097cba762e91a3abf7e2d35ccd5303e13a79eae  frames.tar.gz" | shasum -a 256 -c
tar -xzf frames.tar.gz -C frames && rm frames.tar.gz
pnpm --filter @silvicom/capture-engine edges:smartdoc -- ~/.cache/silvicom-datasets/smartdoc15/frames
pnpm --filter @silvicom/capture-engine edges:score -- --labels ~/.cache/silvicom-datasets/smartdoc15/frames/labels.json --by background
```

972 MB, CC BY 4.0 (cite Burie et al., ICDAR 2015). Printed A4 pages on desks, filmed in 2015. **It is
necessary, not sufficient**: a detector can score 0.99 here and 0.70 on photos from the wild.
