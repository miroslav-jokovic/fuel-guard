**2026-11-20 · Track S · Tenstreet TS4: the Settings card that sets up the connection and its address**

- **API** (`recruiting/routes/tenstreet.ts`, `recruiting/tenstreet/connection.ts`): `GET /api/recruitment/tenstreet/connection`
  (the card's status), `PUT` (Company ID, mode, on/off), `POST …/rotate-key` (a new address). All three are
  `requireSection("recruitment")`, manage. Rotate always asks for a fresh sign-in; switching on asks too (Med-Stop's
  sweep and ordering rule); switching off never does. Audited as `recruitment.tenstreet.connection_saved` (what
  moved) and `recruitment.tenstreet.key_rotated` (the new hint only, never the key).
- **The key**: 32 random bytes, base64url (43 characters, inside the receiver's shape check). It is stored as the
  receiver's own `hashTenstreetKey` with its last four characters, and answered once, `no-store`. A test rotates and
  then posts with the new key (accepted) and the old one (401). Turning on with no key is a 409 in words. A Company ID
  another account holds (0640's unique) is a 409 in words.
- **The address** is `PUBLIC_API_URL` + the receiver's path, the way FleetPal's `receiverUrl` builds its own. Unset,
  the card shows the key and says where it goes; it never prints a guessed URL.
- **Web**: `TenstreetConnectionCard.vue` + `useTenstreetConnection.ts` on Settings › Recruiting, shown only to
  callers who manage recruiting (`session.can("recruitment")`); a viewer's page never reads the route. A replacement
  address is asked first ("the old one stops working at once"). The address is shown whole once, read to Tenstreet
  by phone (D-TS7). A refused step-up becomes the password prompt.
- **Departure, said:** 0640's `tenstreet_connections.last_error` is written by nothing (the receiver only clears
  it). So the card's last problem is read from `tenstreet_posts`: the newest refusal, with the receiver's own
  `REJECT_TEXT` sentence (now exported), or the newest post that could not become a lead. The column stays; dropping
  it is not worth a migration until something either writes it or a release passes without a reader.
- **Not done here:** the browser pass with the three fixtures moves to TS6, on staging, with the owner's first
  connection. The plan's "no post for 3 business days" alert (`connectionAlert.ts` pattern) is not built yet.
- **Adds to the TS1+TS3 entry:** #2589's first CI run was red twice. The drain test's kind list lacked
  `tenstreet_post_process`. The tenant-isolation seeder could not build a `tenstreet_posts` row, because it read
  single-column keys only and the connection is one per org. It now follows a same-org pair `(org_id, X)` and reuses
  an org's existing row for such a parent. Both fixes merged with #2589.
- **Proved** API 23 planted faults, web card 11, page gate 2: all red, none by timeout. Next: TS5 (the "From
  Tenstreet" section in the lead drawer, and Tenstreet in the channel filter).
