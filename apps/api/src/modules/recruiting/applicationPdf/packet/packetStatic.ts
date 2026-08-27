/**
 * The packet's four STATIC pages — policy and contract text with nothing to fill (P3, D-PKT1/D-PKT3).
 *
 * Pages 7–8 (Rules and Regulations) and 29–30 (Owner Operator & Leased Driver Agreement). Under fork
 * (b) these are attached rather than filled: they are identical for every applicant, so they are
 * rendered once per VERSION and referenced, never redrawn per submission.
 *
 * ── ⚠ THERE WERE FIVE, AND PAGE 24 WAS NEVER ONE OF THEM (Q-PKT5, 2026-08-23) ─────────────────
 * `DRIVER SAFETY TRAINING` shipped here on 2026-08-23 and came out the same day. It is not policy
 * text: it carries a fill-in date (`On this day, ____________, 20___`), a printed name, a DRIVER
 * signature and an INSTRUCTOR's signature, and it affirms a training the signer has **completed**.
 * An applicant cannot truthfully affirm training they have not had, and a document filed once per
 * version can never carry anybody's mark — so it was three signature lines rendered as inert labels
 * inside a document nobody signs.
 *
 * It is a post-hire training record, and it left the packet for the same reason pages 21 and 23 did:
 * the act it evidences happens after this document is signed. `DRIVER-TRAINING-PLAN.md` / R7 owns it.
 * **The finding was not that the transcription was wrong — it was verbatim and the test proved it.
 * The classification was wrong, and no test can check a classification.**
 *
 * ── HOW THIS TEXT GOT HERE, AND WHY THAT MATTERS MORE THAN USUAL ──────────────────────────────
 * Extracted from `docs/plans/recruitment/APPLICATION.xlsx` by parsing `sheet1.xml` against
 * `sharedStrings.xml`, NOT retyped. A hundred lines of somebody else's policy and contract is exactly
 * the volume at which a human transcription acquires a silent error, and `packetStatic.test.ts`
 * re-reads the workbook at test time and compares — so what a reviewer checks is the carrier's own
 * text rather than an engineer's typing.
 *
 * The spreadsheet's dot-leaders (`$..........10.00`) and multi-space column padding are collapsed to
 * single spaces, because they are Excel's column geometry rather than the carrier's words.
 *
 * ── ⚠ THE POLICY PAGES ARE SPELL-CORRECTED. THE AGREEMENT IS NOT. ─────────────────────────────
 * D-PKT9 says the packet's typos are corrected in print, and pages 7 and 8 get that treatment
 * through the same `CORRECTIONS` register the fillable pages use.
 *
 * **Pages 29–30 are reproduced VERBATIM, deliberately.** They are a contract — a driver signs it on
 * page 31 — and "correcting" a contract is drafting one. `has red and understood` is a typo;
 * `shall not he appeasable` and `select a natural arbitrator` are a mangled arbitration clause, and
 * the difference between "natural" and "neutral" is the difference between two different agreements.
 * Choosing the right word there is counsel's act, not a copy pass. See §3.8 of the plan for the list.
 */

export interface PacketStaticPage {
  /** The carrier's own page number, printed in the footer. */
  page: number;
  heading: string;
  /** One entry per line as the workbook has it. */
  body: readonly string[];
}

/**
 * ⚠ **Verbatim from the workbook.** Corrections are applied at RENDER time by `correct()` rather than
 * stored here, which is the opposite of `packetText.ts`'s field labels and is deliberate: those are
 * short strings assembled by hand, these are long passages extracted from a source of truth that a
 * test re-reads. Keeping the extraction pristine is what makes that test meaningful.
 */
export const STATIC_PAGES: readonly PacketStaticPage[] = [
  {
    page: 7,
    heading: "RULES AND REGULATIONS (part 1 )",
    body: [
    "Following is a summary of Company policies, fines, and rewards",
    "LOGS PENALTIES",
    "1. LATE RECORDS OF DUTY STATUS ( MISSING FOR OVER 25 DAYS) $ 10.00 PER DAY",
    "2. MISSING FUEL RECEIPTS $ 20.00 EACH",
    "3. HOURS OF SERVICE 1ST OOS VIOLATION $ 500.00",
    "4. HOURS OF SERVICE 2ND OOS VIOLATION $ 700.00",
    "5. HOURS OF SERVICE 3RD OOS VIOLATION | TERMINATION",
    "TICKET PENALTIES",
    "1. SEAT BELT VIOLATION $ 200.00",
    "2. TICKETS, OTHER THAN SPEEDING | 1ST $50.00 | 2ND $100.00 | 3RD $250.00",
    "3. SPEEDING | 1 TO 10 MILES OVER $250.00",
    "15 MILES OVER $350.00",
    "MISC PENALTIES:",
    "1. FAILURE TO REPORT/TURN IN A ROADSIDE INSPECTION | $ 150.00",
    "2. FAILURE TO NOTIFY THE COMPANY OF A CDL SUSPENSION | $..1,500.00",
    "3. ALLOWING A NOT-QUALIFIED OR UNAUTHORIZED PERSON TO DRIVE | $..1,500.00",
    "4. FAILURE TO REPORT AN ACCIDENT IMMEDIATELY | $..1,500.00",
    "5. FAILURE TO REPORT AN ACCIDENT INVOLVING TOW OR INJURY OR FATALITY | TERMINATION",
    "6. TOWING COSTS FOR ILLEGAL/IMPOREPER PARKING | DRIVER LIABILITY",
    "7. CITATION FOR OVERWIGHT TRAILER | DRIVER LIABILITY",
    "(ALL DRIVERS MUST SCALE LOAD BEFORE REACHING PUBLIC SCALE OR HIGHWAY)",
    "INSURANCE DEDUCTIBLES",
    "TRACTOR PHYSICAL DAMAGE ( covers our truck) | $..2,500.00",
    "TRAILER PHYSICAL DAMAGE ( covers our trailer) | $..2,500.00",
    "CARGO INSURANCE ( covers damaged or missing freight) | $..2,500.00",
    "LIABILITY INSURANCE ( covers others trucks or property) | $..2,500.00",
    ],
  },
  {
    page: 8,
    heading: "RULES AND REGULATIONS (part 2 )",
    body: [
    "TRACTOR-TRAILER CONDITION AND REPAIRS",
    "ALL DRIVERS MUST RETURN VEHICLE IN SAME CONDITION AS RECEIVED. YOU WIL INSPECT IT WHEN",
    "RECEIVED, AND AGAIN WHEN RETURNED. YOU WILL BE CHARGED FOR ANY NEEDED REPAIRS",
    "TO RETURN VEHICLE TO SAME CONDTION AS WHEN RECIVED, MINOR WEAR AND TEAR EXEPTED.",
    "FUEL POLICY",
    "• | DRIVER MUST ENTER PROPER UNIT NUMBER",
    "• | DRIVER MUST ENTER CURRENT ODOMETER",
    "• | DRIVER MUST FUEL ONLY ONCE PER DAY",
    "• | DAILY LIMIT IS 175 GALLONS FOR SINGLE DRIVERS, 200 GALLONS FOR TEAM",
    "• | PURCHASE FUEL ONLY FROM AUTHORIZED LOCATIONS",
    "OTHER MAINTENANCE POLICIES",
    "ALL REPAIRS MUST BE AUTHORIZED BY FLEET/EQUIPMENT MANGER",
    "(You will not be reimbursed if not authorized)",
    "MAINTAIN AIR PRESSURE IN TIRES AT 100 PSI FOR THE REAR, AND 110/120PSI FOR THE FRONT",
    "(Depending of equipment 120/110, fine is $50 for EACH under-inflated tire)",
    "OIL MUST BE CHANGED EVERY 35,000 MILES",
    "(You will be fined $100 for going over miles without an oil change)",
    ],
  },
  {
    page: 29,
    heading: "Owner Operator& Leased Driver Agreement (part 1)",
    body: [
    "SILVICOM, INC also known as (Carier) and",
    "(Owner Operator - Independent Contractor)",
    "Are entering this independent contract used for the purpose of obtaining driving privileges with",
    "SILVICOM, INC for:",
    "(Independent Contractor/DRIVER FOR (Owner Operator - Independent Contractor)",
    "Also known as driver for:",
    "Independent contractor",
    "a.k.a driver is not an employee of Silvicom Inc, (CARRIER ) He/she also understands Silvicom Inc is not liable for any personal",
    "injuries that the driver may receive while working for its employer also known as Independent Contractor/ Owner operator.",
    "Driver understands and agrees that:",
    "a) He/She is not an employee of Silvicom Inc and is not entitled to make any claims against the trucking company, including but not",
    "limited to No fault benefits, workers compensation, unemployment benefits, and industrial accident benefits, paid vacation, sick",
    "leave, helth insurance, or any other type of insurance whatsoever.",
    "b) He/She must enter the Customer premises and perform contracted serivces in good and professional manner. There will be no",
    "claims from the Leased driver against our Customers for personal injuries unless there has been an accident caused by the",
    "incompetence of one of the Customers employees in which case Silvicom Inc is responsible to open a law suit against",
    "the Customer in beneft of the leased Driver.",
    "c) He/She agrees to read and understands all the rules and regulations required by all local, state and federal laws.",
    "d) Driver, if involved in an accident must notify disptacher no later than two hours and present a written accident report within 24",
    "hours following and such accident",
    "*Untill the statue of limitation has expired on any accident, the Driver agrees to cooperate with the company regarding any claims,",
    "lawsuits, including discovery requests, interrogatories, request to produce, deposition and appearance at trail. Failure to do so",
    "may result in the driver being personally responsible for the claim or lawsuit.",
    "*Driver is responsible for any legal fees, unpaid insurance claim or personal lawsuits.",
    ],
  },
  {
    page: 30,
    heading: "Owner Operator& Leased Driver Agreement (part 2)",
    body: [
    "a.k.a Driver",
    "Read and understood this agreement.",
    "I agree with all the conditions of this contract. I will not violate any of the above-mentioned conditions",
    "and I understand that if l do not follow them my employer may be charged, or his contract may be",
    "terminated.",
    "I sign this contract on my own free will. I am not under any drug or alcohol influence. No one from",
    "SILVICOM. INC or elsewhere made me sign this document. I understand that this document is a legal",
    "binding contract, and it can be used against me in the court of law. Upon signing this contract I agree with",
    "all conditions and rules of SILVICOM, INC. aka (Carrier ), I understand that the only one responsible for my",
    "salary is my employer, aka (Owner Operator), I agree not to have any salary or payment discussions with",
    "any employee of SILVICOM, INC, aka (Carrier).",
    "This agreement shall be governed by the laws of the state of Illinois, both as to interpretation and",
    "performance other than injunctive or equitable relief, the parties agree that all matters will be submitted",
    "to binding arbitration, and action brought by either of the parties arising out of this agreement shall be",
    "commenced and maintained within the jurisdiction of the State of Illinois. The parties agree and consent",
    "and do not object that service of process by regular mail or certified mail whether or not signed for) at the",
    "last known address or personal service on either of the parties outside of the State of Illinois shall be",
    "sufficient to give The State of Illinois and any court or arbitration panel personal jurisdiction over",
    "either of either of the parties. In the state of Illinois, each party shall appoint one arbitration and arbitrators",
    "so appointed shall select a natural arbitrator. The determination of a majority of arbitrators shall be",
    "bending on the parties, shall not he appeasable, and judgment on the award/decision rendered may be",
    "entered in any Illinois or other court having jurisdiction over the matter/parties. Each party is responsible",
    "for its own cost and expenses (including, but not limited to attorney fees and one half of the fees and",
    "expenses of the neutral arbitrator) incurred in enforcing its rights under the arbitration process. The",
    "arbitrators are not empowered to award damages in excess of compensatory damages. Driver has had",
    "adequate time to review and read this acknowledgement and is signing it voluntarily without force or",
    "correction. Driver further agrees that he/she is familiar with the English language and has red and",
    "understood this contract. If any one or more of the provisions contained in the",
    "Agreement but the Agreement will be enforceable to the extend applicable.",
    "Failure to read this Agreement does not prevent its enforcement.",
    ],
  }
];
