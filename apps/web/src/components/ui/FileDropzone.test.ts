import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import FileDropzone from "./FileDropzone.vue";

/**
 * The drop-time filter matches `accept` the way the browser's own picker does — by name OR by type. When it
 * matched names only, a Google Voice photo dropped on the BOL reader (a JPEG named `.jfif`, typed
 * `image/jpeg`) was thrown away under `image/*` without a word (10/12/2026).
 */
const f = (name: string, type: string) => new File(["x"], name, { type });

async function dropped(accept: string, files: File[]): Promise<string[]> {
  const w = mount(FileDropzone, { props: { accept, multiple: true } });
  // jsdom builds no DragEvent with files, so the picker's change event carries them — the same `handle`.
  const input = w.get("input[type='file']");
  Object.defineProperty(input.element, "files", { value: files });
  await input.trigger("change");
  return ((w.emitted("files")?.[0]?.[0] ?? []) as File[]).map((x) => x.name);
}

describe("FileDropzone drop filter", () => {
  it("passes a file on a wildcard or exact mime even when its name lists no extension", async () => {
    expect(await dropped("image/*,application/pdf", [f("voice.jfif", "image/jpeg"), f("bol", "application/pdf"), f("notes.txt", "text/plain")]))
      .toEqual(["voice.jfif", "bol"]);
  });

  it("still passes on the extension when the browser reports no type, and refuses what matches neither", async () => {
    expect(await dropped("image/*,.heic,.jfif", [f("IMG_1.HEIC", ""), f("x.jfif", ""), f("report.docx", "")])).toEqual(["IMG_1.HEIC", "x.jfif"]);
  });

  it("an exact mime does not stand for its whole family", async () => {
    expect(await dropped("image/png", [f("a.png", "image/png"), f("b.jpg", "image/jpeg")])).toEqual(["a.png"]);
  });

  it("passes everything when there is no accept list", async () => {
    expect(await dropped("", [f("a.bin", "")])).toEqual(["a.bin"]);
  });
});
