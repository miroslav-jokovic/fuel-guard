import { describe, expect, it } from "vitest";
import { mount, RouterLinkStub } from "@vue/test-utils";
import { CHAT_ABOUT_KINDS, chatAboutTitle } from "@silvicom/shared";
import { router } from "@/router";
import ChatStageHeader from "./ChatStageHeader.vue";
import { chatAboutRoute } from "./useChatAbout";

/**
 * "Chat about this" in chat (OFFICE-CHAT-PLAN CH11b, D-CHAT34): a group's header says what it is about
 * and links to that record's page. The link names the router's own routes, so a renamed route fails
 * here rather than sending the office to "page not found".
 */
const ID = "44444444-4444-4444-8444-444444444444";

describe("what a conversation is about", () => {
  it("each kind links to its record's real page — a fraud incident to its drawer on Fuel problems", () => {
    const paths = CHAT_ABOUT_KINDS.map((k) => {
      const r = router.resolve(chatAboutRoute(k, ID));
      expect(r.name, k).not.toBe("not-found");
      return r.fullPath;
    });
    expect(paths).toEqual([`/loads/${ID}`, `/drivers/${ID}`, `/vehicles/${ID}`, `/fuel-problems?incident=${ID}`, `/roadside-inspections/${ID}`]);
  });

  it("calls it Load, Driver or Truck and its label", () => {
    expect(chatAboutTitle("load", " L-20481 ")).toBe("Load L-20481");
    expect(chatAboutTitle("driver", "Marcus Reyes")).toBe("Driver Marcus Reyes");
    expect(chatAboutTitle("vehicle", "702")).toBe("Truck 702");
    expect(chatAboutTitle("fraud_incident", "••7559")).toBe("Card fraud ••7559");
    expect(chatAboutTitle("roadside_inspection", "MN1234567")).toBe("Roadside inspection MN1234567");
  });

  it("the header says About, links the record, then the people; with no link, just the people", () => {
    const w = mount(ChatStageHeader, {
      props: { title: "Load L-20481", subtitle: "Ana, Ben", glyph: "group", about: { label: "Load L-20481", to: `/loads/${ID}` } },
      global: { stubs: { RouterLink: RouterLinkStub } },
    });
    expect(w.find("p").text()).toBe("About Load L-20481 · Ana, Ben");
    expect(w.findComponent(RouterLinkStub).props("to")).toBe(`/loads/${ID}`);
    const plain = mount(ChatStageHeader, { props: { title: "Night desk", subtitle: "Ana, Ben", glyph: "group", about: null }, global: { stubs: { RouterLink: RouterLinkStub } } });
    expect(plain.find("p").text()).toBe("Ana, Ben");
    expect(plain.find("[data-chat-about]").exists()).toBe(false);
    const alone = mount(ChatStageHeader, { props: { title: "x", subtitle: null, glyph: "group", about: { label: "Truck 702", to: "/vehicles/1" } }, global: { stubs: { RouterLink: RouterLinkStub } } });
    expect(alone.find("p").text()).toBe("About Truck 702");
  });
});
