/**
 * @silvicom/sms-engine — FMCSA SMS violation weighting, pure and deterministic
 * (docs/plans/safety-dqf/INSPECTION-CHALLENGE-PLAN.md IC3, D-IC5, D-IC6).
 */
export { SMS_BASICS, BASIC_RULES, INSPECTION_BASIC_CAP, OOS_WEIGHT, type SmsBasic, type BasicRules } from "./basics.js";
export { APPENDIX_A_EDITIONS, appendixFor, violationKey, type AppendixEdition, type AppendixViolation } from "./appendix.js";
export {
  scoreSms,
  basicPoints,
  timeWeight,
  monthsBefore,
  type CitationResult,
  type ExclusionReason,
  type ScoredInspection,
  type ScoredViolation,
  type SmsInspectionInput,
  type SmsScore,
  type SmsViolationInput,
} from "./score.js";
export { SMS_PARITY, smsImpactVerified } from "./parity.js";
