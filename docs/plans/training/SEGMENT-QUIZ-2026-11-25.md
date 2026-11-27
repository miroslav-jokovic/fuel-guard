# Driver safety training: 3 questions after each segment (2026-11-25)

Follows `SAFETY-VIDEOS-AND-QUIZZES-ANALYSIS-2026-11-24.md`. That plan's D-TR7 put one quiz after
each **film** (5 drawn from a pool, pass 4 of 5). The owner asked for something different, twice on
2026-11-25:

> *"3 questions per segment (not whole video). We have to separate (pause) the video on specific
> segments and ask 3 questions that are tightly related to the previous segment."*

> *"We have to plan this properly so we really check did the user listen to this video, and if they
> don't answer a certain amount of questions they need to watch the segment again. Propose the
> proper amount of questions per segment."*

Then: *"Proceed as suggested and recommended."* So this document records **D-TR13**, which
replaces D-TR7, and **D-TR14–D-TR17** (§3.7). It also records what the build changes (§4) and the
question bank for films 01–05 (§5).

---

## 1. What the driver sees

1. The film plays at normal speed, on screen, with the sound on, and with no skipping ahead on a
   first watch.
2. At the **end of each segment** it **pauses** and asks that segment's **3 questions**, one at a
   time. A right answer shows its one-line reason. A wrong one says only "Not quite. This is in the
   part you're about to watch again."
3. All 3 right: the film carries on. Any wrong: the segment replays. Then **only the points missed**
   are asked again, each as its **other version**.
4. After the last stop the closing card plays (e.g. 01's "Space is options") and the film is done.

There is no quiz after the film. A segment's questions are only about that segment.

## 2. The segments, measured

Chapter marks are from plan §2. Every film has three parts: the problem, why it happens, the habit.
**Film 03's second part is 23 seconds long (six spoken lines), so it joins the third (D-TR17).**

| Film | Stop 1 after | Stop 2 after | Stop 3 after | Closing card |
|---|---|---|---|---|
| 01 Following Too Close | 0:08–1:26 Why space (78 s) | 1:26–2:25 Count it (59 s) | 2:25–3:16 What it costs (51 s) | 3:16 |
| 02 Eyes Up | 0:08–0:52 Fixated (44 s) | 0:52–1:35 How far (43 s) | 1:35–3:04 The habit (89 s) | 3:04 |
| 03 Boxed In | 0:08–1:26 The box (78 s) | 1:26–3:06 How it forms, and the habit (100 s) | — | 3:06 |
| 04 Four Times | 0:08–1:11 Speed and distance (63 s) | 1:11–2:29 Traction (78 s) | 2:29–3:24 The habit (55 s) | 3:24 |
| 05 Plain Sight | 0:08–1:40 Telling them (92 s) | 1:40–2:51 Checking (71 s) | 2:51–3:28 Being seen (37 s) | 3:28 |

**Act I: 14 stops, 42 questions asked, 84 in the bank.** In the player, each film's chapters are its
segments plus a **"Closing" chapter with no questions**, so the last stop comes before the card.

## 3. Proving the segment was watched, and the pass rule

### 3.1 What a web page can and cannot prove

A page can prove the film **played**: on screen, with sound on, at normal speed, with nothing
skipped. It cannot prove **who** held the phone, or that they looked at it. **The questions are the
evidence of attention**, which is why the pass rule is strict.

| Check | Before | Now |
|---|---|---|
| Normal speed only | ✓ the page forces 1× | unchanged |
| No skipping ahead on a first watch | ✓ | unchanged |
| Reported time cannot exceed real time | ✓ the server caps each span to the clock since the last report | unchanged |
| 90% of the segment must be watched | ✓ (`WATCH_SHARE`) | unchanged. Skipping is blocked, so the 10% only absorbs a lost report |
| **The page is on screen** | ✗ a hidden tab kept playing, and it counted | **The film pauses when the page is hidden** |
| **Sound is on** | ✗ a muted film counted | **The film pauses while muted or at volume 0**: "Turn the sound on: this video is spoken." ⚠ An iPhone does not let a page read its hardware volume, so a phone turned all the way down is not caught. The questions catch that. |
| Questions come only after the server has recorded the segment watched | ✓ | unchanged, now per segment |
| **How fast each answer came** | ✗ | **Recorded** (`training_attempts.answered_at`, 0650). Progress flags an answer that came under 2 seconds after the one before. Recorded only, never refusing |

### 3.2 The pass rule (D-TR14)

The odds of moving past one segment. A "guesser" played the film without listening. "Half
listening" knows half the answers. "Listening" knows 9 in 10. Binomial:

| Rule | Guesser, 3 answers | Guesser, 4 answers | Half listening | Listening: passes | Replays per film when listening | Question time per stop |
|---|---|---|---|---|---|---|
| 2 of 3 | 26% | 16% | 50% | 97% | 0.1 | ~45 s |
| 3 of 4 | 11% | 5% | 31% | 95% | 0.2 | ~60 s |
| 4 of 5 | 5% | 2% | 19% | 92% | 0.3 | ~75 s |
| **3 of 3, ruled** | 4% | **2%** | **13%** | 73% | **1.1** | **~45 s** |

**3 questions per segment, 4 answers each, all 3 right.** It stops 87 half-listeners in 100. A
driver who listened replays about one segment per film, about a minute. More than 3 questions would
take longer than a 37–92 s segment itself.

### 3.3 What happens on a miss (D-TR15)

1. **The right answer is not shown after a miss.** Otherwise the retry would test the reveal, not
   the film. The reason is shown after a right answer.
2. The segment replays under the same rules. A question screen also has **"Watch this part
   again"**, which a driver may use before answering; it does not count as a miss.
3. **The retry asks the other version of each missed point.** Each point has two versions
   (`training_questions.point`, 0650). Each try asks the point's version asked least so far (a tie at random), with the answers
   in a new order.
4. **No lockout.** The office sees "3 tries on stop 2" and can talk to that driver.

### 3.4 What the office sees (D-TR16)

Per driver and film: passed or not; **first-try right answers out of 9** (out of 6 for film 03);
tries per stop; fast-answer flags.

### 3.5 Rules every question follows

- It comes **only from a line spoken in its segment of the locked cut**, quoted with the time.
  Transcribed locally from `output/Locked/FILM-0N-*.mp4` on 2026-11-25 with mlx-whisper
  large-v3-turbo (the D-72 tool). The script is not the source: film 05 has 4 script lines not in
  the cut, and film 04's "packed snow" is not audible in the cut, so no question uses either.
- **At least 2 of a segment's 3 points need the film**: a number, the film's own term, its habit.
- **Both versions of a point are equally hard**, so a retry is not a gift.
- **4 answers**, similar length. Each wrong answer is a mistake drivers make, and never a true
  statement marked wrong.

### 3.6 Time for Act I

17 min of film + 14 stops × ~45 s + about 1 replay per film ≈ **33 minutes**, about 6½ per film.

### 3.7 Rulings, 2026-11-25 ("proceed as suggested and recommended")

| # | Ruling |
|---|---|
| **D-TR13** | Questions after each **segment**, the film pausing. Replaces D-TR7 (one quiz after the film). |
| **D-TR14** | **3 per segment, 4 answers each, all 3 right** to move on. |
| **D-TR15** (Q-TR12) | **Two versions per point.** A miss replays the segment and asks the other version. No reveal on a miss, no lockout. |
| **D-TR16** (Q-TR13) | The office sees first-try score, tries per stop and fast-answer flags. |
| **D-TR17** (Q-TR14) | Film 03's 23-second segment joins the next one: 03 stops twice. |

## 4. What the build changes

**Two merges**, because a new column and its first reader may not ship together
(`lint:migration-ordering`; `docs/MIGRATION-DISCIPLINE.md`).

**Merge 1, this one:** migration **0650** and this document.
- `training_questions.point` (0–9, default 0): which point of its segment a question tests.
- `training_attempts.answered_at`: when each answer arrived. It is frozen with the quiz at submit.
- New versions default to `serve_count` 3 / `pass_count` 3. ⚠ **The code does not read either
  column.** The rule is fixed in code (`SEGMENT_POINTS`, all right to pass), because the owner ruled
  one rule for every film. A version made before the ruling stores 5/4, and the office page has no
  field to change it, so reading the columns would leave that film unpublishable. The defaults only
  keep a new row accurate.

**Merge 2:** the code.

| Part | Change |
|---|---|
| `packages/shared` | `filmState` per segment: the next stop's questions open once that segment is watched and every earlier one is passed. After a miss, the stop reopens once the segment is watched again. A film is passed when every segment with questions is passed. The draw picks one version per point, preferring a version not yet served. `publishBlockers` names the segment that is short: every segment with questions needs `serve_count` points, each point needs two versions, `pass_count` equals `serve_count` (D-TR14), and at least one segment needs questions. |
| API (portal) | `POST …/quiz` serves the current stop, and nothing else. A wrong answer's feedback carries no answer and no reason. `answered_at` is written with each answer. |
| Driver's page | It pauses at each stop and shows the questions. It pauses when hidden or muted. "Watch this part again". The rewatch seeks to the segment start. The 100 KB size gate still holds. |
| Office page | The question form gets **Point 1–3**. Questions are listed by segment and point. The Videos table shows questions per stop ("6 · 6 · 6"). Progress shows first-try score, tries and fast flags. |

## 5. The question bank: 84 questions

**Format:** *A* and *B* are the two versions of a point. **✓** is the right answer; the page
shuffles all four. **Why** is shown only after a right answer. The time is where the line is
spoken. ⚠ **A safety person checks every question against the film before release** (docx plan
§11 phase 3).

### Film 01 · Following Too Close

**Stop 1 · Why space (0:08–1:26)**

*Point 1: the whole stop at 55 is 419 feet* (0:40–1:00)
- **A.** Loaded, dry road, 55 mph. From seeing a hazard to stopped, how much road do you need?
  ✓ 419 feet · 216 feet · 300 feet · 142 feet
- **B.** At 55 on a dry road, loaded, the car ahead stops dead 300 feet in front of you. Can you stop in time?
  ✓ No: you need about 419 feet · Yes, with room to spare · Yes, if you brake hard at once · Yes, if the trailer is empty
- *Why:* about 142 ft to see it, 61 ft for your foot to move, then 216 ft of braking: 419 ft minimum.

*Point 2: about 200 feet go by before the brakes do anything* (0:40–0:55)
- **A.** At 55, how much road goes by before your brakes do anything at all?
  ✓ About 200 feet · About 60 feet · About 20 feet · None: braking starts when you see it
- **B.** Why is about 200 feet gone before your brakes start working?
  ✓ Seeing it takes about 1¾ s and moving your foot ¾ s more · The engine has to slow down first · The trailer pushes the cab forward first · The tyres need a moment to grip
- *Why:* perception takes about 1¾ seconds (142 ft at 55), your foot another ¾ second (61 ft).

*Point 3: empty is worse, not better* (1:10–1:15)
- **A.** You're running empty. Compared with loaded, your stop is…
  ✓ Longer · Shorter · The same · Shorter, but only on dry roads
- **B.** Why does an empty truck need more road to stop?
  ✓ Less weight means less traction · Empty trailers bounce, so drivers brake later · Empty trucks are driven faster · An empty trailer catches more wind
- *Why:* less weight means less traction and a longer stop.

**Stop 2 · Count it (1:26–2:25)**

*Point 1: count from a fixed mark* (1:36–1:43)
- **A.** How do you check your following distance?
  ✓ Count from when the vehicle ahead passes a fixed mark until you reach it · Count the car lengths between you · Watch for when their brake lights come on · Check that you can see their mirrors
- **B.** The vehicle ahead passes under an overpass. What do you do?
  ✓ Start counting until your bumper reaches it · Check your mirrors for traffic · Ease off until you're under it too · Nothing: overpasses don't matter
- *Why:* watch it pass something fixed, like an overpass, a sign or a shadow, and start counting the moment it does.

*Point 2: 8 is the cushion; less, ease off* (2:01–2:06)
- **A.** You count to 6 before your bumper reaches the mark. You…
  ✓ Ease off until you reach 8 · Hold it: 6 is fine at highway speed · Change lanes to get clear · Close up a little to 5
- **B.** You count to 9 before your bumper reaches the mark. That means…
  ✓ You have your cushion · You're too far back: close up to 8 · Ease off until you reach 12 · Change lanes: you're holding traffic up
- *Why:* if you reach 8 before your bumper gets to the mark, you have your cushion. Anything less, ease off until you do.

*Point 3: where 8 comes from* (2:13–2:20)
- **A.** Where does 8 seconds come from for a 70-foot truck?
  ✓ 1 s per 10 ft of vehicle, plus 1 above 40 mph · The 3-second rule for cars, doubled, plus 2 · 1 s for every 10 mph you're doing · The time air brakes take to apply
- **B.** Your rig is 70 feet long and you're above 40 mph. What gap do you count?
  ✓ 8 seconds · 4 seconds · 6 seconds · 3 seconds
- *Why:* one second for every 10 feet of vehicle, plus one more above 40 mph: 70 feet is 8 seconds.

**Stop 3 · What it costs (2:25–3:16)**

*Point 1: it costs 8 seconds, because arrival comes from average speed* (2:29–2:46)
- **A.** You sit 8 seconds further back all day. Over an 11-hour day that costs you…
  ✓ 8 seconds · About an hour · About 20 minutes · 8 seconds every mile
- **B.** What decides when you arrive?
  ✓ Your average speed · The gap in front of you · How close you follow in traffic · How late you brake
- *Why:* same speed, same road. You arrive 8 seconds later. Arrival comes from your average speed, not the gap.

*Point 2: following close bleeds momentum; space holds a steadier speed* (2:49–3:01)
- **A.** Following close means more braking. What does each brake cost a loaded truck?
  ✓ Momentum it is slow to get back · Nothing, if the brakes are good · Only some brake-pad wear · Nothing: braking saves fuel
- **B.** What does keeping space let you do?
  ✓ Hold a steadier speed · Drive faster than the traffic · Skip your mirror checks · Brake later and harder
- *Why:* every brake bleeds momentum, and a loaded truck is slow to get it back. Space lets you hold a steadier speed.

*Point 3: someone takes the gap, so rebuild it* (3:06–3:10)
- **A.** Someone takes the gap in front of you. You…
  ✓ Rebuild it · Close up so it can't happen again · Flash your lights at them · Move into the next lane
- **B.** A car keeps cutting into the space you leave. What does the film say?
  ✓ Rebuild the space every time · Close the gap so they can't · Stop leaving space in heavy traffic · Report them to dispatch
- *Why:* someone will take that gap. You don't fight for it, you rebuild it.

### Film 02 · Eyes Up

**Stop 1 · Fixated (0:08–0:52)**

*Point 1: a bumper tells you late* (0:22–0:35)
- **A.** Why is the bumper in front of you a poor thing to watch?
  ✓ It tells you late: it was decided far up the road · Its brake lights may not work · It's too close to read clearly · It hides your own mirrors
- **B.** The brake lights ahead of you come on. When was that decided?
  ✓ Most of a mile up the road, by someone you never saw · Just now, by that driver · A second ago, by the car beside you · When you got too close
- *Why:* a bumper tells you one thing, and late. It was already decided most of a mile up the road.

*Point 2: look 12–15 seconds ahead* (0:37–0:44)
- **A.** How far ahead do most good drivers look?
  ✓ 12 to 15 seconds · 4 car lengths · 3 seconds · A full minute
- **B.** You're watching brake lights four car lengths ahead. The manual says to look…
  ✓ 12 to 15 seconds ahead · 4 car lengths is right · 6 car lengths ahead · 3 seconds ahead
- *Why:* the manual is specific: most good drivers look 12 to 15 seconds ahead.

*Point 3: that's about a quarter mile at highway speed* (0:41–0:48)
- **A.** At highway speed, 12 to 15 seconds ahead is about…
  ✓ A quarter of a mile · 100 feet · Half a mile · A mile and a half
- **B.** At highway speed, about how far ahead should your eyes be?
  ✓ About a quarter of a mile · About 4 car lengths · About 100 feet · About 2 miles
- *Why:* at highway speed, 12 to 15 seconds is about a quarter of a mile.

**Stop 2 · How far (0:52–1:35)**

*Point 1: eyes live on the furthest thing you can still read* (0:52–1:04)
- **A.** Where do your eyes belong?
  ✓ The furthest thing on your side you can still read · The vehicle right in front of you · The horizon, as far as you can · Your mirrors, then the vehicle ahead
- **B.** Which is a good point for your eyes at highway speed?
  ✓ The overpass a quarter mile ahead · The trailer in front of you · The car two lanes over · Your own hood
- *Why:* it's the overpass, the top of the rise, where the tree line stops. That is where your eyes live.

*Point 2: eyes reach about twice the cushion* (1:07–1:16)
- **A.** Your cushion is 8 seconds. How far do your eyes need to reach?
  ✓ About twice that far · The same 8 seconds · About half that · About 4 times that
- **B.** What does looking far ahead give you that the cushion doesn't?
  ✓ It keeps you from ever needing the cushion · It lets you follow closer · It saves on fuel · It replaces your mirror checks
- *Why:* the cushion is what saves you. The eyes are what keep you from ever needing it.

*Point 3: trouble shows up early, 6–7 seconds* (1:19–1:30)
- **A.** Lights come on far ahead, then the whole lane goes red. With your eyes out there, you've known for…
  ✓ 6 or 7 seconds · About 1 second · Only since the car ahead braked · About half a minute
- **B.** How does trouble usually show up far ahead?
  ✓ One set of lights, then two, then the lane goes red · All at once, with no warning · Only when the car ahead brakes · In your mirrors first
- *Why:* one set of lights, way out, then two, then the whole lane goes red. You've known for six or seven seconds.

**Stop 3 · The habit (1:35–3:04)**

*Point 1: pick the point, work it back, call it early* (1:35–1:55)
- **A.** What is the habit?
  ✓ Pick the point, work it back, call it early · Mirrors, signal, go · Brake, look, steer · Watch the bumper, keep your lane
- **B.** "Work it back" means your eyes…
  ✓ Come down the lane to your hood, then back out · Stay on the far point the whole time · Go to your mirrors and back · Follow the vehicle in front
- *Why:* come off the point, down the lane, back to your own hood, then straight out again. Your eyes never park.

*Point 2: say it out loud; if you can't name anything, you're staring* (1:57–2:10)
- **A.** Why say out loud what you see ahead?
  ✓ If you can name it, you saw it · It keeps you awake on long runs · So dispatch can hear it · The CDL test requires it
- **B.** You try to call what's ahead and can't name anything. That means…
  ✓ You're staring, not seeing · The road ahead is clear · Your gap is right · You should change lanes
- *Why:* if you can name it, you saw it. If you can't name anything, you're staring.

*Point 3: in heavy traffic, read around it* (2:15–2:37)
- **A.** Heavy traffic, and a trailer fills your windshield. You…
  ✓ Read around it: beside it, under it, the shoulder · Watch its brake lights closely · Wait it out: there's nothing to see · Change lanes until the view clears
- **B.** In heavy traffic, what can you read besides the trailer in front?
  ✓ Whether cars two lanes over all slow at once · Nothing: the trailer blocks it all · Only its brake lights · Only your mirrors
- *Why:* the lane beside you, what shows underneath, the shoulder. There is always more information than the bumper.

### Film 03 · Boxed In

**Stop 1 · The box (0:08–1:26)**

*Point 1: a box is every side taken; in the right lane the guardrail is one* (0:15–0:38)
- **A.** What is a box?
  ✓ Every side around you is taken, so there's nowhere to go · A lane closed for a work zone · A tight spot at a dock · A truck stopped on the shoulder
- **B.** Right lane: a car at your left door, a trailer ahead, someone close behind. How many sides are open?
  ✓ None: the guardrail is the fourth · One: the right · Two: right and rear · Three
- *Why:* four sides, and out in the right lane one of them was never yours. That's the guardrail.

*Point 2: the danger is being trapped when you need to change lanes* (0:43–0:50)
- **A.** Why does the manual say a box is dangerous?
  ✓ You may be trapped when you need to change lanes · You may get sideswiped · Others can't see your signal · You burn more fuel
- **B.** Being boxed in matters most because…
  ✓ There's no lane to move to when you need one · The car beside you may sideswipe you · You may get a tailgating ticket · You may miss your exit
- *Why:* the manual is blunt. It isn't the sideswipe: you may be trapped when you need to change lanes.

*Point 3: when the front is gone, a side is the answer, not the pedal* (1:00–1:18)
- **A.** The lane ahead stops suddenly at 55. What gets you out of the way in time?
  ✓ An open side · Braking harder · Your horn · Your hazard lights
- **B.** When the lane ahead stops at 55, why isn't the brake pedal enough?
  ✓ The whole stop takes 419 feet · Air brakes can lock up · Braking at 55 is against the rules · The pedal takes two seconds to work
- *Why:* at 55 you cover 200 ft before the brakes do anything, and the stop takes 419. A side is the answer.

**Stop 2 · How it forms, and the habit (1:26–3:06)**

*Point 1: you drift into a box* (1:29–1:41)
- **A.** How does a box usually form?
  ✓ Nobody cuts in; everybody just holds their speed · Someone cuts you off · You change lanes into it · Traffic merges from a ramp
- **B.** You held a steady speed, doing everything right, and now you're boxed in. How?
  ✓ You drifted there · You chose to be there · Another driver trapped you on purpose · You followed too close
- *Why:* nobody makes a move. You never decided to be here: you drifted here at a constant speed.

*Point 2: open a side with your right foot* (2:05–2:42)
- **A.** What is the cheapest way to open a side?
  ✓ Come off the throttle and let the pack go on · Change lanes · Speed up past them · Sound the horn so they move
- **B.** You open a side the way the film shows. Who behind you notices?
  ✓ Nobody: no brake lights, no lane change · The driver behind, from your brake lights · The car beside you, from your signal · Everyone, from your hazards
- *Why:* it's not a lane change, it's your right foot. No brake lights, nothing anybody behind you would notice.

*Point 3: level with somebody is the worst place* (2:18–2:33)
- **A.** Where is the worst place to sit?
  ✓ Level with another vehicle · 8 seconds behind a trailer · In the right lane · Behind a car in the left lane
- **B.** You're level with a car in the next lane. The manual says…
  ✓ Drop back or pull forward so they can see you · Hold it: matching speed is safest · Tap the horn so they know you're there · Signal so they move over
- *Why:* level with somebody is the worst place to sit. Drop back or pull forward so you're sure they can see you.

### Film 04 · Four Times

**Stop 1 · Speed and distance (0:08–1:11)**

*Point 1: 419 feet assumes a dry road, good brakes and 55* (0:21–0:34)
- **A.** Stopping in 419 feet assumes…
  ✓ A dry road, good brakes and 55 mph · Any road at 55 mph · A wet road at 45 mph · An empty trailer at 55 mph
- **B.** Dry road, 55 mph, but your brakes are worn. Your stop is…
  ✓ Longer than 419 feet · Still 419 feet · Shorter: you'll brake harder · 419 feet: only the road changes it
- *Why:* every number comes with that condition. Change one and the number gets bigger.

*Point 2: twice the speed is four times the braking distance* (0:39–0:57)
- **A.** You go from 20 to 40 mph. Your braking distance is…
  ✓ 4 times longer · Twice as long · About the same · 3 times longer
- **B.** You double your speed. How much more room do you need to brake?
  ✓ 4 times as much · Twice as much · 50% more · The same
- *Why:* go twice as fast and you don't need twice the room. You need four times.

*Point 3: a gap that felt fine slower is nowhere near enough faster* (0:57–1:02)
- **A.** A gap felt fine at a lower speed. At a higher speed it is…
  ✓ Nowhere near enough · Still fine if you pay attention · Fine: the brakes are the same · Fine on a dry road
- **B.** A gap felt fine at 30. You speed up to 60 and keep the same gap. It is now…
  ✓ Nowhere near enough · Still enough · Enough on a dry road · Enough with good brakes
- *Why:* same brakes, same driver, four times the road.

**Stop 2 · Traction (1:11–2:29)**

*Point 1: wet: take about a third off, when it gets wet* (1:23–1:36)
- **A.** You're at 55 and the road turns wet. You slow to about…
  ✓ 35 · 50 · 45 · 25
- **B.** On a wet road, how much do you take off your speed?
  ✓ About a third · About a tenth · About half · Nothing, with good tyres
- *Why:* take about a third off: 55 becomes 35. Do it when the road gets wet, not when you need the brakes.

*Point 2: ice: crawl, then park* (1:44–1:52)
- **A.** On ice, the manual tells you to…
  ✓ Slow to a crawl, then park as soon as it's safe · Drive at half speed · Hold a steady speed and don't brake · Follow a snow plow
- **B.** The road ices over. What does the manual say?
  ✓ Stop driving as soon as you safely can · Cut your speed by a third · Put the hazards on and keep going · Keep your speed up for momentum
- *Why:* on ice, the manual tells you to stop driving.

*Point 3: empty means less traction, so more space* (2:10–2:23)
- **A.** Your trailer is empty. You…
  ✓ Leave more space · Leave less space: lighter stops quicker · Change nothing · Drive faster to save time
- **B.** Why does an empty trailer need more room to stop?
  ✓ It has less traction · It's harder to see · Its brakes are weaker · It catches more wind
- *Why:* empty is not safer. An empty trailer has less traction, so it takes more room to stop.

**Stop 3 · The habit (2:29–3:24)**

*Point 1: read the surface, take it off early, stop in what you see* (2:26–2:42)
- **A.** What is the habit?
  ✓ Read the surface, take it off early, stop in what you see · Brake early, brake hard, brake often · Keep the limit, keep your lane, keep going · Check tyres, check brakes, check mirrors
- **B.** "Read the surface" means…
  ✓ Say out loud what's under your tyres: dry, wet, snow, ice · Check your tyre pressure at each stop · Read the road signs for warnings · Watch the tyres of the truck ahead
- *Why:* say out loud what is under your tyres: dry, wet, snow, ice.

*Point 2: take it off early: throttle, not brake, before you need it* (2:44–2:52)
- **A.** "Take it off early" means…
  ✓ Use the throttle, not the brake, before you need it · Brake early and hard · Turn off cruise at the next stop · Take your foot off the clutch
- **B.** The road ahead looks wet. How do you slow down?
  ✓ Ease off the throttle before you need the brakes · Brake firmly once you're on it · Downshift hard · Hold speed, and brake if it's slick
- *Why:* use the throttle, not the brake, and do it before you need it.

*Point 3: stop in what you see, whatever the limit says* (2:55–3:20)
- **A.** Fog shortens how far you can see. You…
  ✓ Slow until you can stop inside what you can see · Keep to the speed limit · Follow the taillights ahead · Put your high beams on
- **B.** You can't stop in the distance you can see, but you're under the limit. You are…
  ✓ Going too fast · Legal, so it's fine · Fine if your brakes are good · Fine on a dry road
- *Why:* if you can't stop in the distance in front of you, you're too fast, whatever the speed limit says.

### Film 05 · Plain Sight

**Stop 1 · Telling them (0:08–1:40)**

*Point 1: signal early: before you move, and until you're through* (0:46–1:04)
- **A.** For a lane change, when does your signal go on?
  ✓ Before you move · As you move · Once you're across · Only if someone is behind
- **B.** For a turn, how long does your signal stay on?
  ✓ From well before the turn until you're through it · Until you start turning · Only the last few seconds · Until the car behind slows
- *Why:* signal early, well before you move, and leave it on until you're through. It's the only chance a driver you never saw has.

*Point 2: brake taps for the driver behind* (1:10–1:21)
- **A.** You see something ahead that will slow you down. First you…
  ✓ Give the drivers behind a few light brake taps · Brake hard so they notice · Put the hazards on once you've stopped · Change lanes to make room
- **B.** Why tap your brakes before you slow down?
  ✓ The driver behind can't see the road ahead, because of you · To test your brakes · To dry the brakes in rain · It's required before every exit
- *Why:* the driver behind can't see the road ahead, and you're the reason. Give them the brake lights first.

*Point 3: don't wave anyone through* (1:24–1:37)
- **A.** A car is waiting to pull out in front of you. You…
  ✓ Don't wave them through · Wave them through to be polite · Flash your lights to let them go · Stop and sound the horn once
- **B.** Why shouldn't you wave another driver through?
  ✓ You can't see what they'd pull into, and you'd get the blame · It slows your own trip · It breaks the hours-of-service rules · They might not see your hand
- *Why:* you can't see what they'd be pulling into. If it goes wrong you get the blame, and it can cost many thousands of dollars.

**Stop 2 · Checking (1:40–2:51)**

*Point 1: the curved mirror lies the same way every time* (2:02–2:13)
- **A.** A car in your curved mirror is…
  ✓ Closer than it looks · Exactly where it looks · Farther than it looks · Bigger than it looks
- **B.** Everything in a curved mirror looks…
  ✓ Smaller and farther away than it is · Bigger and closer than it is · Exactly as it is · Smaller but closer than it is
- *Why:* everything in it looks smaller and farther away than it is. That car is closer than it looks.

*Point 2: the four lane-change checks* (2:18–2:31)
- **A.** The four lane-change checks, in order:
  ✓ Room, blind spot after signalling, path as you begin, across · Signal, room, across, blind spot · Blind spot, signal, across, room · Room, across, signal, blind spot
- **B.** You've just signalled for a lane change. What do you check now?
  ✓ Has anybody moved into your blind spot? · Is your signal still on? · Is the road far ahead clear? · Nothing until you're across
- *Why:* before you start, room. After you signal, the blind spot. Right after you begin, the path. Then once you're across.

*Point 3: the flat mirror's blind area on the right* (1:40–1:58)
- **A.** On the right side, where does your flat mirror show nothing?
  ✓ Beside the cab and most of the trailer · Only far behind the trailer · Only right behind the bumper · Nowhere: it shows the whole side
- **B.** On the right, which mirror holds a whole car all along the truck?
  ✓ The fender mirror · The flat mirror · The curved door mirror · None of them
- *Why:* the flat mirror has nothing beside the cab or most of the trailer. The fender mirror is the only glass that holds a whole car all the way along.

**Stop 3 · Being seen (2:51–3:28)**

*Point 1: headlights at dawn, dusk, rain and snow, not just clearance lights* (2:50–2:58)
- **A.** Dawn, dusk, rain or snow. You turn on…
  ✓ Your headlights, not just clearance lights · Only your clearance lights · Your hazard lights · Nothing extra in daylight
- **B.** When does the film say to have your headlights on?
  ✓ Night, dawn, dusk, rain and snow · Only at night · Only in heavy rain · Only in fog
- *Why:* it isn't only night. Dawn, dusk, rain, snow: headlights, not just clearance lights.

*Point 2: if you can't see them, they can't see you* (2:58–3:03)
- **A.** You're having trouble seeing other drivers. That means…
  ✓ They're having trouble seeing you · They can see you: you're big · Nothing, if your lights are on · You should follow closer
- **B.** Dusk, light rain, and you can barely make out the cars around you. What follows?
  ✓ They can barely make you out either · They can see you: trucks are big · They'll see your clearance lights · Nothing changes in light rain
- *Why:* if you're having trouble seeing them, they're having trouble seeing you.

*Point 3: don't sit unseen; change where you are* (3:20–3:22)
- **A.** A driver can't see you. You…
  ✓ Change where you are · Hold your place and signal · Flash your lights · Sound your horn
- **B.** You're sitting where the truck beside you can't see you. The film says…
  ✓ Move: drop back or pull forward · Stay: they'll notice eventually · Sound the horn so they know · Signal and hold your place
- *Why:* don't sit unseen. If a driver can't see you, change where you are.

## 6. Order of work

1. **Merge 1:** migration 0650 and this document.
2. **Merge 2:** shared rules, API, the driver's page and the office page (§4).
3. **Staging:** upload FILM-01 and mark its chapters (0:08, 1:26, 2:25, Closing 3:16). Enter its 18
   questions with their points, publish, and take it on a phone. Get one stop wrong on purpose to
   see the replay and the other version.
4. **Safety review of all 84**, then films 02–05 are entered on the page and published.

## 7. Progress log

- 2026-11-25: the owner asked for 3 questions per segment with the film pausing. Final cuts
  transcribed, design written, 45 questions drafted.
- 2026-11-25: the owner asked for proof the film was actually listened to, and a rewatch below a
  set score. §3 proposed two missing watch checks, the pass-rule odds, no reveal on a miss and two
  versions per point.
- 2026-11-25: owner, "proceed as suggested and recommended": D-TR13–D-TR17 ruled. Migration 0650
  (`point`, `answered_at`, 3/3 defaults) and the 84-question bank written. The code follows in its
  own merge, because a new column and its first reader may not ship together.
- 2026-11-25: the code (merge 2). The rule is in code, not in `serve_count`/`pass_count` (§4). The
  driver's page pauses at each stop, when hidden and when muted, and undoes a skip ahead. A browser
  spec proves each one against a committed 8-second WebM, because Chromium in CI cannot play the
  films' H.264.
- 2026-11-27: owner, "proceed as proposed": load all five films on staging, not only FILM-01.
  `scripts/training-load.mjs` reads §5 itself (`scripts/lib/training-bank.mjs`), refuses a bank that
  breaks §3.5/D-TR14/D-TR15, and enters films, chapters (an Opening and a Closing with no questions
  around the stops of §2) and all 84 questions through the office API, so the page's checks and audit
  rows apply. It runs against staging only; production waits for §6 step 4. Measured: the bank parses
  to 5 films, 14 stops, 84 questions; staging at 0655 answers the loader `403 module_disabled` until
  the `training` module is granted to its org. The console's grant needs a step-up, which staging
  cannot give (Q-AD41), and an agent's direct grant on the staging database was refused by the
  auto-mode classifier, so the grant is the owner's one command.
- 2026-11-27 (later): all five films published on staging, course "Defensive driving, Act I": 01 (204 s,
  18 questions), 02 (193 s, 18), 03 (195 s, 12), 04 (214 s, 18), 05 (217 s, 18), each with the chapters
  of §2. Staging needed three things first. (1) The `training` module, granted by the owner. (2) Railway's
  retired `uat` held staging's `general` and `egress` lanes at a commit older than training; the owner
  deleted the Railway project (purge 2026-11-29), but staging runs no `general` lane of its own
  (`infra/server/staging.env` RUN_SCHEDULERS=false), so a conversion a deploy interrupts stays queued.
  (3) #2691: a second "uploaded" on a film already queued now starts the queue again instead of a 500.
  The loader starts the conversions one film at a time (~3½ min each on the t4g.medium). Merges from
  other work redeployed staging every 5–15 minutes and interrupted film 02 twice. Left on staging: two
  unused copies of film 01 (v1 ready, v2 queued). Next: the phone walk (§6 step 3), then the safety
  review of all 84 (§6 step 4) before production.
- 2026-11-27: **send to a phone number (owner: "we should be able to send this directly to some phone
  number as option instead just to drivers from list"; "do as proposed").** An assignment belongs to
  exactly one of a driver or a named person with a +1 number (migration 0663, merge 1 of 2; the Send
  tab's "Send to a phone number" and the Progress tag follow in merge 2, as a column and its first reader
  may not ship together). **Texting that number waits on Q-TR9 (a), ruled the same day:** a
  driver-operations toll-free number, verified for training, dispatch and safety notices; until then the
  office copies the link. Q-TR9 (c), texting from the applicant number, stays refused.
