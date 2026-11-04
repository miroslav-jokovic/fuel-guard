import type { SupabaseClient } from "@supabase/supabase-js";
import { configuredAlertRecipients } from "../../modules/ads/index.js";
import { recruitingLeadSink } from "../../modules/recruiting/index.js";

/**
 * Recruiting's `LeadSink` as the two lead jobs hand it to the ads module. Recruiting may not import ads
 * (D-AD17), and who the carrier chose to hear a lead alert is an ads setting, so that reader crosses here,
 * in the composition root, like the sink itself crosses the other way.
 */
export const leadSinkFor = (admin: SupabaseClient) =>
  recruitingLeadSink(admin, (orgId, category) => configuredAlertRecipients(admin, orgId, category));
