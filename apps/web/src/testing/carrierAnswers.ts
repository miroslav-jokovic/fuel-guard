/**
 * The carrier's seven required answers (Q-WF3, §9 P8), for a test that needs a COMPLETE application.
 *
 * ⚠ One fixture rather than seven hand-typed answers in each `complete()`: since P8 a draft that
 * answers none of them is refused at the identity, employment and questions screens and at Send — which
 * is the rule working — and a test about something else must not have to know which seven they are.
 */
export const CARRIER_ANSWERS: Record<string, unknown> = {
  position: "Company driver",
  applying_as: "company_driver",
  heard_from: "A friend",
  legally_work: true,
  proof_of_age: true,
  may_contact_employers: true,
  education: [{ school: "Joliet High", years_completed: 4, field_of_study: "", graduated: true, graduated_when: "1998" }],
};
