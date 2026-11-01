/**
 * The tables retention may never touch — evidence, ledgers and records the law or the product needs
 * kept (`RETENTION_FORBIDDEN`), pinned by a guard test.
 *
 * Split out of `dataRetentionPolicy.ts` on 2026-10-10, when DB7's rule for
 * `load_stop_eta_predictions` took that file past the 500-line budget; it re-exports this list, so
 * every importer is unchanged. The seam is the policy's own: what MAY be pruned and for how long stays
 * there, what may NEVER be is here. `scripts/check-table-lifecycle.mjs` parses both files.
 */

/** Tables that must NEVER appear in RETENTION_RULES — pinned by a guard test. */
export const RETENTION_FORBIDDEN = [
  /**
   * The §396.17 annual vehicle inspection and its per-component results (0280, D-AVI4).
   *
   * §396.21(b) requires the report retained for FOURTEEN MONTHS from the date of inspection, at the
   * location where the vehicle is housed or maintained, and produced on demand to a federal, state
   * or local official. A prune written against `created_at` would therefore be a compliance
   * incident rather than housekeeping — and the obvious "keep 12 months" that somebody reaches for
   * is two months short of the number the regulation actually says.
   *
   * The rows are already frozen once final by 0280's trigger; pinning them here is what stops a
   * retention rule deleting a report that a roadside inspection is about to ask for.
   */
  "vehicle_inspections", "vehicle_inspection_items",
  "audit_logs", // append-only compliance ledger
  "ifta_fuel_receipt_uploads", "ifta_fuel_receipts", // IFTA credit evidence (0436): voided, never deleted
  // The notification dedupe ledger (0432, Q11): a deleted key re-arms its alert. The inbox is
  // prunable precisely because this table is not.
  "notification_dedupe_keys",
  /**
   * The driver's signatures, place by place, on the application packet (0339) and the handbook (0374)
   * — G-6, APPLICATION-FLOW-V2-PLAN.md. Both are append-only by trigger, and each row is the fact a
   * filed PDF's signature line stands on: who signed which place, under which text, from where. A
   * prune would leave filed documents whose signatures nothing in the database can account for.
   */
  "application_packet_marks",
  "handbook_marks",
  /**
   * The carrier's countersignature on the filed packet (0387, HANDBOOK-SIGNING-PLAN.md §6): which
   * Representative signed the carrier's lines, applied by whom, over which filed bytes. The stamped
   * copy's signatures stand on it the way a mark's do, and it is append-only by trigger.
   */
  "application_packet_countersignatures",
  /**
   * HW8a (0539): the applicant's "I watched these" — which orientation videos, the name typed, when —
   * and the links they opened from the list. Append-only by trigger; the checklist's orientation step
   * stands on the first, and a prune would turn a done step back into an unsent one with nothing to
   * say why. Removed only with a never-hired applicant, by the audited purge.
   */
  "orientation_video_attestations",
  "orientation_video_opens",
  /**
   * Part 1 of the applicant's link and what the office did with it (0376, APPLICATION-FLOW-V2-PLAN
   * §8.2). The intake and its licences are what screening READ — the MVR was ordered per licence, the
   * drug-test site found from the address — so a prune would leave a PSP pull and an MVR citing inputs
   * nothing can show. The phone verifications are §391.23 evidence before filing and are copied into
   * `employer_inquiries` at it. An adopted signature is what every mark made with it looks like
   * (D-AW15); the marks themselves are pinned above.
   */
  "application_intakes",
  "application_intake_licences",
  "employer_verification_calls",
  "signature_adoptions",
  /**
   * A-11: a STOP, a carrier block or an invalid number. Pruning one re-opens texting a person who
   * asked not to be texted — the TCPA exposure `sms_consents` below is pinned against, from the other
   * side.
   */
  "sms_suppressions",
  "platform_audit_log",
  "fuel_transactions", // business records
  "efs_transactions",
  /**
   * The vendor's weekly statement and its lines (0243). This is the BILLING record — what the carrier
   * was actually charged — and the evidence a discount conversation with Pilot would rest on. It is
   * already immutable by trigger (corrections supersede, they do not overwrite); pinning it here is
   * what stops someone adding a 12-month prune in six months and deleting the baseline the spend
   * bridge is measured from.
   */
  "fuel_statements",
  "fuel_statement_lines",
  /**
   * The reconciliation runs (0249). What we CONCLUDED about a vendor's bill on a date, with the
   * tolerances and the inputs that produced it — the claim that Pilot billed for a fill we never
   * recorded, which is the fuel-theft surface this product exists to watch. Already append-only by
   * trigger and undeletable even by the service role; pinning it here is what stops someone adding a
   * 12-month prune in six months and erasing the record that a finding was ever made.
   */
  "fuel_recon_runs",
  /**
   * The lines behind each run (0406, FS3). The run says "1 on Pilot's bill, not in our records,
   * $242.11"; this is which line that was. Undeletable by trigger already, pinned for the same reason.
   */
  "fuel_recon_run_rows",
  "efs_card_mutations", // card-control ledger
  "fuel_events",
  "declined_transactions",
  "anomalies", "card_fraud_incidents", "card_fraud_incident_attempts", // 0438: a person's fraud verdict + its evidence
  "driver_scores",
  "driver_performance_weeks", // frozen rewards ledger
  "organizations",
  "drivers",
  "vehicles",
  /**
   * D-BD12 — the driver qualification file. §391.51 measures retention in YEARS (the MVR review for
   * three, the file itself for as long as the driver is employed plus three), and §390.32(d) requires
   * an electronic record to still be reproducible when asked for. Until now nothing stopped someone
   * adding these to a retention rule in six months and quietly pruning a driver's history — the
   * history the binder is built to reproduce. `documents` is the scan behind every one of these rows
   * and is append-only by RLS for exactly the same reason.
   */
  "certifications",
  "qualification_records",
  "documents",
  /**
   * H5 — the §391.21 application and the invitation that produced it. The application is the
   * document the applicant CERTIFIED as true and complete, and every §391.23 inquiry, the PSP
   * cross-match and the §391.51(b)(1) record all point back at it; pruning it would leave the file
   * citing evidence that no longer exists. The invitation stays because it is the provenance of an
   * unauthenticated signature — who was invited, when it expired, when it was spent.
   */
  "driver_applications",
  "application_invitations",
  /** The export ledger (0152). The bytes expire after seven days; the row that says who pulled a
   *  driver's medical card out of the system does not (D-BD9). */
  "dq_exports",
  /**
   * The §391.21(b)(10) employment list (0208). Same reasoning as `qualification_records` above and
   * the same clock: §391.51(c) keeps the qualification file for as long as the driver is employed
   * plus three years, and §391.53(a)(1) keeps the investigation history it records the inquiries for.
   * Mutable — a transcription correction is an UPDATE, unlike the append-only evidence tables — but
   * mutability is not the same axis as retention, and `drivers` sits on this list for the same reason.
   */
  "driver_employment_history",
  /**
   * The §391.23(c)(2) written record of every previous-employer inquiry (0223).
   *
   * This one is not merely evidence OF the investigation — when nobody answers, it IS the
   * investigation: §391.23(c)(1) accepts "documentation of good faith efforts" in place of a reply,
   * so pruning the attempts would delete the only proof the file was ever completed lawfully. It
   * keeps the §391.53(a)(1) clock its qualification records keep.
   */
  "employer_inquiries",
  /**
   * The signed disclosures and authorizations (0215). The legal basis for a screening pull outlives
   * the pull: an FCRA or §391.23 challenge asks what the driver was told and when they agreed, and a
   * consent record that can be aged out is a consent record that cannot answer.
   */
  "driver_authorizations",
  /**
   * The PSP transaction ledger (0216). Every row is a purchase and a person's crash and violation
   * history — the record of what we bought, on whose authorization, and what it said. An invoice
   * reconciliation reads it, and so does anyone asking why a hiring decision went the way it did.
   */
  "psp_requests",
  /**
   * The 15 U.S.C. 7001(c) consent behind every electronic signature this product takes (0227).
   *
   * §390.32(d) does not merely ask us to obtain it — it makes the electronic record itself
   * conditional on including proof of it, and asks that the record still be accurately reproducible
   * when somebody comes looking. A consent that can be aged out is a consent that cannot answer the
   * one question it exists to answer, and pruning it would retroactively turn every application and
   * signature it stands behind into an electronic record FMCSA does not recognise.
   */
  "esign_consents",
  /**
   * A11b. A consent pruned on a schedule is a defence thrown away while the claim is still live —
   * the TCPA's limitation period runs four years from the message, and the only answer to "why did
   * you text this person" is the row saying they asked you to. It is also the record of the opt-out,
   * which matters for longer than the consent does.
   */
  "sms_consents",
  /**
   * The hazmat BOL images a §172 verdict was reached from (0092, and the original-of-record columns
   * 0326 adds to them).
   *
   * ⚠ **This table was in neither list.** Measured 2026-09-07 while Phase 4a of
   * `SCANNER-UPGRADE-PLAN.md` asked the owner where an untouched ORIGINAL goes: `hazmat_documents`
   * appeared in no `RETENTION_RULES` entry and on no forbidden list, so it was neither pinned nor
   * pruned — it simply grew, and nothing at all stopped the next person adding a rule to it. Root
   * `CLAUDE.md` has called it insert-only evidence since the re-founding and 0092 has made it
   * immutable by RLS since it shipped; both of those stop an UPDATE, and neither stops a
   * service-role prune, because the runner here bypasses RLS by design.
   *
   * The reason it must not be prunable is the same one `documents` sits on this list for, one
   * regulation over. 49 CFR §172.201(e) obliges the carrier to retain the shipping paper for 375
   * days after the material is accepted, and the row is the only index from a `hazmat_runs` verdict
   * to the bytes it read: prune it and the load's compliance history cites an image nobody can
   * produce. The owner's 2026-09-07 ruling on the plan's Q1 goes further than the CFR floor — the
   * ORIGINAL is kept as long as the ARCHIVE, with no expiry window — so there is no window here to
   * get wrong either.
   *
   * ⚠ And deleting the row is what would delete the BYTES, not only the index.
   * `storageReconcileScheduler` sweeps the `hazmat` bucket nightly with `apply: true`, and
   * `reconcileBucketOrphans` deletes any object no row points at once it is past the 24-hour grace.
   * So a retention rule on this table would be a storage deletion on a one-day delay — the same
   * composition `application_captures` above relies on deliberately, running here against evidence.
   */
  "hazmat_documents", "document_sources", "document_read_reviews", "document_page_classes", // + the reader's bytes and labels: the same papers (0448/0449, D-DR9)
  "document_assemblies", "document_assembly_pages", // + which photos made one shipping paper (0454, D-DR14)
  /**
   * FMCSA's public record of our roadside inspections, version by version (0457, INSPECTION-CHALLENGE-
   * PLAN D-IC2). A violation that vanishes after a DataQs request was granted is how the engine learns
   * the request worked; a pruned version is a "before" no outcome can be read against, and FMCSA keeps
   * only three years itself, so after that nothing anywhere can reproduce it.
   */
  "fmcsa_fetch_runs", "fmcsa_raw_rows",
  /**
   * Who was driving at an inspection and the telematics frozen around it (0473, D-IC4, D-IC7). The
   * snapshot is the only copy that survives Samsara's own retention and the 24-month SMS window; the
   * attribution is the record a DataQs filing names its driver from. Corrections are new rows.
   */
  "inspection_attributions", "inspection_evidence_snapshots",
  /**
   * The repair record of a roadside inspection's vehicle violations (0482, IC11): what was proposed and
   * what maintenance accepted is the 396.9(d) answer an auditor asks for. Corrections are new rows.
   */
  "inspection_repairs",
  /**
   * Safety's certification of those repairs (0485, IC11 B2): the carrier official's signature, title and
   * date 396.9(d)(3)(i) asks for. A later certification is a new row; the earlier one stays true of what it named.
   */
  "inspection_repair_certifications",
  /**
   * What the safety office did about a roadside ticket with no court result (0489, IC4): asked the court, or
   * did not contest it. A correction is a new row.
   */
  "inspection_citation_actions",
  /**
   * What the court decided on each ticket, read from the filed paper (0495, IC4): the court's word a DataQs request
   * rests on. A misread is a new row.
   */
  "inspection_citation_dispositions",
  /**
   * A DataQs request a person attested to under 18 USC 1001 and filed themselves (0495, IC4): the carrier's signed
   * statement to FMCSA, and the RDR number DataQs gave it.
   */
  "dataqs_cases",
  /**
   * An equipment bill (0530, M10a): what the company paid for its tablets and truck gear, and which items
   * that bill paid for. Append-only by trigger; a correction is a new row the old one points at.
   */
  "equipment_purchases",
  /**
   * Office chat (0511, OFFICE-CHAT-PLAN D-CHAT12/D-CHAT13). The messages, the words an edit replaced and
   * the hash-chained ledger of every chat fact. Chat is read after a crash or in an HR case, and the
   * owner ruled on 2026-10-23 (Q-CHAT5) that it is kept until counsel names a period — so the only
   * deletion is CHA3's per-org purge, an explicit act recorded in the ledger itself, never a rule here.
   * The two record tables are append-only by trigger (CL001) already; messages are soft-deleted (MG001).
   */
  "messages", "message_versions", "chat_ledger",
  /**
   * Office chat's legal holds and exports (0517, OFFICE-CHAT-PLAN D-CHAT15/D-CHAT20). A hold is the
   * record that the company was told to keep a person's or a conversation's words, and an export is
   * the record of who took them out of the system and which ledger position the copy is tied to.
   * Both are what a court asks for, years later; both change only by trigger-guarded transitions
   * (CL001). An export's FILES are swept after seven days by its own job; the row is never.
   */
  "chat_holds", "chat_exports",
  /**
   * The driver's account-closure request (0330, D-PR8).
   *
   * ── THE ONE ENTRY ON THIS LIST THAT INVERTS ITS OWN SUBJECT ───────────────────────────────────
   * Every other table here is pinned because it holds evidence somebody may later demand. This one
   * is pinned because it holds evidence that we DELETED something — who asked for their login to be
   * closed, when, and which fleet manager attested that the non-retained data went. A retention rule
   * on it would prune the proof that a deletion request was honoured, which is to say it would use
   * the deletion policy to erase the record of the deletion policy working. The published privacy
   * policy promises a 30-day fleet action; `resolved_at` and `resolved_by` are the only place that
   * promise is answerable.
   *
   * It holds no driving history, no document and no image — "who asked, when, and what we did" —
   * so nothing about keeping it works against the request it records.
   */
  "driver_account_closure_requests",
  /**
   * The books and the McLeod staging they are projected from (finance inventory, 2026-10-05).
   * `finance_month_closes` says a month tied to the cent against `mcleod_gl_totals`; the income
   * statement, fuel tie-out and `financial_entries` are sums of the staged settlements, vouchers,
   * deductions, billing and ledger rows. A prune by age would leave a closed month citing figures
   * nobody can produce, and McLeod is re-swept only 75 days back, so they would not come back.
   * Measured on production the same day: ~134 MB in total after a backfill to 2024-01-01, so no
   * storage argument exists. The statutory period is the carrier's accountant's question; "never by
   * rule" cannot be shorter than any answer. Deleting any of these is an explicit, audited act.
   * Not here: the dispatch-side tables (`mcleod_dispatch_*`, `tms_*`, `load_external_payloads`),
   * which are operational, not books, and stay unruled.
   */
  "financial_entries",
  "finance_month_closes",
  "mcleod_settlements",
  "mcleod_ap_vouchers",
  "mcleod_deductions",
  "mcleod_billing",
  "mcleod_office_lines",
  "mcleod_movements",
  "mcleod_gl_accounts",
  "mcleod_gl_days",
  "mcleod_gl_totals",
  /**
   * The ads module's ledgers (0537, ADS-AGENT-BUILD-WORKFLOW A2). `ads_actions` is the money audit
   * trail — every launch, pause, budget change and refusal, with the approval it cited;
   * `ads_approvals` is who allowed which spend; `ads_settings_versions` is which caps and kill-switch
   * state were in force at any moment; `ad_generations` is what each model was asked, what it
   * answered and what it cost (D-AD13, the ads module's AI provenance); `ads_outcome_events` is what
   * we told a platform about a lead's progress. None is re-derivable — the platform keeps its own
   * history, not ours — and each is what a billing dispute, a rejected ad's appeal or an
   * employment-advertising complaint asks for. All five are append-only by trigger for the service
   * role too (AX010–AX012); this pins them against a prune by age as well.
   */
  "ads_actions",
  "ads_approvals",
  "ads_settings_versions",
  "ad_generations",
  "ads_outcome_events",
] as const;
