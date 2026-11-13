import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";

/**
 * "Your devices" (CHAT-WEB-PUSH-PLAN WP4, D-WP10). What a person relies on: every device where chat
 * notifications are on is listed by the name they would recognise, with which one they are holding; Remove
 * takes one off and says so; a failure to load or to remove is said in words, never an empty list that
 * looks like "none".
 */
const push = vi.hoisted(() => ({
  listPushDevices: vi.fn(),
  removePushDevice: vi.fn(),
  thisDeviceId: vi.fn(() => "d0000000-0000-4000-8000-000000000001" as string | null),
}));
vi.mock("@/lib/webPush", () => push);

import ChatPushDevicesDialog from "./ChatPushDevicesDialog.vue";

const PHONE = {
  id: "d0000000-0000-4000-8000-000000000001", device_label: "Chrome on Android", created_at: "2026-11-01T10:00:00Z",
  last_seen_at: "2026-11-13T10:00:00Z", last_success_at: "2026-11-13T09:00:00Z", last_failure_at: null,
};
const OLD_PC = {
  id: "d0000000-0000-4000-8000-000000000002", device_label: "Edge on Windows", created_at: "2026-10-01T10:00:00Z",
  last_seen_at: "2026-10-20T10:00:00Z", last_success_at: null, last_failure_at: "2026-10-20T11:00:00Z",
};

const open = async () => {
  const w = mount(ChatPushDevicesDialog, { props: { open: true }, attachTo: document.body });
  await flushPromises();
  return w;
};
const text = () => document.body.textContent ?? "";
const button = (label: string) => [...document.body.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);

beforeEach(() => {
  document.body.innerHTML = "";
  push.listPushDevices.mockResolvedValue([PHONE, OLD_PC]);
  push.removePushDevice.mockResolvedValue(true);
});

describe("Your devices", () => {
  it("lists each device by name, marks the one in hand, and says what last happened on each", async () => {
    await open();
    expect(text()).toContain("Chrome on Android");
    expect(text()).toContain("Edge on Windows");
    expect(document.body.innerHTML.match(/This device/g)).toHaveLength(1);
    expect(text()).toContain("No notification delivered yet · the last one failed");
  });

  it("removes a device and says it will no longer get notifications", async () => {
    await open();
    button("Remove")[1]!.click();
    await flushPromises();
    expect(push.removePushDevice).toHaveBeenCalledWith(OLD_PC.id);
    expect(button("Remove")).toHaveLength(1);
    expect(text()).toContain("Edge on Windows will no longer get chat notifications.");
  });

  it("says when a removal failed, and keeps the device listed", async () => {
    push.removePushDevice.mockResolvedValue(false);
    await open();
    button("Remove")[1]!.click();
    await flushPromises();
    expect(text()).toContain("Could not remove that device.");
    expect(button("Remove")).toHaveLength(2);
  });

  it("says so when the list could not be loaded, rather than showing none", async () => {
    push.listPushDevices.mockResolvedValue(null);
    await open();
    expect(text()).toContain("Could not load your devices.");
    expect(text()).not.toContain("not on for any device");
  });
});
