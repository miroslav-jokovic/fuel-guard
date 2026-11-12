# The office-PC check: today's map against the vector trial, one page

For the owner's ruling on the vector road map (D-DR33, `HANDOFF-2026-11-10-VECTOR-MAP.md` §1 step 2).
The rig on a developer Mac answered "did the fixes move the numbers, and which way"; this check
answers "how does it feel on the slowest office PC, as a count". Allow 20 minutes. ⚠ Before this
check, D-DR39's frame-time comparison on a quiet machine should be recorded (HANDOFF §10.6 item 1),
so the office figures land beside a baseline rather than alone.

## Before you start

1. **Use the slowest office PC** a dispatcher actually sits at, with **Chrome or Edge**. The counter
   below only works in those two; Firefox and Safari will say so instead of counting.
2. **Open `chrome://gpu`** in a new tab (`edge://gpu` on Edge). Under *Graphics Feature Status*, find
   the **WebGL** and **WebGL2** lines and write down what each says: *Hardware accelerated*,
   *Software only*, or *Disabled*. Under *Driver Information* copy the **GL_RENDERER** line. A
   *Software only* PC is drawing the map on its processor, which is the floor the rig measured as
   SwiftShader, and the vector map costs more there than the raster one. That result still counts;
   it is the PC the ruling is for.
3. **Close the other tabs** in that window. The counter counts the page's own stalls only, but a tab
   playing video next door slows the whole machine.
4. **Pick a quiet time.** Staging spends production's HERE rate limit until the separate staging key
   exists (Q-DR31), so run this outside the office's busy hours, and never while a dispatcher reports
   the map refusing tiles.
5. Sign in to staging as a **dispatcher** (not admin), open the **Dispatch** tab, and wait for the
   trucks to appear.

## The sequence, once per pass

Do a pass on **Map**, then on **Map (vector trial)**, then on **Map** again, then once more on
**Map (vector trial)**: four passes, alternating, so a slow minute on the network lands on both maps
and not on one. The basemap is the map icon on the right edge of the map.

1. Pick the map for this pass in the basemap menu. Picking it **restarts the counter**, so each
   figure belongs to one map. (The first pass starts counting from the page load; that is fine.)
   Wait until the map has finished drawing, about five seconds.
2. **Still, 10 seconds.** Hands off the mouse. The fleet is moving; the map is not.
3. Open the basemap menu and read the line under the choices: `Long frames: N in S s, worst W ms`.
   Write N, S and W down as the *still* reading. Click anywhere to close the menu.
4. **Zoom in:** double-click on one truck, seven times, about a second apart, on the same spot.
5. **Zoom out:** four notches of the mouse wheel, about a second apart.
6. **Pan:** drag the map once, left to right across the screen.
7. Open the menu again and read the line. Write it down as the *end* reading. The walk's own
   figure is *end* minus *still*.
8. While the menu is open, note anything that **looked wrong** during the pass: a blank patch, place
   names jumping, a road missing, a label in the wrong font (the vector map's names should look like
   HERE's own; a plain system font means the glyphs did not load, Q-DR33).

Then **Account menu → Appearance → Dark**, and do one pass on each map. The vector map repaints in
the night colours; today's map fetches a different set of tiles. Set it back to System afterwards.

## What to write down

| pass | map | scheme | still: N / S s / worst ms | end: N / S s / worst ms | looked wrong |
| --- | --- | --- | --- | --- | --- |
| 1 | Map | light | | | |
| 2 | Map (vector trial) | light | | | |
| 3 | Map | light | | | |
| 4 | Map (vector trial) | light | | | |
| 5 | Map | dark | | | |
| 6 | Map (vector trial) | dark | | | |

Plus: the PC (model, Windows version, screen size), the two `chrome://gpu` lines, the GL_RENDERER
line, the time of day, and whether anybody else had the map open at the time.

## How to read it

- A **long frame** is a stall over 50 ms on the page's main thread: at that length the map has
  skipped three frames, which is what a reader feels as a hitch. The count is the same quantity the
  rig reports as *long-task*, so the office figure and the rig figure can sit in one table.
- **A few frames' difference between the maps is noise.** The finding is a map that doubles the
  other's count on the same pass, or a worst frame over about 500 ms, or a count that keeps rising
  during the *still* 10 seconds (the map is working while nobody touches it, which D-DR39 was meant
  to end; the rig measured 0.4–5.6 truck-layer writes a second still after the gate, so a handful
  is the fleet's own motion and tens are a regression).
- **The still readings compare the two maps at rest; the walk readings compare them under a hand.**
  Both matter: a dispatcher watches the map far longer than they zoom it.
- The criteria for the ruling itself are the owner's (D-DR33: default for two weeks with
  "Map (classic)" kept as the way back, or drop). This page only makes the two maps comparable on
  the PC that decides.

## Where it goes

The table and the notes go to the design plan's progress log
(`docs/plans/design-system/DESIGN-REFRESH-2026-09.md` §7, dated entry at the end) and a line in
`HANDOFF-2026-11-10-VECTOR-MAP.md` §10.6 item 4. A *Software only* WebGL line on any office PC also
closes the assumption in HANDOFF §10.4 gap 2 ("no real PC sits at the software floor") with a measurement.
