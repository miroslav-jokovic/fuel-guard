/**
 * The careers page's words (APPLY-PAGE-PLAN AP3, D-AP7). English only (D-AP8; Spanish is Q-AP2).
 *
 * The texting box's words are NOT here: the server composes them (`SMS_APPLY_PAGE_CONSENT`, carrier named) and the
 * page shows exactly what is stored on the consent row. Everything below is the page's frame.
 *
 * The EEO statement and the privacy notice are drafts that counsel confirms along with the texting wording (the plan's
 * header). Each names only what the code does. The notice lists the fields `applySubmitSchema` carries plus what the
 * API records beside them (`raw.client`: IP address and browser; `raw.checks`: the robot check). It names Cloudflare
 * because its script runs on the page and receives the visitor's data. It promises no retention period, since that
 * is Q-REC7 and still open.
 */
export const EEOC_KNOW_YOUR_RIGHTS_URL = "https://www.eeoc.gov/poster";

export const CAREERS_COPY = {
  list: {
    heading: (carrier: string) => `Driving jobs at ${carrier}`,
    lead: "Pick a job to see its pay, what it asks of a driver, and a short form to apply.",
    none: "There are no open driving jobs on this page right now.",
    noneHint: "Check back soon, or use the contact below.",
    see: "See the job and apply",
  },
  job: {
    back: "All jobs",
    pay: "Pay",
    homeTime: "Home time",
    equipment: "Equipment",
    schedule: "Kind of run",
    lanes: "Lanes",
    area: "Hiring area",
    start: "Start date",
    benefits: "Benefits",
    bonus: "Bonus",
    requirements: "What the job asks",
    classA: "A valid Class A CDL",
    minAge: (years: number) => `At least ${years} years old`,
    minYears: (years: number) => `At least ${years} ${years === 1 ? "year" : "years"} of Class A driving`,
    hazmatRequired: "A hazmat (H or X) endorsement",
    hazmatPreferred: "A hazmat endorsement is a plus, not required",
  },
  form: {
    heading: "Apply for this job",
    lead: "It takes about a minute. Nothing here asks for your licence number, address or Social Security number.",
    fullName: "Full name",
    phone: "Mobile number",
    phoneHint: "US number. Give a mobile number, an email, or both.",
    email: "Email",
    honeypot: "Leave this field empty",
    smsHeading: "Text messages",
    smsLinks: "Read our",
    privacy: "Privacy Policy",
    smsTerms: "SMS Terms",
    opensNewTab: "(opens in a new tab)",
    robotCheck: "Robot check",
    robotCheckHint: "Cloudflare checks that a person is sending this form. It usually finishes on its own.",
    robotCheckFailed: "The robot check could not load. You can still send the form.",
    send: "Send my application",
    sending: "Sending…",
    offline: "Your application was not sent: there is no connection. Your answers are still here; try again.",
    failed: "Your application was not sent. Your answers are still here; try again in a moment.",
    gone: "This job is no longer open for applications.",
    chooseOne: "Choose one.",
  },
  sent: {
    heading: "Application sent",
    body: (carrier: string, title: string) => `${carrier} has your application for ${title}.`,
    next: "A recruiter will contact drivers who fit the job, using the number or email you gave.",
    more: "See other jobs",
  },
  footer: {
    eeo: (carrier: string) =>
      `${carrier} is an equal opportunity employer. We consider every applicant without regard to race, color, religion, `
      + "sex (including pregnancy, sexual orientation and gender identity), national origin, age, disability, genetic "
      + "information, or any other status protected by law.",
    kyr: "Know your rights: workplace discrimination is illegal (EEOC)",
    accommodationHeading: "Need help applying?",
    accommodation: "If a disability makes this form hard to use, or you need another accommodation to apply, contact us:",
    privacyHeading: "What this form keeps",
    privacy: (carrier: string) =>
      `When you send this form, ${carrier} keeps what you typed and chose: your name, mobile number, email, your answers, `
      + "the job, and whether you ticked the texting box. It also keeps the time, your device's IP address and browser, "
      + "and the result of the robot check. Cloudflare runs that check (Turnstile) and receives your IP address and "
      + "browser details to do it. We use this to contact you about the job and to keep out automated submissions.",
  },
  notFound: {
    heading: "This page is not available",
    body: "The careers page or the job you followed is not open right now.",
  },
  loadFailed: "This page could not load. Check your connection and reload.",
} as const;
