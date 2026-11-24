# Recruiter flight search and booking recommendation

November 3, 2026

FuelGuard books approximately 2–10 tickets a week for drivers coming from across the United States. The recommended starting point is an applicant travel workflow powered by Duffel Managed Content, conditional on a route comparison and confirmation of company payment and support arrangements. Recruiters would search, compare total costs, and purchase inside FuelGuard. AI can prepare searches and explain choices; a recruiter confirms the passenger, itinerary, and final charge.

Nationwide origins make airline coverage a deciding factor. Duffel is a candidate for a pilot, rather than an unconditional vendor selection. If it misses important routes or fares, compare a managed travel provider such as Perk AmTrav before building the full integration.

## Existing FuelGuard capabilities

The analysis uses locally available `origin/main` at `d259940`, dated November 3, 2026. The working branch is an older October 8 checkout. This review does not verify the deployed production version.

Main already includes an applicant travel panel, organization and recruiter access checks, application-linked travel history, audit events, and a separate action to email and text trip details. Open screening steps generate warnings; they do not prohibit recording travel. Preserve this policy and the separate send action.

Relevant source files are `apps/web/src/features/recruitment/TravelPanel.vue`, `apps/api/src/modules/recruiting/applicantTravel.ts`, `apps/api/src/modules/recruiting/routes/travel.ts`, and migration `0376_applicant_flow_v2.sql`.

The existing service inserts travel records. It does not search airline inventory, charge for a flight, or issue tickets. Its cancel action only marks a database row cancelled. Replacing a trip marks earlier local records cancelled, which does not cancel an airline reservation. These behaviors need separate treatment for provider bookings.

Current records lack provider order IDs, ticket issuance status, flight segments, prices, payment state, and refund or credit tracking. Current manual times use the carrier organization's time zone; airline itineraries need departure and arrival airport local times as well as stored UTC instants.

## Provider choices

| Choice | Fit for FuelGuard | Decision |
| --- | --- | --- |
| Duffel Managed Content | Search and ticketing APIs; company-specific interface can stay inside FuelGuard. | First pilot candidate, conditional on nationwide coverage, payments, and support. |
| Perk AmTrav | Established guest and candidate travel workflows, company billing, and managed travel operations. | Compare if operational simplicity or coverage outweighs a fully custom interface. Confirm integration rights and pricing. |
| Spotnana | APIs and embedded booking interfaces, including policy and servicing features. | Request a quote only if Duffel fails the pilot or its embedded product materially reduces development work. Minimums and onboarding require confirmation. |
| Amadeus Self-Service | Production ticket issuance requires a consolidator or accreditation; documented airline exclusions matter for US shopping. | Poor first choice for this use case. |

Duffel's published airline list includes American, United, Frontier, and JetBlue. Delta, Southwest, and Spirit do not appear in that list; obtain explicit current coverage confirmation and test real routes. A listed airline does not guarantee every fare is available. [Duffel airlines](https://duffel.com/flights/airlines)

Perk AmTrav advertises candidate travel, non-profiled travelers, and central billing. Perk also documents an AI connector with flight search and booking actions, but that alone does not establish rights or capabilities for embedding its booking experience in FuelGuard. [Perk AmTrav](https://www.perk.com/amtrav/), [Perk MCP](https://developers.perk.com/docs/perk-mcp)

Spotnana explicitly offers embedded components, an iframe option, and APIs for search, booking, exchanges, and cancellations. Commercial suitability at this volume remains a quote question. [Spotnana capabilities](https://www.spotnana.com/travel-providers/travel-providers-faqs/)

Amadeus documents missing American, Delta, British Airways, and low-cost content in its Flight Offers Search guide, and requires a consolidator or accreditation for production ticketing. [Amadeus developer guide](https://github.com/amadeus4dev/developer-guides/blob/master/docs/resources/flights.md)

## Recruiter workflow

1. Open the applicant and select **Find flights**. Prefill verified traveler information, with confirmation of the legal name and other airline-required passenger details before purchase.
2. Enter the driver's starting city or ZIP code, destination office or airport, and arrival deadline. Airports remain editable. Nationwide origins do not imply a fixed destination.
3. Search practical nearby departure and arrival airports. Offer flexible dates when the recruiter permits them. Account for airport access and the time needed to reach the office.
4. Show **Lowest total cost**, **Best practical option**, and **Nonstop**, when available. Include taxes, required baggage, provider charges, and known ground transport costs. Clearly label estimates and missing ancillary prices.
5. Show stops, airport local times, baggage, and fare restrictions. Filter out self-transfers and overnight connections by default, with an explicit exception option.
6. Refresh the chosen offer. The recruiter reviews the exact passenger, itinerary, rules, and final total, then selects **Book for $X**. A higher price requires a fresh confirmation.
7. Show **Booking in progress** until the provider confirms the outcome. Display **Ticketed** only after issuance is verified, including an equivalent confirmed state for ticketless airlines.
8. Save the itinerary and receipt against the application. Keep the existing explicit **Send trip details** action and add check-in information and pickup instructions.

“Cheapest” should mean the lowest total cost among trips that meet the driver's arrival needs. No single feed should be represented as guaranteeing the cheapest fare across the entire market. Keep an external-booking record option for coverage exceptions, with accurate wording about what FuelGuard can manage.

AI should translate requests such as “Find this driver the lowest total cost flight arriving before orientation, with one checked bag” into structured searches. Prices, availability, and booking results must come from provider responses. The production feature should run in FuelGuard's backend and respect recruiter permissions and spending rules.

## Pricing and payment

Duffel currently publishes $3 per confirmed order, plus 1% for Managed Content, and $2 per paid ancillary. It also charges for searches above its 1,500-to-one search/order allowance. [Duffel pricing](https://duffel.com/pricing)

Illustration: a $300 order costs $6 in these base provider fees, or $8 with one paid ancillary, excluding the ancillary's own price. At 104–520 orders annually, assuming one ticket per order, $6 per order is $624–$3,120 a year. These figures exclude development, maintenance, support, payment-related charges, FX, and applicable taxes. They are not a savings forecast.

For company-funded applicants, evaluate a bank-funded Duffel Balance first. Keep a reserve and low-balance alerts because top-ups are not instant. Alternatively, obtain written approval for company-card payments: the Managed Content card terms restrict business-name cards without prior consent. [Payment methods](https://duffel.com/docs/guides/choosing-a-payment-method), [Top-up timing](https://help.duffel.com/hc/en-gb/articles/360019652520-How-long-will-it-take-for-a-top-up-to-land-in-my-account), [Services agreement, section 5](https://duffel.com/services-agreement)

Confirm who assists drivers during disruptions. Duffel's standard terms leave first-line support with the customer unless Traveller Support is used; its help center describes urgent priority support for travel within 48 hours. Obtain the actual support scope and price for this account. [Services agreement, section 3](https://duffel.com/services-agreement), [Support](https://help.duffel.com/hc/en-gb/articles/360019645580-Where-do-I-go-for-help-and-support)

## Required implementation

Extend the existing travel panel and Express API with a provider adapter. Store booking attempts, provider orders, flight segments, costs, and servicing events separately from the operational travel summary. Keep organization and application links throughout.

Use an application-level purchase key, a database lock against concurrent purchases, and a durable pending state. A network timeout can leave the result unknown; reconcile with the provider instead of immediately trying again. Duffel specifically warns against retrying an accepted order request. [Response handling](https://duffel.com/docs/api/overview/response-handling)

Process verified webhooks with duplicate-event protection and scheduled reconciliation. A successful airline booking must remain recoverable if the local database write fails. Only confirmed ticketed trips should satisfy the travel checklist.

Provider cancellation must obtain the applicable quote and show the refund or credit before confirmation. Track cancellation requested, cancelled, refund pending, refunded, and credit issued separately. Do not mark a provider ticket cancelled merely because a local row was replaced. Exchanges must track additional charges and the old ticket's outcome.

Keep provider credentials and payment handling on the server; use provider-approved payment components if cards are supported. Restrict booking references and traveler details to authorized staff. Maintain purchase and servicing audit events without exposing booking credentials. Keep financial records appropriately separated from applicant record deletion.

Test the failures that could lose money or mislead recruiters: double-clicks, two recruiters buying concurrently, expired or changed offers, uncertain booking results, issued tickets followed by database failure, duplicate webhooks, and cancellations that produce credit rather than cash.

## Pilot and decision

First confirm that Duffel accepts this internal company-funded candidate travel use, the payment method, and the required support arrangement. Then compare approximately 20 representative nationwide searches with airline-direct and current booking results, using the same flights, bags, dates, and final checkout totals. Include short-notice trips, smaller airports, and routes where the potentially missing airlines matter.

Measure inventory gaps, total price differences, booking time, and servicing effort. Compare Perk AmTrav's commercial proposal against the combined API, development, and support cost. Proceed with Duffel only if its practical coverage and total economics justify the custom integration.

Build search and comparison first, then purchase and recovery, then changes, cancellation, credits, and optional AI assistance. Launch to a small recruiter group with a real servicing process before wider use. No vendor account, live purchase, or application behavior was changed by this analysis.
