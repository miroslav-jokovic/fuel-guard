# Phase B — Partnership / Data-Access Requests (ready to send)

Three requests, in priority order. Fill the `[bracketed]` placeholders before sending. Keep the framing
consistent everywhere: **we are a fleet software vendor whose fuel planner routes purchase volume TO the
chain's network** — data access makes their stores show up in plans; that's the value exchange.

> Company placeholders used below: `[Company]` = your legal entity, `[Product]` = the app's public name,
> `[You]` = your name/title, `[email/phone]`. Where volume numbers appear, they're honest and conservative —
> adjust as your fleet count grows.

---

## 1. Love's — "Store & Fuel Prices" Experience API (highest value: ~650 stops, official API)

**Where:** https://developer.loves.com → the "Loves Store & Fuel Price Exp API" listing → **Request Access**.
If the portal asks for a Love's contact or routes you to sales, the same text works as an email to your
regional Love's fleet-sales representative.

**Draft:**

Subject: API access request — fleet fuel-planning software (Store & Fuel Prices Exp API)

Hello,

I'm [You] at [Company]. We build [Product], a fuel-planning and fuel-security platform for small and
mid-size trucking carriers. Our dispatchers plan each trip's fuel stops from live truck state (tank level,
hours of service, route), and the planner recommends specific stations and gallon amounts along the route.

We'd like access to the **Store & Fuel Prices Experience API** so Love's locations and current diesel/DEF
prices can be represented accurately in those plans. Practically, that means Love's stops become
recommendable fuel stops for every carrier we serve — turning our price freshness into fuel volume directed
to your network. Without price data, a chain's stations are effectively invisible to an optimizer.

What we're asking for:
- Read-only access to the store directory + fuel price endpoints (diesel and DEF product codes).
- Modest, cache-friendly polling (network-wide pull a few times per day, not per-request fan-out).

About us: [Company] serves [N] carriers / ~[N] power units today, US + Canada OTR, primarily fuel-card
(EFS/Comdata) purchasers. We're happy to sign your API terms/partner agreement and to share aggregate
insights on how Love's stops perform in plan recommendations if useful.

Could you let me know the next step to get credentials for a sandbox or production access?

Thank you,
[You] · [Company] · [email/phone]

---

## 2. TA / Petro (BP) — developer portal token + fuel-price ask (~300 sites)

**Where:** https://www.ta-petro.com/developers/ → API access request form (Retail Service: Location &
Amenities, Parking, Showers). Note: **no fuel-price API is published** — the draft explicitly asks whether
pricing can be added to the grant; their answer also tells us whether a commercial data deal exists.

**Draft (form "use case" field or email):**

Subject: API access request — [Product] fleet fuel planning (Location API + fuel pricing question)

Hello,

[Company] builds [Product], a fuel-planning platform for trucking carriers: dispatchers enter a route and
truck, and the system recommends where to fuel and how many gallons, from live telematics and current pump
prices. We're requesting developer access to the **Retail Service APIs (Location & Amenities; Parking
Availability)** so TA and Petro sites are precisely represented (coordinates, diesel lanes, DEF, amenities)
in those recommendations.

Two questions alongside the access request:
1. Is site-level **fuel pricing** (the prices shown in TruckSmart and on ta-petro.com location pages)
   available through the API program, or through a commercial data agreement? Current diesel/DEF prices are
   what lets an optimizer actually route fuel purchases to TA/Petro sites.
2. If pricing requires a separate conversation, who is the right contact on the fleet/commercial side?

We serve [N] carriers (~[N] trucks), are happy to sign your API terms, and poll conservatively (a few
network-wide refreshes per day).

Thank you,
[You] · [Company] · [email/phone]

---

## 3. Pilot Company — data-license note (puts our current usage on contractual footing)

**Where:** Best route is warm: ask [Silvicom's / your anchor customer's] **Pilot fleet account
representative** for an intro to Pilot's digital/data partnerships team. Cold fallback: the contact form at
pilotcompany.com or your regional Pilot fleet sales office.

**Draft:**

Subject: Data partnership inquiry — fleet fuel-planning software using Pilot's public location/price data

Hello,

I'm [You] at [Company]. We build [Product], fuel-planning software for trucking carriers — several of whom
are Pilot fleet-card customers receiving your daily pricing reports (e.g., [Silvicom Inc., account 262568]).

Today our planner uses three Pilot-published sources: the "Download All Locations" export from
locations.pilotflyingj.com, the public fuel-price table on pilotcompany.com/fuel-prices (refreshed a few
times per day), and each carrier's own daily "Better Of" pricing email for their negotiated net. The result:
Pilot, Flying J and ONE9 locations are the *preferred* recommended stops in our customers' fuel plans.

We'd like to make this a formal arrangement:
1. A **data license / permission letter** covering our automated use of the public locations export and
   posted-price table inside our multi-carrier product, and
2. If available, a **direct feed** (file or API) of locations + posted prices, which would be more reliable
   for both sides than page refreshes, and
3. The right contact for future conversations about network-level programs for our carrier base.

We're a fuel-volume driver for your network, not a reseller of your data — prices appear only inside fuel
plans for authenticated carrier users. Happy to sign appropriate terms.

Who would be the right person to speak with?

Thank you,
[You] · [Company] · [email/phone]

---

## Tracking

| Request | Sent | Response | Credentials | Adapter built |
|---|---|---|---|---|
| Love's Store & Fuel Prices API | ☐ | | | blocked on access |
| TA developer portal (+pricing ask) | ☐ | | | blocked on access |
| Pilot data license / feed | ☐ | | | n/a (already live via public sources) |

When any of these lands, the build is small by design: one `StationSource`/`PriceSource` adapter against
their REAL responses + a brand entry in `brands.ts` + the network appears in the settings toggles.
