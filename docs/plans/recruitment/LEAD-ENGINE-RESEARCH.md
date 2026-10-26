# Lead collection engine — research (2026-09-25)

Companion to `LEAD-SOURCING-PLAN.md` §3a. The question the owner asked: *which engines and
practices exist for collecting driver leads against a set of requirements, and what should ours
be?* Everything below was read on 2026-09-25. Vendor figures are vendor claims unless a source
says otherwise.

---

## 1. The five families of engine that exist

### A. Profile-index AI sourcing (Juicebox/PeopleGPT, hireEZ, SeekOut, Findem, Eightfold)

**How they work:**
1. Crawl public profiles from 30–45+ sites (LinkedIn-adjacent data, GitHub, publications,
   company sites) into one index of 750M–1B people.
2. Enrich each profile with a phone and email bought from third parties.
3. Let a recruiter describe the role in plain language; an LLM turns that into a ranked search.

Juicebox also runs standing "agents" that re-run a brief continuously. Findem joins each career to
company timelines and cross-checks claimed skills against code or publications.

**Why this does not work for us:**
- **The index has no drivers in it.** It is built from where knowledge workers leave traces, and
  CDL drivers leave almost none of those traces.
- **Contact data is poor.** Reviews report hireEZ contact bounce rates up to 30%.
- **It is the legal model under attack.** *Kistler v. Eightfold* (filed 2026-01-20) argues that
  exactly this pattern — score people on data joined from many sources they did not give you — is
  an unregistered consumer report.
- **Cost.** Median contracts are about $13k (hireEZ) to $20k (SeekOut) a year.

**What to borrow:** the *standing brief*. The recruiter's requirements are a saved query the engine
keeps running, and new matches appear in a queue. This is the right product shape.

### B. Trucking audience networks (Randall Reilly, CDLLife/CDLConnect, Conversion, CDL Funnel, Drive My Way, Tenstreet Pulse)

**None of these scrape.** They own an audience or buy media, and aim it at a driver profile:

| Vendor | How they collect leads |
|---|---|
| Randall Reilly | Behavioural data from its own driver sites, plus retargeting and Facebook/YouTube ads by experience type. In one 12-month period of 2022 it delivered 1.16M unique driver leads to 888 clients. |
| CDLLife | 195–356k newsletter subscribers, an app with about 904k monthly sessions, and about 511k Facebook followers. Its CDLConnect arm pools 20+ channels. |
| CDL Funnel | *"We don't sell names."* Ads on search, social, YouTube and programmatic networks, each built against the carrier's **Ideal Driver Profile** (lane, home time, pay, area, experience rules). Staff then help drivers finish the application; they claim 85–90% completion. They deliver full applications into the carrier's ATS. |
| Drive My Way | Drivers set about 23 preferences, and a patented engine matches them to jobs *before* either side commits. It sells "genuine interest", not volume. |
| Tenstreet Pulse Match | Shows our active job only to drivers whose Pulse profile fits it. Sold monthly. |

**What to borrow:** the **Ideal Driver Profile** is the unit the whole industry targets. Our
Hiring Profile (plan §4) is the same thing, and it should drive every connector. Also, quality
vendors sell *applications* or *matched interest*, not raw names. That is the owner's "not 1,000
junk leads" instinct, and it is the industry's own conclusion too.

### C. Opt-in driver resume databases — "drivers searching for jobs", already collected

| Database | Size / price (as published) |
|---|---|
| **JobsInTrucks.com** | 440k–500k+ driver profiles, searchable by route type, experience and location. 300 resume searches a month; new-match email alerts; free database preview for a new account; price by quote. |
| **Indeed Smart Sourcing** | For example, 2,493 truck-driver profiles in the Indianapolis area alone. Filters on CDL and tanker. Boolean and AI search. 14-day free trial. |
| TruckingCrossing | from $399/month; resume views capped |
| MeetATruckDriver | from $69/month |
| Hiring-Drivers.com | ~40k applications, **purged every 30 days** (so always fresh). Figure from 2019, needs re-checking. |
| iHireTransportation, Trucker Search, Drive My Way community | searchable pools; filter by licence class, years, equipment |

These people **chose to be found by employers**. The profile already holds CDL class, experience
and a contact. On intent, lawfulness and contactability this is the best raw material there is.
**None offers us an API.** The practical engine is our requirements turned into each site's search
(search assist), plus one-click capture into our pipeline.

### D. Social-listening engines (F5Bot, Syften, Octolens, KWatch, Redreach, Buska, Linkeddit)

This is the architecture the owner is describing:

1. saved keyword/Boolean queries
2. a stream of new posts and comments
3. an **AI intent filter**
4. an alert or queue item with a drafted reply

Coverage is Reddit, X, Hacker News, YouTube, Stack Exchange and LinkedIn.
**None reliably covers Facebook groups.** Their shared finding is that keyword matching alone
produces "hundreds of irrelevant alerts per qualified lead", and that AI intent scoring is the
whole product. Prices run from free (F5Bot) to $49.95/month with API (Syften Standard). GummySearch
closed to new sign-ups in November 2025 after Reddit's API pricing. Reddit now requires manual
approval for every API client and a paid licence for commercial use.

**What to borrow:** the query → stream → intent filter → queue pipeline, and **measuring by
precision** ("qualified leads per alert"). **Buy, don't build**, for Reddit and X: a $50/month
listener with a webhook into our pipeline is cheaper than our own Reddit commercial licence.

### E. Scraping infrastructure (Apify actors, Bright Data)

Ready-made Facebook group scrapers exist on Apify at **$2.50–$4 per 1,000 posts**. There are two
kinds:

- **Cookieless (public groups only).** These call Facebook's internal GraphQL feed while logged
  out; no account is involved.
  - *Legal position:* *Meta v. Bright Data* (N.D. Cal., 2024-01-23; Meta dropped its appeal)
    held that logged-out scraping of public data does not breach Meta's terms. *hiQ v. LinkedIn*
    (9th Cir.) says it is not "unauthorised access" under the CFAA.
  - *Remaining exposure:* the posts contain personal data (CCPA), the district ruling binds no
    other court, and an internal endpoint can change or close without notice.
- **Cookie-based (private groups).** These act as a logged-in member. The vendors themselves warn
  of checkpoints and **permanent bans**, and advise "burner" accounts, which themselves break
  Meta's fake-account rule. **Excluded** (plan D-LS1).

---

## 2. Where drivers actually say they want work

- **Demand is high and contested.**
  - The Spring 2026 Conversion/PDA survey found **58.1% of drivers looking for a new job**, a
    record (46.8% a year earlier). Top reasons: home time (63.7%) and predictable pay (61.6%).
  - **Over 90% are contacted by other carriers every week.** A driver who posts is flooded
    within hours, so **speed and relevance of the human first contact decide who wins**, not
    volume.
- **Facebook.** 63% of drivers use it (Trucker News survey, cited 2023). It is the largest venue,
  and mostly inside groups.
- **TruckersReport "Seek Employment" forum.** A public forum section **where drivers post that they
  want work**, for free. Its posts carry exactly our requirement fields: experience, trailer type,
  home time, area, MVR issues. It is still active (a post dated 2025-11-16 reads "looking for local
  between Winchester VA and Harrisburg PA"). Employer posts there need a DOT number. The volume is
  modest, but the quality and intent are exactly right. **It is the best automated-crawl candidate
  found** (terms and `robots.txt` to be checked, Q-LS5e).
- **Resume databases** (§1C). Largest opted-in pool.
- **Referrals.** Historically about 40% of carriers' hires (Trucking Dive, 2021). One carrier
  reports 46% retention for referral hires against about 25% for job-board hires.
- **AI assistants.** 23% of drivers use AI tools to explore jobs, and searches for "CDL jobs" are
  falling year over year (Conversion Q1 2026). **Our own job pages must be readable by AI
  assistants and Google for Jobs** (plan S4). That is inbound sourcing, and it costs nothing.
- **Telegram / community channels.** Small (the largest found had 810 subscribers), and several
  forbid soliciting. Low value. Also a caution: sourcing through channels defined by language or
  national origin can produce a discriminatory *effect*, which Illinois HB 3773 makes actionable
  regardless of intent. Every channel is measured for who it reaches (plan S7).
- **Craigslist.** Its terms forbid scraping, and it won against 3Taps. Excluded.

---

## 3. The AI part: what is known to work

- **Detecting a job-seeker post is a rare-class problem.** Most posts in trucking spaces are
  carrier ads, scams or chat. The closest published work (Tonneau et al., ACL 2022, World Bank)
  built a classifier for first-person *"is looking for a job"* posts on Twitter. Their findings:
  - a supervised model trained on random labels does poorly on a class this rare
  - a few rounds of **active learning** (labelling the model's most uncertain cases) gave large
    gains in precision and recall
  - their English model is public (`worldbank/bert-twitter-en-job-search`)
- **Zero-shot LLMs are good for starting, not for finishing.** Studies from 2024 found that
  zero- or few-shot GPT and Claude classification is "reasonable for early exploration". Fine-tuned
  small models match or beat it once there are about 1,000 labelled examples.
- **Consequence for us:**
  1. Start with Claude Haiku zero-shot plus a handful of our own examples. The existing
     `callClaude` forced-tool output is enough for this.
  2. **Every recruiter decision on a signal is a label.** "Not a driver", "recruiter ad" and
     "good lead" are stored.
  3. Report the classifier's precision weekly against those labels.
  4. Revisit fine-tuning only if precision stalls after about 1,000 labels.
- **Extraction must quote.** Each extracted fact carries the span of text it came from, so a
  recruiter can check "3 yrs OTR" against the post in one glance. The industry's contact data is
  30% wrong; ours must show its evidence.
- **Matching stays deterministic** (plan D-LS2). Every family in §1 that ranks by an opaque score
  is either being sued or is not transparent to the carrier.

---

## 4. What this means for our engine

Ranked by (intent × contactability × lawfulness) ÷ build effort:

| # | Connector | Family | Build or buy | Why this rank |
|---|---|---|---|---|
| 1 | **Resume databases** (JobsInTrucks, Indeed Smart Sourcing): our Hiring Profile turned into each site's search; the recruiter captures results into our pipeline | C | Buy the subscription; build search assist + capture | Opted-in, has contact details, has our fields. No scraping. |
| 2 | **Public job-seeker forums** (TruckersReport Seek Employment), crawled logged-out | E-lite | Build (small) | Right intent, public, low volume. The first automated connector. |
| 3 | **Facebook groups via recruiter capture** (browser button / paste box) | — | Build | This is where drivers are. A person picks each post, so there is no ban and no terms breach. |
| 4 | **Reddit / X** through a listening service's webhook | D | Buy (~$50/mo) | Low driver volume. Not worth our own API licence. |
| 5 | **Public Facebook groups, cookieless** (Apify-style) | E | Pilot only after counsel | High volume, but a moving internal endpoint and CCPA exposure. |
| — | Owned inbound: job pages, Google for Jobs, AI-readable, lead form | B-lite | Build (plan S4) | CDL Funnel's lesson: aim at the Ideal Driver Profile and complete the application. |
| — | Profile-index AI sourcing (Juicebox, hireEZ) | A | **No** | No drivers in the index; the FCRA theory is aimed at it. |

**One pipeline behind all of them** (plan §3a): capture → classify → extract with quotes → dedupe
→ deterministic match → promote to a lead (D-LS9) → **a person contacts** (D-LS6). Every
recruiter decision is fed back as a label.

---

## 5. Measure before building: a two-week pilot (proposed S5a)

The repo's rule is to measure before claiming. Nobody has measured what fraction of each source's
posts are *qualified, contactable job seekers*. Every figure above is a vendor's.

1. Build only the pipeline and the paste box (no connectors).
2. For two weeks, recruiters paste what they would have read anyway:
   - JobsInTrucks free preview
   - Indeed Smart Sourcing trial
   - TruckersReport Seek Employment
   - 3–5 Facebook groups they already belong to
3. For each source, measure:
   - share classified as job seeker
   - share meeting the known hard requirements
   - share with a contact path
   - share reached
   - share that applied
   - recruiter minutes per promoted lead
   - the classifier's precision against the recruiters' verdicts
4. Then build connectors **in the order the numbers give**, not the order in §4. The pilot also
   yields the first few hundred labels for §3.

**Needs before the pilot:** the Hiring Profile's hard requirements (Q-LS1/Q-LS2); whether to take
the JobsInTrucks and Indeed trials (Q-LS7); and recruiters' time.

---

## Sources

- Profile-index sourcing: [Juicebox — best AI sourcing tools](https://info.juicebox.ai/best-ai-sourcing-tools), [hireEZ vs SeekOut (Pin)](https://www.pin.com/blog/hireez-vs-seekout/), [SeekOut vs hireEZ pricing (Glozo)](https://www.glozo.com/blog/seekout-vs-hireez), [Findem 3D data](https://www.findem.ai/why-findem/3d-data), [Fox Rothschild on the Eightfold class action](https://dataprivacy.foxrothschild.com/2026/04/articles/general-privacy-data-security-news-developments/when-ai-meets-the-fcra-what-the-eightfold-class-action-means-for-employers-and-hr-technology-providers/)
- Trucking networks: [Randall Reilly recruiting trends (Jul 2022)](https://randallreilly.com/drivers/research-reports-drivers/monthly-driver-recruiting-trends-for-july-2022/), [CCJ on high-tech driver recruiting](https://www.ccjdigital.com/business/article/14931356/high-tech-driver-recruiting-part-ii-online-engagement), [CDLLife advertising](https://advertise.cdllife.com/), [CDL Funnel](https://cdlfunnel.com/home), [Drive My Way](https://www.drivemyway.com/), [Tenstreet Pulse Match](https://www.tenstreet.com/blog/marketing/pulse-match)
- Resume databases: [JobsInTrucks (Betterteam review)](https://www.betterteam.com/jobsintrucks-com), [JobsInTrucks](https://www.jobsintrucks.com/), [Indeed Smart Sourcing](https://www.indeed.com/employers/solutions/smart-sourcing), [Indeed truck-driver profiles, Indianapolis](https://www.indeed.com/candidates/hire-truck-drivers-in-indianapolis-in), [TruckingCrossing (Betterteam)](https://www.betterteam.com/truckingcrossing), [Hiring-Drivers.com](https://www.hiring-drivers.com/), [Trucker Search](https://www.truckersearch.com/home/drivers)
- Social listening: [F5Bot vs Syften vs Octolens (Prowlo)](https://prowlo.com/blog/f5bot-vs-syften-vs-octolens-vs-prowlo), [Best Reddit monitoring tools 2026 (SnitchFeed)](https://snitchfeed.com/blog/best-reddit-monitoring-tools-2026), [Buska — social listening for lead generation](https://www.buska.io/blog/best-social-listening-tools-for-lead-generation-2026), [Reddit Data API 2026 (Prowlo)](https://prowlo.com/blog/reddit-data-api)
- Scraping: [Apify Facebook Groups Scraper](https://apify.com/apify/facebook-groups-scraper), [Apify — group posts without login](https://apify.com/data-slayer/facebook-group-posts), [Farella Braun on *Meta v. Bright Data*](https://www.fbm.com/publications/major-decision-affects-law-of-scraping-and-online-data-collection-meta-platforms-v-bright-data/), [TechCrunch on the Groups API shutdown](https://techcrunch.com/2024/02/05/meta-cuts-off-third-party-access-to-facebook-groups-leaving-developers-and-customers-in-disarray/)
- Driver behaviour: [Transport Topics — Spring 2026 survey](https://www.ttnews.com/articles/trucking-turnover-risk-2026), [Conversion/PDA Spring 2026 survey](https://theresource.conversionia.com/spring-2026-truck-driver-survey), [Conversion Q1 2026 data](https://conversionia.com/blog/q1-2026-driver-recruiting-retention-data-shows-widening-hiring-gap-between-fleets-using-ai-and-those-that-are-not), [Spring 2025 survey (The Trucker)](https://www.thetrucker.com/trucking-news/business/trucker-exodus-new-survey-reveals-nearly-47-of-drivers-seeking-new-jobs), [Avatar Fleet — social media recruiting](https://www.avatarfleet.com/blog/recruiting-truck-drivers-using-social-media), [Trucking Dive — referrals](https://www.truckingdive.com/news/truck-driver-recruitment-social-media-clarissa-rankin-referrals/610314/), [TruckersReport Seek Employment forum](https://www.thetruckersreport.com/truckingindustryforum/forums/seek-employment.361/), [Telemetrio — USA Truck Drivers channel](https://tlmtr.io/en/channels/1219425116-usatruckdrivers)
- AI classification: [Tonneau et al., ACL 2022](https://aclanthology.org/2022.acl-long.453/), [worldbank/bert-twitter-en-job-search](https://huggingface.co/worldbank/bert-twitter-en-job-search), [Fine-tuned small LLMs vs zero-shot (arXiv 2406.08660)](https://arxiv.org/abs/2406.08660), [BERT vs GPT for classification (arXiv 2411.05050)](https://arxiv.org/html/2411.05050v1)
