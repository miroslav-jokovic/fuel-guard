import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import type { Driver } from "@fuelguard/shared";
import DriverAccessModal from "./DriverAccessModal.vue";

const mutations = vi.hoisted(() => ({
  create: { isPending: { value: false }, mutateAsync: vi.fn() },
  reset: { isPending: { value: false }, mutateAsync: vi.fn() },
  disable: { isPending: { value: false }, mutateAsync: vi.fn() },
  enable: { isPending: { value: false }, mutateAsync: vi.fn() },
  revoke: { isPending: { value: false }, mutateAsync: vi.fn() },
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("./useDriverCredentials", () => ({
  useCreateDriverLogin: () => mutations.create,
  useResetDriverPassword: () => mutations.reset,
  useDisableDriverLogin: () => mutations.disable,
  useEnableDriverLogin: () => mutations.enable,
  useRevokeDriverLogin: () => mutations.revoke,
}));

vi.mock("@/stores/toast", () => ({ useToastStore: () => toast }));

vi.mock("@/components/SlideOver.vue", () => ({
  default: {
    props: ["open", "title", "description"],
    emits: ["close"],
    template: `
      <aside v-if="open">
        <h2>{{ title }}</h2><p>{{ description }}</p>
        <button data-testid="drawer-close" @click="$emit('close')">Drawer close</button>
        <slot />
        <footer><slot name="footer" /></footer>
      </aside>
    `,
  },
}));

const driver = (overrides: Partial<Driver> = {}): Driver => ({
  id: "driver-1",
  org_id: "org-1",
  user_id: null,
  full_name: "Marcus Reyes",
  employee_id: "D-104",
  phone: "5558675309",
  status: "active",
  samsara_driver_id: "samsara-1",
  samsara_username: "mreyes",
  current_hos_status: null,
  current_hos_vehicle: null,
  current_hos_at: null,
  current_location: null,
  app_username: null,
  app_access_enabled: null,
  created_at: "",
  updated_at: "",
  archived_at: null,
  ...overrides,
});

const wrappers: VueWrapper[] = [];

function render(subject: Driver) {
  const wrapper = mount(DriverAccessModal, { props: { open: true, driver: subject } });
  wrappers.push(wrapper);
  return wrapper;
}

function button(wrapper: VueWrapper, label: string) {
  const match = wrapper.findAll("button").find((item) => item.text().trim() === label);
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  vi.clearAllMocks();
});

describe("DriverAccessModal", () => {
  it("creates a login with the suggested username and protects the one-time password", async () => {
    mutations.create.mutateAsync.mockResolvedValue({
      username: "mreyes",
      password: "StrongPass123!",
    });
    const wrapper = render(driver());

    expect((wrapper.get('input[name="username"]').element as HTMLInputElement).value).toBe(
      "mreyes",
    );
    expect(button(wrapper, "Create app login").attributes("form")).toBe("driver-login-form");
    await wrapper.get("#driver-login-form").trigger("submit.prevent");
    await flushPromises();

    expect(mutations.create.mutateAsync).toHaveBeenCalledWith({
      driverId: "driver-1",
      username: "mreyes",
      password: undefined,
    });
    expect(wrapper.text()).toContain("Login ready to hand off");
    expect(wrapper.text()).not.toContain("StrongPass123!");

    await button(wrapper, "Show").trigger("click");
    expect(wrapper.text()).toContain("StrongPass123!");
  });

  it("requires an explicit confirmation before disabling app access", async () => {
    mutations.disable.mutateAsync.mockResolvedValue({ ok: true });
    const wrapper = render(
      driver({ user_id: "user-1", app_username: "mreyes", app_access_enabled: true }),
    );

    await button(wrapper, "Disable").trigger("click");
    expect(wrapper.text()).toContain("Disable app access?");
    expect(mutations.disable.mutateAsync).not.toHaveBeenCalled();

    await button(wrapper, "Disable app access").trigger("click");
    await flushPromises();
    expect(mutations.disable.mutateAsync).toHaveBeenCalledWith("driver-1");
  });

  it("warns before closing over credentials that cannot be shown again", async () => {
    mutations.create.mutateAsync.mockResolvedValue({
      username: "mreyes",
      password: "StrongPass123!",
    });
    const wrapper = render(driver());
    await wrapper.get("#driver-login-form").trigger("submit.prevent");
    await flushPromises();

    await wrapper.get('[data-testid="drawer-close"]').trigger("click");
    expect(wrapper.text()).toContain("Close without saving?");
    expect(wrapper.emitted("close")).toBeUndefined();

    await button(wrapper, "Back").trigger("click");
    expect(wrapper.text()).toContain("Login ready to hand off");
  });

  it("keeps reset password behind a confirmation step", async () => {
    mutations.reset.mutateAsync.mockResolvedValue({
      username: "mreyes",
      password: "NewStrongPass123!",
    });
    const wrapper = render(
      driver({ user_id: "user-1", app_username: "mreyes", app_access_enabled: true }),
    );

    expect(button(wrapper, "Reset password").attributes("form")).toBe("driver-password-reset-form");
    await wrapper.get("#driver-password-reset-form").trigger("submit.prevent");
    expect(wrapper.text()).toContain("Reset this password?");
    expect(mutations.reset.mutateAsync).not.toHaveBeenCalled();

    await button(wrapper, "Reset password").trigger("click");
    await flushPromises();
    expect(mutations.reset.mutateAsync).toHaveBeenCalledWith({
      driverId: "driver-1",
      password: undefined,
    });
    expect(wrapper.text()).toContain("Login ready to hand off");
  });
});
