# DRAFT — not sent. Message to McLeod Software, via Ron (McLeod API Kit v2)

**Status:** draft written 2026-11-27 for the owner to send. Claude does not send it. It is the ONE message to McLeod for
the whole API Kit: every question is here, so no second message is needed. Send it the same day as
`ALEX-MESSAGE-DRAFT.md`, a few hours after it, with Cc Alex Tzakov (McLeod enables the API on Alex's server, and Alex
should have heard of it first).

**Before sending, the owner fills in** (this repository is public, so the real values are never written here):
- `<company name>` — Silvicom's legal name as McLeod has it on the order;
- `<order reference>` — the API Kit order or quote number from the 2026-11-19 purchase, if there is one;
- `<integration user>` — the LoadMaster web user name proposed to Alex (same value as in the Alex message).

---

**Subject:** API Kit for our self-hosted LoadMaster 22.1 — enablement and technical questions (`<company name>`)

Hi Ron,

Thank you for the API Kit (`<order reference>`). Please pass this to whoever enables the Direct-Hosted web services
(`/ws`) on our install. Our IT (Alex Tzakov, in Cc) runs the server; we build the integration. Everything we need is in
this one message.

1. **Enable** the Direct-Hosted `/ws` API on our self-hosted LoadMaster 22.1 production, and on a test company or a
   test server we may write to. If 22.1 cannot, which version is needed? Does enabling need a restart or a downtime
   window?

2. **What the order covers, in writing:** Direct-Hosted `/ws` on 22.1; any per-user, per-seat or per-call charge; the
   test company; a named technical contact for enablement. Our owners approved a fixed price of about $750 a month; any
   other charge (per call, per seat, a module, an upgrade) we need to know before we use the feature that causes it.
   (One clause for a later plan: is Symphony licensed for us?)

3. **Address and certificate:** the `/ws` base URL on our LAN; its TLS certificate (PEM) and SHA-256 fingerprint; whether
   the name on it is a DNS name. Please also confirm the values of `loadmaster.ws.useServerTimezone` and
   `loadmaster.api.maxresultsize` (we read them too).

4. **Company ids:** the `AnywhereCompanyID` for each of our companies and for the test company; is it `company.id` or the
   instance code?

5. **The integration user** (our IT creates it in LoadMaster): the steps; type `Users` only. Does LoadMaster user
   security (menu and table permissions) apply to `/ws` calls? Can the user be denied billing, settlement, deduction,
   payroll, wire, order entry and every delete while keeping the operations in item 6?

6. **Operations that user must reach.** Reads: `GET /metadata`, `/movements/search`, `/movements/{id}`, `/stops/{id}`,
   `/auditTransactions/search`, `/drivers/new`, `/drivers/{id}`, `/drivers/search`, `/tractors/{id}`, `/trailers/{id}`,
   `/images/{rowType}/{rowId}`, `/images/{id}`, `/images/{rowType}/{rowId}/documentTypes`, `/serviceFailures`, and
   TableRowService reads of `stop`, `callin`, `equipstatus` and the driver "reason for leaving" code table. Writes:
   `POST /dispatch/clearStop/{id}`, `POST /images/{rowType}/{rowId}/{documentTypeId}`, `PUT /drivers/create`,
   `PUT /driver/update`, `PUT /tractors/update`, `PUT /trailers/update`, `PUT /stop/update`, `PUT /callins/create`,
   `PUT /equipstatus/create` (through TableRowService as `Users`, since EquipStatusService is a Drivers-role service);
   `POST /users/login` and `/users/logout`.

7. **Sign-in:** token or `/users/login`? Token lifetime? **If the user is disabled, does a token already issued stop
   working at once?** Does a login hold a concurrent licence seat, and what `X-com.mcleodsoftware.LicensingAgent` value
   should an integration send?

8. **Dates and times:** do `/ws` dates carry a UTC offset, or are they the server's local time without a zone? To what
   precision does `clearStop` keep a time — seconds or minutes?

9. **`clearStop`:** is departure-only accepted? Must the stop be the next uncleared one? What happens on a second call
   for a stop already cleared? For a late stop with no `delayCode`: refused, or a service-failure record created? Does
   it run the same logic as a dispatcher's clear (status, EDI 214, notifications, billing, pay)? Which HTTP codes and
   refusal texts can it return?

10. **Un-clear:** is there any `/ws` way to un-clear a stop? (We expect none.)

11. **Call-ins:** does `PUT /callins/create` with `new_eta` update the stop's ETA, and can it trigger an EDI 214 or a
    customer notification?

12. **TableRowService:** which fields of `stop`, `driver`, `tractor` and `trailer` accept updates? Is an update partial
    (only the fields sent) or does it replace the whole row? Does `PUT /stop/update` with `eta` run dispatch logic? Is
    there a concurrency check? Is ending a driver who holds a truck or a dispatched load refused?

13. **`drivers/create`:** which fields are required on our install? Is `social_security_no` required? (We will never send
    it; if it is required, we will not use the create.)

14. **Images — where they land.** On our install, does `POST /images/...` file into DocumentPower, the imaging that our
    billing reads? Does it need the DocumentPower third-party image module, and is it licensed for us? Is the file
    stored at once or staged for a batch, and how long until `GET /images/{rowType}/{rowId}` lists it? Does the POST
    answer return the stored image's id or a batch id? May we read our own `/ws/docs` pages for our tests (never
    redistributed)?

15. **Audit:** is the audit on for `movement` and `stop`, and for how many days is it kept (`audit_log_tx` purge)?

16. **Rate and upgrades:** is there a call limit? Our plan: at most 2 calls a second, one at a time, about 1,000 calls a
    day. Do `/ws` calls stay the same across upgrades, 22.1 to 26.2 included?

Thank you,
Miki
