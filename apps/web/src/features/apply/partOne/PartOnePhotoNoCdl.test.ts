import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import PartOnePhoto from "./PartOnePhoto.vue";
import { emptyPartOneAnswers, type PhotoScreen } from "./partOneScreens";
import { APPLY_COPY } from "@/features/apply/strings";

/** U8 (0605): the CDL's photo screens offer "I don't have my CDL with me"; the other photo screens do not. */
const show = (photo: PhotoScreen, captures: Array<{ slot: string }> = []) =>
  mount(PartOnePhoto, {
    props: {
      token: "t", carrier: "Silvicom Inc", desktop: false, photo, captures: captures as never, errors: {},
      readsBarcode: false, barcode: "idle", answers: emptyPartOneAnswers(),
    },
  });

describe("the CDL's photo screens", () => {
  it("offer the answer on both sides, in the driver's words", () => {
    for (const side of ["cdl_front", "cdl_back"] as const) {
      expect(show(side).find("[data-no-cdl]").text()).toContain(APPLY_COPY.partOne.photo.noCdl);
    }
  });

  it("do not offer it on the medical card or the selfie, which have their own", () => {
    expect(show("medical_card").find("[data-no-cdl]").exists()).toBe(false);
    expect(show("selfie").find("[data-no-cdl]").exists()).toBe(false);
  });

  it("say what happens next once it is ticked, and write the answer into Part 1's own answers", async () => {
    // The screen edits the walk's answers in place, as the medical card's tick does (`v-model:answers`).
    const answers = reactive(emptyPartOneAnswers());
    const w = mount(PartOnePhoto, {
      props: {
        token: "t", carrier: "Silvicom Inc", desktop: false, photo: "cdl_front", captures: [], errors: {},
        readsBarcode: false, barcode: "idle", answers,
      },
    });
    expect(w.text()).not.toContain(APPLY_COPY.partOne.photo.noCdlHint);
    await w.find("[data-no-cdl] input[type='checkbox']").setValue(true);
    expect(answers.cdl_photo_pending).toBe(true);
    expect(w.text()).toContain(APPLY_COPY.partOne.photo.noCdlHint);
  });
});
