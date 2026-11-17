import type { PublishInput } from "../publisher.js";
import type { PublishVideoFile } from "../publisherVideo.js";
import type { MetaTarget } from "./metaTarget.js";

/**
 * The one campaign the Meta publisher's contract suites publish (`publisher.contract.test.ts`, and its
 * motion-ad half `publisherVideo.contract.test.ts`): one approved creative, English and Spanish, on the
 * target's ad account and Page. `motion` makes it a motion ad — the same ad with a video per language.
 */
export function contractPublishInput(o: {
  t: Pick<MetaTarget, "accountId" | "pageId">; orgId: string; connectionId: string; campaignId: string; creativeId: string; key: string;
  /** The SHA-256 of each language's 4:5 still. */
  en: string; es: string;
  motion?: readonly PublishVideoFile[];
}): PublishInput {
  return {
    orgId: o.orgId, campaignId: o.campaignId, connectionId: o.connectionId, accountId: o.t.accountId, pageId: o.t.pageId, platform: "meta",
    brief_source: "recruiting_opening", brief_ref: "op-1@v3", created_at: "2026-11-05T15:00:00Z",
    area: { label: "Joliet yard", latitude: 41.525, longitude: -88.0817, radius_miles: 25, reason: "Drivers report to the Joliet yard daily" },
    daily_budget_cents: 5_000, lifetime_cap_cents: 50_000, key: `${o.campaignId}:${o.key}`,
    claims: [{ kind: "money", cents: 62, per: "mile" }, { kind: "quantity", value: 23, unit: "age" }, { kind: "quantity", value: 2, unit: "year" }], form_questions: ["class_a_held", "class_a_years"], privacy_url: "https://app.silvicom360.com/privacy",
    creatives: [{
      id: o.creativeId, preset_key: "P2", platform_slots: { primary_text: "body", headline: "title" },
      copy: { en: { hook: "Home every weekend", cta: "Apply now", body: "Regional lanes out of Joliet.", title: "Class A drivers" },
              es: { hook: "En casa cada fin de semana", cta: "Aplica ya", body: "Rutas regionales desde Joliet.", title: "Choferes Clase A" } },
      assets: [{ format: "4:5", language: "en", sha256: o.en }, { format: "4:5", language: "es", sha256: o.es }],
      ...(o.motion ? { motion: { files: o.motion } } : {}),
    }],
  };
}
