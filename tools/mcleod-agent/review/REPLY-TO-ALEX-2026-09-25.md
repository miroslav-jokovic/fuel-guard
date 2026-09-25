**Subject:** Updated SQL file and a few questions before the dry run

**Attach:** `SILVICOM-READ-ROUTINE.sql` (this folder, as on `main`). The connector folder and the two
secrets go separately.

---

Hi Alex,

Thanks for going through all of it. Everything in your reply works for us, and we've built to it.

**The updated SQL file** is attached. As you asked, this is the one to review before anything goes live. It has the same statements as the version you saw. No new tables and nothing that writes. The movement and stop queries now also read the fields you listed:

- stop location name
- actual arrival and departure
- ETA
- stop contact
- PO number
- customer code
- weight and pieces

It also reads a few you didn't list, so you can see them before they run:

- stop phone
- stop id
- weight unit
- pallets
- consignee reference number
- the movement's loaded flag
- the company id and movement id as plain columns, so each row carries its own key

If any of these shouldn't come across, tell me and they come out before the dry run.

**Where things stand on our side:**

- **Output:** the service logs only counts, times and McLeod ids. I also changed the dry run so it doesn't print whole loads. It shows how many movements and stops it read and how many of them have each field filled in. No addresses, names or phone numbers show on screen.
- **Finance:** switched off in the connector's settings until the finance grants are in place, so nothing touches those tables early.
- **Company matching:** every join still matches on company_id, and the settled-movements fix is still in.
- **The connector folder:** I'll send it separately, with the two secrets sent separately again.

**A few questions:**

1. **reference_number and customer:** the loads connection reads LME directly, not the analytics copy. Could these two grants go straight onto LME? Finance can stay on the analytics copy first, as you said. It's only these two that feed the load board: the PU number and the customer name.
2. **The one-time close:** the last check found about 181 loads that are still open in Silvicom 360 but finished in McLeod (178 delivered, 3 voided). Would you like the list of movement ids beforehand so you can spot-check a few in McLeod?
3. **The open-load count:** which McLeod board view should we both look at during the dry run, so we're comparing the same number? Last time I counted about 160.
4. **The finance night:** once the grants are on the analytics copy, which night works for you to watch? I can send the row counts per table from our side the next morning to compare with yours.
5. **The VM:** do you have a rough date for when it'll be up?

**Two times for the 30 minutes:**

- [day, time]
- [day, time]

The plan for the session is the one from your reply:

1. The dry run, and checking the count against the board.
2. The one-time close.
3. Starting the service and watching the log for the first few minutes.
4. Switching off the roster sync on my laptop.
5. Your finance grants on the analytics copy.

Thanks,
Miki
