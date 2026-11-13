import { describe, expect, it } from "vitest";
import type { MyAlerts } from "@silvicom/shared";
import { channelWords, myAlertLines } from "./myAlertsWords";

const alert = (o: Partial<MyAlerts["alerts"][number]>): MyAlerts["alerts"][number] => ({ key: "home_time_overdue", label: "Home time overstayed", description: "", always: [], whenMine: [], ...o });

describe("myAlertLines", () => {
  it("joins channels as a sentence", () => {
    expect(channelWords(["bell"])).toBe("on the dashboard");
    expect(channelWords(["bell", "email"])).toBe("on the dashboard and by email");
    expect(channelWords(["bell", "email", "sms"])).toBe("on the dashboard, by email and by text");
  });

  it("says what a person always gets", () => {
    expect(myAlertLines(alert({ always: ["bell", "email"] }))).toEqual(["Always, on the dashboard and by email."]);
  });

  it("says 'Only' for somebody who hears of it just when it is theirs, once per way it can be theirs", () => {
    expect(
      myAlertLines(
        alert({
          whenMine: [
            { relation: "marked_by", label: "Whoever marked the home time", channels: ["bell"] },
            { relation: "truck_dispatcher", label: "The truck's dispatcher", channels: ["bell"] },
          ],
        }),
      ),
    ).toEqual(["Only when you marked the home time, on the dashboard.", "Only when the truck is in your fleet, on the dashboard."]);
  });

  it("says 'Also' when a relation adds a channel to what they always get", () => {
    expect(myAlertLines(alert({ always: ["bell"], whenMine: [{ relation: "marked_by", label: "x", channels: ["email"] }] }))).toEqual([
      "Always, on the dashboard.",
      "Also when you marked the home time, by email.",
    ]);
  });

  it("has no line for an alert that never reaches this person", () => {
    expect(myAlertLines(alert({}))).toEqual([]);
  });
});
