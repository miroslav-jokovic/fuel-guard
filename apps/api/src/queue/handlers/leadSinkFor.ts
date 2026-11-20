import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredAlertRecipients } from "../../modules/ads/index.js";
import type { Env } from "../../env.js";
import { phoneLookupFor, recruitingLeadSink, type ConfiguredRecipients } from "../../modules/recruiting/index.js";

/**
 * Recruiting's `LeadSink` as the two lead jobs hand it to the ads module. Recruiting may not import ads
 * (D-AD17), and who the carrier chose to hear a lead alert is an ads setting, so that reader crosses here,
 * in the composition root, like the sink itself crosses the other way.
 */
export const leadRecipientsFor = (admin: SupabaseClient): ConfiguredRecipients =>
  (orgId, category) => configuredAlertRecipients(admin, orgId, category);

/** The phone lookup (V7a) is the deployment's: on where `TELNYX_API_KEY` is set and the ceiling is above 0. */
export const leadSinkFor = (admin: SupabaseClient, env: Pick<Env, "TELNYX_API_KEY" | "TELNYX_LOOKUP_DAILY_MAX">) =>
  recruitingLeadSink(admin, leadRecipientsFor(admin), undefined, phoneLookupFor(env));
