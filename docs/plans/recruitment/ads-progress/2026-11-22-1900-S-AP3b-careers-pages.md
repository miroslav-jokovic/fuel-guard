# S-AP3b · The public careers pages — 2026-11-22

APPLY-PAGE-PLAN AP3, on top of AP3a (#2613, the careers host).

**What was built**
- **Routes** (`router/routes/careers.ts`): `/careers/:handle` (the list) and `/careers/:handle/jobs/:openingId`
  (one job and its form).
  - Both are public and indexable, under the `apply` layout: no sign-in, 44 px controls, the carrier named.
  - Pinned in `routeTable.test.ts`'s public list with their reason.
- **Calls** (`features/careers/careersApi.ts`): `/api/public/careers` on the page's own origin, never `VITE_API_URL`
  (D-AP9). There is no session header, for `publicFetch`'s reason. The job is never refetched, because each read
  issues a new form token.
- **Job facts.** The pay range comes first. The opening's facts use the editor's own labels, now shared
  (`packages/shared/.../openingText.ts`, moved from `openingForm.ts`). The requirements come from the hiring
  profile version.
- **The form**:
  - **Fields:** name, mobile, email, and the questions exactly as the server served them.
  - **Checking:** before sending, by `applySubmitSchema` itself; the server's 400 is placed under the field it
    names.
  - **The texting box:** unticked, its served words shown whole, and SMS Terms and Privacy Policy beside it on the
    office host in a new tab.
  - **The honeypot:** hidden, outside the tab order and the accessibility tree.
  - **Turnstile:** rendered explicitly with action `apply`, only when the API serves a site key. It never blocks
    sending.
  - **After sending:** the confirmation takes the form's place and receives focus. A job closed meanwhile says so.
- **Footer (D-AP7):**
  - accommodation contact;
  - what the form keeps, naming the IP address, the browser and Cloudflare;
  - the EEO statement;
  - the EEOC poster (`https://www.eeoc.gov/poster`, read 2026-11-22; the EEOC encourages web posting).

  Every link is a `/careers` route or an absolute address.
- **Head.** Each page sets its own title, description and canonical link (`pageUrl` from the API), and removes them
  on leaving. No page in the app set a head before.
- **API** (`publicCareers.ts`): both views gain `pageUrl` (the careers host's address) and `legalOrigin`
  (`WEB_APP_URL`).
- **Privacy policy:** a new section, "Applying on a carrier's careers page", at `#careers-page`. `LEGAL_VERSION`
  is now 1.4.
- **Openings tab:** an open opening that the careers page leaves out says why, using the server's own rule
  (`openingUnpublishedReason`).

**Wording that counsel confirms** with the texting wording: the EEO statement and the privacy notice
(`careersCopy.ts`). Each names only what the code does, and neither promises a retention period (Q-REC7).

**Tests**
- `CareersJobPage.test.ts` (12), `CareersListPage.test.ts` (4), `openingText.test.ts` (4), the privacy section (+1),
  the Openings tab (+1), and `publicCareers.test.ts` (+1).
- `e2e-apply/careersPage.spec.ts` (4) runs Chromium on the built app under production's CSP:
  - list → job → form → sent at 390 × 844 and at 1280 × 800;
  - axe at WCAG 2.2 AA on each page, with 0 violations;
  - every control is at least 24 px;
  - the robot check's token, from a stand-in for Cloudflare's script served on Cloudflare's own origin, travels
    with the form;
  - with no keys, no Cloudflare request is made and the application still goes;
  - a handle that is off reads as not available.
- **Mutation:** 24 faults were planted, and all are caught.
  - **Web (15):** one survived (a blank email sent as `""`), so an assertion was added and it is now caught.
  - **Shared (4)** and **API (3)**: all caught.
  - **Browser (2):** removing Turnstile from the CSP leaves the widget unloaded, and an unlabelled email field is
    flagged by axe's `label` rule. Both are caught.
