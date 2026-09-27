import type { FcraSummary } from "@silvicom/shared";

/**
 * "A Summary of Your Rights Under the Fair Credit Reporting Act" — the CFPB's model form, shown on
 * Part 1's screen 12 (APPLICATION-FLOW-V2-PLAN.md §6.2, AW3, C3a).
 *
 * ── WHY THE APPLICANT READS THIS BEFORE THE PERMISSIONS ───────────────────────────────────────
 * FCRA §604(b)(2)(B) lets a carrier procure a report on a DOT applicant who applied "by mail,
 * telephone, computer, or other similar means" on an oral, written or electronic consent — provided
 * the applicant was given, before the report is procured, a notice and "a summary of the consumer's
 * rights under section 1681m(a)(3)". Until C3a that summary appeared nowhere: the PSP form mentions it
 * and nothing showed it (plan §4). Part 1 is entirely remote (D-AW2) and the reports are pulled after
 * the permissions, so the summary is the last screen of Part 1, and `complete_applicant_intake` will
 * not finish Part 1 until the server has stamped that it was shown (0376, AI007).
 *
 * ── WHICH SUMMARY: APPENDIX K, UNTIL COUNSEL SAYS OTHERWISE (Q-AW13) ──────────────────────────
 * Whether §604(b)(2)(B) wants the general Appendix K summary or a §615(a)(3)-shaped one is counsel's
 * question. Appendix K is the conservative answer meanwhile: it is the Bureau's own prescribed form,
 * and it covers everything a §615(a)(3) summary would.
 *
 * ── PROVENANCE, KEPT SO THE CLAIM IS CHECKABLE ────────────────────────────────────────────────
 * 12 CFR 1022 Appendix K prescribes "a disclosure that is substantially similar to the Bureau's model
 * summary". The eCFR publishes the model only as four images (88 FR 58066), so the text is taken from
 * the Bureau's own PDF of the same form, downloaded 2026-09-27 from `FCRA_SUMMARY_SOURCE_URL` (the file
 * is named 2018-09 but was produced 2023-04-13). It is the CURRENT form, which was checked two ways:
 * its first page matches the eCFR's page-1 image word for word, and it already carries both corrections
 * of the only later amendment (88 FR 58065, effective 2023-09-25 — the opt-out number 1-888-567-8688
 * on page two and "Office of Aviation Consumer Protection" on page four; that notice says nothing else
 * in the form changed). The PDF and its `pdftotext -layout` extraction are committed under
 * `docs/plans/recruitment/fcra-summary/`, and `fcraSummary.test.ts` finds every paragraph, list item
 * and contact line below in that extraction — so a transcription that drifts from the Bureau's form
 * fails the build, as `pspDisclosure.test.ts` does for FMCSA's.
 *
 * ⚠ Nothing is reworded, corrected or shortened, for the PSP form's reason: "substantially similar"
 * is the standard, and the only safe way to meet it is to reproduce. The one thing done to these
 * strings is collapsing the PDF's line wraps and page breaks, which are its geometry, not its words.
 *
 * ── THE VERSION ───────────────────────────────────────────────────────────────────────────────
 * `application_intakes.fcra_summary_version` records WHICH text an applicant was shown. It names the
 * amendment the text reflects, so a later amendment — or counsel's answer to Q-AW13 — is a new
 * version, and every stored row keeps pointing at the text it was shown under. Change the text, change
 * the version; the test pins the pair.
 */

export const FCRA_SUMMARY_VERSION = "cfpb-appendix-k-2023-09-25";

export const FCRA_SUMMARY_SOURCE_URL =
  "https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09.pdf";

export const FCRA_SUMMARY: FcraSummary = {
  version: FCRA_SUMMARY_VERSION,
  sourceUrl: FCRA_SUMMARY_SOURCE_URL,
  spanishNote:
    "Para información en español, visite www.consumerfinance.gov/learnmore o escribe a la Consumer Financial Protection Bureau, 1700 G Street NW, Washington, DC 20552.",
  title: "A Summary of Your Rights Under the Fair Credit Reporting Act",
  intro: [
    "The federal Fair Credit Reporting Act (FCRA) promotes the accuracy, fairness, and privacy of information in the files of consumer reporting agencies. There are many types of consumer reporting agencies, including credit bureaus and specialty agencies (such as agencies that sell information about check writing histories, medical records, and rental history records). Here is a summary of your major rights under FCRA.",
    "For more information, including information about additional rights, go to www.consumerfinance.gov/learnmore or write to: Consumer Financial Protection Bureau, 1700 G Street NW, Washington, DC 20552.",
  ],
  rights: [
    {
      heading: "You must be told if information in your file has been used against you.",
      blocks: [
        "Anyone who uses a credit report or another type of consumer report to deny your application for credit, insurance, or employment – or to take another adverse action against you – must tell you, and must give you the name, address, and phone number of the agency that provided the information.",
      ],
    },
    {
      heading: "You have the right to know what is in your file.",
      blocks: [
        "You may request and obtain all the information about you in the files of a consumer reporting agency (your “file disclosure”). You will be required to provide proper identification, which may include your Social Security number. In many cases, the disclosure will be free. You are entitled to a free file disclosure if:",
        [
          "a person has taken adverse action against you because of information in your credit report;",
          "you are the victim of identity theft and place a fraud alert in your file;",
          "your file contains inaccurate information as a result of fraud;",
          "you are on public assistance;",
          "you are unemployed but expect to apply for employment within 60 days.",
        ],
        "In addition, all consumers are entitled to one free disclosure every 12 months upon request from each nationwide credit bureau and from nationwide specialty consumer reporting agencies. See www.consumerfinance.gov/learnmore for additional information.",
      ],
    },
    {
      heading: "You have the right to ask for a credit score.",
      blocks: [
        "Credit scores are numerical summaries of your credit-worthiness based on information from credit bureaus. You may request a credit score from consumer reporting agencies that create scores or distribute scores used in residential real property loans, but you will have to pay for it. In some mortgage transactions, you will receive credit score information for free from the mortgage lender.",
      ],
    },
    {
      heading: "You have the right to dispute incomplete or inaccurate information.",
      blocks: [
        "If you identify information in your file that is incomplete or inaccurate, and report it to the consumer reporting agency, the agency must investigate unless your dispute is frivolous. See www.consumerfinance.gov/learnmore for an explanation of dispute procedures.",
      ],
    },
    {
      heading: "Consumer reporting agencies must correct or delete inaccurate, incomplete, or unverifiable information.",
      blocks: [
        "Inaccurate, incomplete, or unverifiable information must be removed or corrected, usually within 30 days. However, a consumer reporting agency may continue to report information it has verified as accurate.",
      ],
    },
    {
      heading: "Consumer reporting agencies may not report outdated negative information.",
      blocks: [
        "In most cases, a consumer reporting agency may not report negative information that is more than seven years old, or bankruptcies that are more than 10 years old.",
      ],
    },
    {
      heading: "Access to your file is limited.",
      blocks: [
        "A consumer reporting agency may provide information about you only to people with a valid need – usually to consider an application with a creditor, insurer, employer, landlord, or other business. The FCRA specifies those with a valid need for access.",
      ],
    },
    {
      heading: "You must give your consent for reports to be provided to employers.",
      blocks: [
        "A consumer reporting agency may not give out information about you to your employer, or a potential employer, without your written consent given to the employer. Written consent generally is not required in the trucking industry. For more information, go to www.consumerfinance.gov/learnmore.",
      ],
    },
    {
      heading: "You may limit “prescreened” offers of credit and insurance you get based on information in your credit report.",
      blocks: [
        "Unsolicited “prescreened” offers for credit and insurance must include a toll-free phone number you can call if you choose to remove your name and address from the lists these offers are based on. You may opt out with the nationwide credit bureaus at 1-888-567-8688.",
      ],
    },
    {
      heading: "The following FCRA right applies with respect to nationwide consumer reporting agencies:",
      blocks: [
        "CONSUMERS HAVE THE RIGHT TO OBTAIN A SECURITY FREEZE",
        "You have a right to place a “security freeze” on your credit report, which will prohibit a consumer reporting agency from releasing information in your credit report without your express authorization. The security freeze is designed to prevent credit, loans, and services from being approved in your name without your consent. However, you should be aware that using a security freeze to take control over who gets access to the personal and financial information in your credit report may delay, interfere with, or prohibit the timely approval of any subsequent request or application you make regarding a new loan, credit, mortgage, or any other account involving the extension of credit.",
        "As an alternative to a security freeze, you have the right to place an initial or extended fraud alert on your credit file at no cost. An initial fraud alert is a 1-year alert that is placed on a consumer’s credit file. Upon seeing a fraud alert display on a consumer’s credit file, a business is required to take steps to verify the consumer’s identity before extending new credit. If you are a victim of identity theft, you are entitled to an extended fraud alert, which is a fraud alert lasting 7 years.",
        "A security freeze does not apply to a person or entity, or its affiliates, or collection agencies acting on behalf of the person or entity, with which you have an existing account that requests information in your credit report for the purposes of reviewing or collecting the account. Reviewing the account includes activities related to account maintenance, monitoring, credit line increases, and account upgrades and enhancements.",
      ],
    },
    {
      heading: "You may seek damages from violators.",
      blocks: [
        "If a consumer reporting agency, or, in some cases, a user of consumer reports or a furnisher of information to a consumer reporting agency violates the FCRA, you may be able to sue in state or federal court.",
      ],
    },
    {
      heading: "Identity theft victims and active duty military personnel have additional rights.",
      blocks: ["For more information, visit www.consumerfinance.gov/learnmore."],
    },
  ],
  closing:
    "States may enforce the FCRA, and many states have their own consumer reporting laws. In some cases, you may have more rights under state law. For more information, contact your state or local consumer protection agency or your state Attorney General. For information about your federal rights, contact:",
  contactsHeading: { business: "TYPE OF BUSINESS:", contact: "CONTACT:" },
  contacts: [
    {
      business: "1.a. Banks, savings associations, and credit unions with total assets of over $10 billion and their affiliates",
      contact: ["a. Consumer Financial Protection Bureau", "1700 G Street NW", "Washington, DC 20552"],
    },
    {
      business: "b. Such affiliates that are not banks, savings associations, or credit unions also should list, in addition to the CFPB:",
      contact: ["b. Federal Trade Commission", "Consumer Response Center", "600 Pennsylvania Avenue NW", "Washington, DC 20580", "(877) 382-4357"],
    },
    {
      business: "2. To the extent not included in item 1 above: a. National banks, federal savings associations, and federal branches and federal agencies of foreign banks",
      contact: ["a. Office of the Comptroller of the Currency", "Customer Assistance Group", "P.O. Box 53570", "Houston, TX 77052"],
    },
    {
      business: "b. State member banks, branches and agencies of foreign banks (other than federal branches, federal agencies, and Insured State Branches of Foreign Banks), commercial lending companies owned or controlled by foreign banks, and organizations operating under section 25 or 25A of the Federal Reserve Act.",
      contact: ["b. Federal Reserve Consumer Help Center", "P.O. Box 1200", "Minneapolis, MN 55480"],
    },
    {
      business: "c. Nonmember Insured Banks, Insured State Branches of Foreign Banks, and insured state savings associations",
      contact: [
        "c. Division of Depositor and Consumer Protection",
        "National Center for Consumer and Depositor Assistance",
        "Federal Deposit Insurance Corporation",
        "1100 Walnut Street, Box #11",
        "Kansas City, MO 64106",
      ],
    },
    {
      business: "d. Federal Credit Unions",
      contact: ["d. National Credit Union Administration", "Office of Consumer Financial Protection", "1775 Duke Street", "Alexandria, VA 22314"],
    },
    {
      business: "3. Air carriers",
      contact: [
        "Assistant General Counsel for Office of Aviation Consumer Protection",
        "Department of Transportation",
        "1200 New Jersey Avenue SE",
        "Washington, DC 20590",
      ],
    },
    {
      business: "4. Creditors Subject to the Surface Transportation Board",
      contact: [
        "Office of Public Assistance, Governmental Affairs, and Compliance",
        "Surface Transportation Board",
        "395 E Street SW",
        "Washington, DC 20423",
      ],
    },
    {
      business: "5. Creditors Subject to the Packers and Stockyards Act, 1921",
      contact: ["Nearest Packers and Stockyards Division Regional Office"],
    },
    {
      business: "6. Small Business Investment Companies",
      contact: [
        "Associate Administrator, Office of Capital Access",
        "United States Small Business Administration",
        "409 Third Street SW, Suite 8200",
        "Washington, DC 20416",
      ],
    },
    {
      business: "7. Brokers and Dealers",
      contact: ["Securities and Exchange Commission", "100 F Street NE", "Washington, DC 20549"],
    },
    {
      business: "8. Institutions that are members of the Farm Credit System",
      contact: ["Farm Credit Administration", "1501 Farm Credit Drive", "McLean, VA 22102-5090"],
    },
    {
      business: "9. Retailers, Finance Companies, and All Other Creditors Not Listed Above",
      contact: ["Federal Trade Commission", "Consumer Response Center", "600 Pennsylvania Avenue NW", "Washington, DC 20580", "(877) 382-4357"],
    },
  ],
};
