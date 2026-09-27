/**
 * Part 1's words — "Get started" (APPLICATION-FLOW-V2-PLAN.md §6.2, AW3, C3a).
 *
 * ── WHY A FILE OF ITS OWN ─────────────────────────────────────────────────────────────────────
 * `strings.identity.ts`'s reason: `strings.ts` and `strings.flow.ts` sit near the 500-line budget. It is
 * spread into `APPLY_COPY`, so `strings.test.ts` walks every string here — no citation reaches a phone.
 *
 * ── THE VOICE, AND THE TWO QUESTIONS THAT NEED IT MOST ────────────────────────────────────────
 * `strings.ts`'s house rule: the fact, then the next action, and a sensitive question says why in the
 * same breath. Two screens here lean on that hardest. The drug-and-alcohol questions are asked of every
 * applicant by law and read as an accusation if they arrive bare, so each says it is asked of everybody
 * and what happens with the answer. And the rights summary is a federal form the applicant is owed
 * BEFORE the carrier pulls a report — the screen says that, rather than presenting four pages of
 * regulator addresses as if they were a hurdle.
 *
 * ⚠ The screening questions restate the regulation in plain words and must keep its limits: the two
 * years, "a job you applied for and did not get", the thirty days, six months and twelve months. A
 * shorter question is a different question.
 */
export const APPLY_PART_ONE_COPY = {
  partOne: {
    step: (n: number, of: number): string => `Step ${n} of ${of}`,
    back: "Back",
    next: "Continue",
    working: "Saving…",
    failed: "That did not save. Check your signal and try again.",
    /** A screen whose answers are already on file, reached again with Back. */
    onFile: "You have already given these. Leave them blank to keep them, or type them again to change them.",
    /** A screen some of whose boxes were filled from the licence's barcode (AW5) — the driver confirms them. */
    fromLicence: "Some answers below were read from your licence. Check them, and change anything that is wrong.",
    kept: (carrier: string): string =>
      `${carrier} already had some of these on file, so those were kept. If anything is wrong, tell ${carrier}.`,
    yes: "Yes",
    no: "No",
    about: {
      heading: "About you",
      intro: (carrier: string): string =>
        `${carrier} uses these to check your driving record and to reach you about your application.`,
      phone: "Mobile phone number",
      phoneHint: "A US number. We will only text you if you agree to it later.",
      dateOfBirth: "Date of birth",
      dateOfBirthHint: "For example, 3 7 1985. Your driving record is looked up with it.",
      missingPhone: "Enter your mobile phone number.",
      /** Any number that will not normalise — the schema's "too short" and "too long" are for developers. */
      badPhone: "Enter a US mobile number, ten digits.",
      missingDateOfBirth: "Enter your date of birth.",
    },
    address: {
      heading: "Where you live now",
      intro: "We use this to find a drug-test site near you.",
      line1: "Street address",
      line2: "Apartment, suite or unit (optional)",
      city: "City",
      state: "State",
      postalCode: "ZIP code",
      missing: {
        address_line1: "Enter your street address.",
        city: "Enter your city.",
        state: "Choose your state.",
        postal_code: "Enter your five-digit ZIP code.",
      },
    },
    licence: {
      heading: "Your CDL",
      intro: "Enter it as it appears on your licence.",
      state: "Issuing state",
      stateHint: "Start typing to find it.",
      number: "Licence number",
      cdlClass: "Class",
      expiresOn: "Expiry date",
      endorsements: "Endorsements (tick any you have)",
      endorsementLabels: {
        H: "H — Hazardous materials",
        N: "N — Tank vehicle",
        X: "X — Tank and hazardous materials",
        T: "T — Double and triple trailers",
        P: "P — Passenger",
        S: "S — School bus",
      },
      missing: {
        state_code: "Choose the state that issued your CDL.",
        licence_number: "Enter the number on your CDL.",
        cdl_class: "Choose the class on your CDL.",
        expires_on: "Enter the expiry date on your CDL.",
      },
    },
    otherLicences: {
      heading: "Other licences in the past 3 years",
      question: "In the past 3 years, have you held a driver's licence other than this CDL — from another state, or another country?",
      hint: "Include licences that have expired. Your driving record is checked in every state that issued you one.",
      listHeading: "Other licences",
      add: "Add a licence",
      addAnother: "Add another licence",
      save: "Add this licence",
      remove: "Remove",
      cancel: "Cancel",
      state: "State or province",
      agency: "Issuing authority (only if it is not a US state)",
      number: "Licence number",
      expiresOn: "Expiry date (if you know it)",
      needOne: "Add the licence, or answer No.",
      duplicate: "This licence is already on the list.",
      missingState: "Choose the state or province that issued it.",
      missingNumber: "Enter the licence number.",
      answerFirst: "Answer Yes or No.",
      entry: (state: string, number: string): string => `${state} · ${number}`,
    },
    screening: {
      heading: "Two questions about drug and alcohol testing",
      intro: "Every carrier must ask every driver these. Answering yes does not end your application.",
      priorPositive:
        "In the past 2 years, did you test positive, or refuse to test, on a pre-employment drug or alcohol test for a driving job you applied for and did not get?",
      program30d: "In the past 30 days, were you in a DOT drug and alcohol testing program?",
      tested6m: "In the past 6 months, did you take a DOT drug test?",
      random12m: "For the past 12 months, were you in a DOT random testing program?",
      programHint: "These help decide whether you need a new drug test. The carrier checks them with your last employer.",
      answer: "Answer this question.",
    },
    /**
     * Screens 8–10, the scanner (§6.6.1): what to photograph on the first line, how on the second, one
     * "Take photo", then the picture large with "Use this photo" / "Retake". Nothing is sent before
     * "Use this photo", so the words never say "uploaded" until it has been.
     */
    photo: {
      cdl_front: { heading: "Photo of the front of your CDL", hint: "The side with your photo on it.", outline: "Front of your CDL" },
      cdl_back: { heading: "Photo of the back of your CDL", hint: "The side with the barcode.", outline: "Back of your CDL" },
      /** AW5: the barcode is read in the phone, after the photo is saved. Reading it never blocks Continue. */
      reading: "Reading the barcode on your licence…",
      readFilled: "We read your licence's barcode and filled in some of the next screens. Check each answer before you continue.",
      readNothing: "The barcode could not be read. That's fine — you'll type your details on the next screens.",
      medical_card: { heading: "Photo of your medical card", hint: "Your DOT medical examiner's certificate.", outline: "Your medical card" },
      howTo: "Lay it on a flat surface. No flash, and all four corners in the picture.",
      take: "Take photo",
      /** §6.6.6: the camera was refused, or the photo is already on the phone. Same screen, same checks. */
      upload: "Upload a photo instead",
      use: "Use this photo",
      retake: "Retake",
      chooseAnother: "Choose another photo",
      check: "Can you read every word, and are all four corners in? If not, retake it.",
      sending: "Sending…",
      received: "Received.",
      /** Taken on an earlier visit: the server keeps the photo, and this page is not shown it (X6). */
      receivedEarlier: "Received on an earlier visit. Take it again only if it was the wrong card.",
      takeAgain: "Take it again",
      /** Continue pressed with a photo taken but not sent. */
      unsent: "Press “Use this photo” to send it, or Retake.",
      failed: "That did not send. Check your signal, then press “Use this photo” again.",
      /** D-AW9: the server re-hashed the object and it was not the photo sent (422 `capture_not_intact`). */
      notIntact: "That photo did not arrive intact. Take it again.",
      required: "Take the photo to continue.",
      noMedicalCard: "I don't have a medical card yet",
      noMedicalCardHint: "You can carry on. You will need one before you travel.",
    },
    rights: {
      heading: "Your rights",
      intro: (carrier: string): string =>
        `Before ${carrier} checks your background, you are owed this summary of your rights. Read it, then continue.`,
      contacts: "Federal agencies",
      acknowledge: "I have read this",
      changed: "The summary has been updated. Reload the page to read the current one.",
    },
    /**
     * Screen 20 (§6.2): the Clearinghouse. The carrier's full query needs the driver's consent GIVEN IN
     * THE CLEARINGHOUSE, which needs a registration only the driver can make — so this is the one thing
     * a waiting driver can do to speed their own hire, and the screen says so.
     */
    clearinghouse: {
      heading: "One thing you can do now: register with the Clearinghouse",
      body: (carrier: string): string =>
        `Before you can drive, ${carrier} must check the FMCSA Drug & Alcohol Clearinghouse, and you have to approve that check inside the Clearinghouse yourself. Registering now means you can approve it the day ${carrier} asks.`,
      steps: [
        "Go to clearinghouse.fmcsa.dot.gov and choose Register.",
        "Sign in with a Login.gov account (you can create one there).",
        "Register as a driver, using your CDL number and state.",
        (carrier: string): string => `When ${carrier} asks, sign in and approve their request.`,
      ],
      link: "Open the Clearinghouse",
      url: "https://clearinghouse.fmcsa.dot.gov/",
      already: "Already registered? Then there is nothing to do until you are asked.",
    },
  },
} as const;
