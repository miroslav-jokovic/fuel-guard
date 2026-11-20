**2026-11-20 · Track S · Tenstreet TS5a: "From Tenstreet" in the lead drawer, and a purged person's posts emptied**

- **Drawer**: `LeadTenstreetSection.vue`, mounted for a Tenstreet lead that is not purged. It reads
  `GET /api/recruitment/leads/:leadId/tenstreet` (`recruitment` view, the lead read's own gate, `no-store`), which
  takes the newest ACCEPTED, processed post still holding its body, unseals it, re-reads it with the receiver's parser
  and cuts it with the shared `tenstreetDrawerView`. It shows:
  - Tenstreet's status, worklist and recruiter, as of that post;
  - licences (class, CDL, state, current, endorsements; never the number) and employers (name, dates as sent);
  - accident and violation counts (null = not asked; a `Violation` answering "n" is not one);
  - the driving-record answers, labelled with the guide's own questions (p.3–4);
  - Tags, the carrier's custom questions with their question text, and document names (the files stay in Tenstreet).
- **Withheld (Q-TS11, new, counsel)**: `CriminalRecords` and the `ConvictedDrugs` answer are never sent to the browser.
  The drawer says Tenstreet sent such answers. A test asserts that sample 1's free text ("stole a truck", "pled
  guilty") and the licence number never appear in the response.
- **Fixed on the way**:
  - `leadAnswerRows` printed a Tenstreet lead's one `projection` key as a raw JSON "answer"; it is now channel-aware,
    like `factsFor`.
  - Deleting a lead's details (`leadPurge.ts`, 0558) left the person's sealed Tenstreet application in
    `tenstreet_posts`. It now empties every kept post of each purged lead (0640's purge), also for a lead purged
    earlier, and counts them on the audit row.
  - A post that lands on an already-purged lead (`ingest_lead` answers the tombstone as the duplicate) is emptied in
    the same update that marks it processed.
  - "Tenstreet" is a channel label.
- **Not built (Q-TS12)**: the channel filter. `recruiting_lead_queue` takes no channel and the page has no channel
  filter, so it needs a migration and then its reader, a merge apart.
- **Proved** by mutation: 20 planted faults in the API and shared view. Two survived at first, both missing tests:
  `CriminalRecords` alone setting the withheld flag (sample 1's `ConvictedDrugs` masked it), and a custom question
  showing its own text. Both tests were added, and both faults are now caught. The web drawer had 9 planted faults,
  all caught, none by a timeout. Next: the apply page (Q-APX31).
