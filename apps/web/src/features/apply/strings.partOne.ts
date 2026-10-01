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
      expiresOn: "Expiry date",
      // Q-AW35 (a): required, because the application cannot be filed without it and nothing after
      // Part 1 can supply it. A licence given up on moving still has the date it was printed with.
      expiresOnHint: "The date printed on it — even if you gave it up.",
      missingExpiry: "Enter the expiry date printed on the licence.",
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
      /**
       * Screen 11 (AW6, §6.7). The why comes in the same breath as the ask (the house rule above): a face
       * is the most personal thing Part 1 asks for, and the three promises are the ones Q-AW5 (a) keeps —
       * a person looks, no face-matching software, and it is deleted after the staged-capture retention.
       * `APPLICATION_CAPTURE_KEEP_DAYS` is that retention, pinned to the pruner by an api test.
       */
      selfie: {
        heading: "A photo of you",
        hint: "Hold your phone at arm's length, face the screen, and fit your face in the oval.",
        outline: "Your face",
        howTo: "Take off sunglasses and a hat. Face a window or a light, not away from it.",
        why: (carrier: string, days: number): string =>
          `${carrier} will look at it next to your licence photo, to check the application is really yours. A person looks — no face-recognition software. It is not added to your file, and it is deleted ${days} days after you take it.`,
        check: "Is your whole face in the picture, and clear? If not, retake it.",
        receivedEarlier: "Received on an earlier visit. Take it again only if it did not show your face clearly.",
        cannot: "I can't take a photo of myself",
        cannotHint: "That's fine. Bring your licence when you come to the office, and they will check it's you there.",
        required: "Take the photo, or tick “I can't take a photo of myself”.",
      },
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
      /**
       * The live scanner (2026-09-30): the camera inside the page, for the CDL's two sides. The back takes
       * itself once its barcode reads; the front waits for the button. Every refusal names the way on — the
       * camera app is one press away in all of them.
       */
      live: {
        starting: "Opening the camera…",
        aim: {
          cdl_front: "Fit the card inside the corners, then press the button.",
          cdl_back: "Fit the card inside the corners. It takes the photo by itself once the barcode is clear.",
        },
        /** Which side goes up, said once above the frame, because the wrong side is the commonest bad photo. */
        side: {
          cdl_front: "Front — the side with your photo",
          cdl_back: "Back — the side with the barcode",
        },
        settling: "Hold still…",
        taking: "Got it.",
        shutter: "Take photo",
        close: "Close the camera",
        cameraApp: "Use the camera app instead",
        upload: "Upload a photo instead",
        /** The same two ways out, shorter, under the live view, where they sit side by side. */
        cameraAppShort: "Camera app",
        uploadShort: "Upload a photo",
        torchOn: "Turn the flashlight off",
        torchOff: "Turn the flashlight on",
        /**
         * Shown once, before the camera first opens on this visit: the three things that spoil a licence photo
         * — glare, a busy background, a card too small in the picture — said before they happen.
         */
        tips: {
          heading: "Photograph your CDL",
          flat: "Lay the card flat on a dark surface, like a seat or the dashboard.",
          glare: "Turn it away from lamps and windows so nothing shines on it.",
          fill: "Fill the frame with the card, all four corners showing.",
          open: "Open the camera",
        },
        tryAgain: "Try again",
        videoLabel: "Camera view",
        refused: {
          unsupported: "This browser cannot show the camera on this page. Use your camera app instead.",
          denied: "Camera access is off for this page. Use your camera app instead, or allow the camera in your browser settings and try again.",
          no_camera: "We could not find a camera. Use your camera app, or upload a photo.",
          busy: "The camera stopped, or another app is using it. Close that app and try again, or use your camera app.",
          too_low: "This phone's camera gives too few pixels on this page for a clear photo. Your camera app takes a sharper one.",
        },
      },
      /**
       * §6.6.6, the desktop handoff (C3b2b2). A computer has no camera worth photographing a licence
       * with, so the same link is offered to the phone — by QR code first, by text only to a number the
       * applicant already agreed to be texted on. This page moves on by itself once the photo arrives.
       */
      handoff: {
        heading: "Easier on your phone",
        body: "Scan this code with your phone's camera. It opens this same application, where you can take the photos. This page moves on by itself once they arrive.",
        qrLabel: "QR code that opens this application on your phone",
        waiting: "Waiting for the photo from your phone…",
        textMe: "Text me the link",
        texting: "Sending…",
        sent: (last4: string): string => `Sent to the number ending ${last4}. Open the link on your phone.`,
        held: {
          quiet_hours: "It is outside texting hours, so we did not send it. Scan the QR code instead.",
          no_consent: "Texts are off for this application, so we did not send it. Scan the QR code instead.",
          consent_revoked: "Texts are off for this application, so we did not send it. Scan the QR code instead.",
          suppressed: "You replied STOP to our texts, so we cannot send it. Scan the QR code instead.",
          no_number: "We have no number to text. Scan the QR code instead.",
        },
        failed: "The text did not go. Scan the QR code instead.",
        orHere: "Or, on this computer:",
      },
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
