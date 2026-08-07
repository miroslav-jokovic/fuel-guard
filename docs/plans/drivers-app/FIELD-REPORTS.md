# Driver app — field reports

First real device install, 2026-08-07. The APK pipeline works; these are what the owner found on the
phone. Recorded here so they survive the turn they were mentioned in — none is being worked yet.

| # | Report | First read | Status |
| --- | --- | --- | --- |
| FR1 | **Safe-area problems on Android.** Content is not respecting the system insets. | `app.config.ts` sets `edgeToEdgeEnabled: true`, which makes the app draw behind the status and navigation bars — correct for a modern Android app, but only if every screen consumes the insets. `Screen.tsx` and the custom `TabBar` are the two places to check first; the `footer` slot added in the check-in rebuild is a likely offender because it sits outside the ScrollView. | Open |
| FR2 | **Nothing hazmat is connected.** | Expected, and not a bug in the app: `hazmat.capture` resolves through `org_modules` → `driver_app_features`, and the HazmatGuard entitlement has not been granted to Silvicom yet. That is **P0 step 5** of the platform-console plan — grant it through the console, not by SQL. Worth re-testing only after that lands. | Blocked on P0 |
| FR3 | **Image capture runs but nothing is stored.** | The most serious of the three, because it is silent. The driver-app capture path stages bytes, uploads them to Storage with the user's JWT under an RLS INSERT policy, then posts the metadata. A failure at the upload step is currently swallowed, and a failure after it leaves a row pointing at an object that does not exist. LD3 adds detection for the second case from the dispatch side; the driver-side cause still needs its own investigation, and FR2 may be masking it — with the module ungranted, the hazmat capture screen has no server to post to. | Open |
| FR4 | **Scanner edge detection is weak.** Capture works, edges are unreliable. | Owner-reported, deferred by the owner. Lives in `apps/driver/modules/capture-native` and the capture-engine package. | Deferred |

**Read FR2 before FR3.** If the hazmat module is not granted, the capture screen's writes have nowhere
to land, and FR3 may be a symptom rather than a defect. Granting the entitlement is a five-minute
console action once the console is deployed, and it changes what FR3 even looks like.
