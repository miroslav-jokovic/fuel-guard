import { afterEach, describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import axe from "axe-core";
import {
  AppCheckbox,
  AppCombobox,
  AppDateRangePicker,
  AppFormField,
  AppInput,
  AppSearchField,
  AppSelect,
} from "@silvicom/ui";

describe("shared primitive accessibility smoke", () => {
  afterEach(() => document.body.replaceChildren());

  it("has no axe violations in a representative form state", async () => {
    const wrapper = mount(
      {
        components: {
          AppCheckbox,
          AppCombobox,
          AppDateRangePicker,
          AppFormField,
          AppInput,
          AppSearchField,
          AppSelect,
        },
        data: () => ({
          name: "",
          search: "",
          selected: "one",
          checked: false,
          range: { start: "2026-08-01", end: "2026-08-11" },
          options: [
            { value: "one", label: "One" },
            { value: "two", label: "Two" },
          ],
        }),
        template: `
        <main>
          <h1>Primitive test form</h1>
          <form>
            <AppFormField v-slot="field" label="Name" hint="Use the driver's legal name.">
              <AppInput v-bind="field" v-model="name" />
            </AppFormField>
            <AppSearchField v-model="search" label="Search drivers" />
            <AppSelect v-model="selected" :options="options" aria-label="Status" />
            <AppFormField v-slot="field" label="Vehicle">
              <AppCombobox v-bind="field" v-model="selected" :options="options" />
            </AppFormField>
            <AppCheckbox v-model="checked" label="Include inactive drivers" />
            <AppDateRangePicker v-model="range" />
          </form>
        </main>
      `,
      },
      { attachTo: document.body },
    );

    const result = await axe.run(wrapper.element, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations.map((violation) => violation.id)).toEqual([]);
  });
});
