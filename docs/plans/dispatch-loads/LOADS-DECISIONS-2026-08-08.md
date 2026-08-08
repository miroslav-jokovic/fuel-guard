# Loads — the two decisions delegated to me, 2026-08-08

The owner locked two of the four himself: **signed proof of delivery is in the pilot**, and **McLeod
pull plus a self-contained manual loads system**, because the manual path is what a carrier without
McLeod buys and is the foundation of the full TMS. These are the other two.

---

## D-LD7 · Capture geolocation at arrival — YES, at the event only, and disclosed

**Decision.** Capture a single position fix when a driver marks a stop **arrived** or **completed**,
and only then. Never continuously, never in the background, never while off duty.

**Why yes.** Arrival time is the most-disputed fact in freight. Detention and late-fee arguments turn
on when a truck reached a dock, and a stop marked "arrived" with no position is an assertion, not
evidence — which makes it worth nothing to the carrier in the argument it exists for. This is the same
category of evidence FuelGuard already sells everywhere else.

**Why it is not new surveillance in kind.** The ELD mandate already records vehicle position at every
duty-status change and at intervals in between, so the truck's location during a shift is a legally
mandated record that exists whether or not we capture anything. What we are adding is a *discrete
point bound to a work event*, which is strictly less than what the ELD already holds.

**The constraints, which are the actual decision.** Fisher Phillips' guidance for employer geolocation
is informed consent, purpose limitation, proportionality and minimisation, transparency, and respect
for time outside work. That translates to five rules, and they are binding:

1. **Event-bound only.** A fix is taken at arrive and at complete. There is no polling, no background
   location permission, and no fix outside an open duty session.
2. **Never a blocker.** Permission denied, GPS unavailable, indoors at a dock — the stop still
   completes. The record carries `location_source` of `device | denied | unavailable`, so "we do not
   know where they were" is a stored fact rather than a silent null.
3. **Stored with the event, retained with it.** The fix lives on the stop, expires on the same clock
   as that stop's photos (D-LD8), and is never fed into a separate location history.
4. **Told plainly, before the first capture.** A one-time explainer at first check-in, in the app's own
   voice, naming exactly what is taken and when — and a standing line in Settings the driver can
   re-read. Not a line in a EULA.
5. **Accuracy is recorded, not laundered.** A 3km fix is stored as a 3km fix. Rendering it as a precise
   pin would be inventing evidence.

**What this does not authorise.** Continuous breadcrumbs, geofencing, off-duty capture, or personal-
vehicle tracking. Any of those is a separate decision with a separate disclosure.

---

## D-LD8 · Load photo retention — 3 years, with the regulatory floor named

**Decision.** Default **1,095 days (3 years)** from the stop's completion for `load_stop_photos` and
their objects. Not configurable in this pass; per-org configuration is a follow-on, and the floor when
it lands is **365 days**.

**Why not one year, which is the regulation.** 49 CFR Part 379 Appendix A puts bills of lading,
freight bills, waybills and the rest of the core transportation documents at **one year**. That is the
floor, and a carrier that keeps only that is compliant — and also defenceless, because the *claim*
clock is longer than the *record* clock.

**Why three.** Under the Carmack Amendment (49 U.S.C. §14706(e)) a carrier may not set a claim-filing
window shorter than **nine months** from delivery, nor a suit window shorter than **two years** from
the day the carrier denies the claim. Stacked, a proof-of-delivery photo can be the deciding evidence
close to three years after the load ran. Retaining for one year and destroying the photograph that
would have won the claim is the worst of both outcomes: compliant, and out of pocket.

**Why not longer.** Beyond the Carmack exposure the photo is a liability rather than an asset — it is
personal-adjacent data about a driver's day with no remaining business purpose. Keeping it forever
because storage is cheap is how a retention policy becomes a discovery problem.

**Cost, so the number is not abstract.** A twelve-stop load with two photos per stop is roughly 5MB.
A hundred loads a week is about 26GB a year, so the third year of retention costs on the order of a
single-digit dollar figure per month per hundred-load-a-week carrier. The claim it protects against is
four figures.

**How it is enforced, using what already exists.** `load_stop_photos` joins `RETENTION_RULES` at
1,095 days. The row goes first; the object then has no row pointing at it, and the existing
`reconcileBucketOrphans` sweep — already wired for `load-photos` — removes the bytes on its next pass
after the 24-hour grace. Two mechanisms that were each built for something else compose into the whole
policy, and neither needed changing.

**The one guard we cannot express, stated rather than hidden.** The retention framework filters on
columns of the table it prunes, and `load_stop_photos` does not carry the load's status — so "never
purge a photo for a load that is not terminal" is not expressible today. At 1,095 days it is also not
a real risk: a load still `in_transit` after three years is a data defect, not a live load. If per-org
configuration ever lowers the number materially, that guard has to be built first.

---

**Sources:** [49 CFR Part 379 Appendix A — schedule of records and periods of retention](https://www.law.cornell.edu/cfr/text/49/appendix-A_to_part_379) · [Benesch — Document Retention for Motor Carriers and Transportation Brokers](https://www.beneschlaw.com/resources/your-guide-to-document-retention-for-motor-carriers-and-transportation-brokers.html) · [Carmack Amendment cargo-claim time limits](https://snjlegal.com/2015/06/30/time-limits-for-filing-a-cargo-claim-under-the-carmack-amendment/) · [Fisher Phillips — 7 best privacy practices for employer geolocation](https://www.fisherphillips.com/en/news-insights/7-best-privacy-practices-for-employers.html)
