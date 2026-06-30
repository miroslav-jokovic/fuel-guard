// NOTE: the dashboard itself is data-driven (Vue Query + Supabase + Chart.js) and exercised via the
// pure `aggregateDashboard` tests in @fleetguard/shared. Here we cover safe presentational pieces.
import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import StatusBadge from "@/components/StatusBadge.vue";
import AiAssessmentCard from "@/features/ai/AiAssessmentCard.vue";

describe("StatusBadge", () => {
  it("renders the status text", () => {
    expect(mount(StatusBadge, { props: { status: "resolved" } }).text()).toContain("resolved");
  });
});

describe("AiAssessmentCard", () => {
  it("shows an empty state when there is no assessment", () => {
    const w = mount(AiAssessmentCard, { props: { assessment: null } });
    expect(w.text()).toContain("No AI assessment yet");
  });

  it("renders the summary, risk level and recommended action", () => {
    const w = mount(AiAssessmentCard, {
      props: {
        assessment: {
          id: "a",
          transaction_id: "t",
          anomaly_id: null,
          model: "claude-haiku-4-5",
          risk_score: 88,
          risk_level: "critical",
          location_plausible: false,
          implied_speed_mph: 420,
          summary: "Over-capacity diesel fill.",
          recommended_action: "investigate",
          contributing_factors: ["over capacity"],
          confidence: 0.8,
          created_at: "",
        },
      },
    });
    expect(w.text()).toContain("Over-capacity diesel fill.");
    expect(w.text()).toContain("critical");
    expect(w.text()).toContain("Investigate");
  });
});
