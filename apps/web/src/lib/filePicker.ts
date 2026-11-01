/**
 * One file from the device — the browser's picker, or with `capture` the phone's camera.
 *
 * Moved here from `features/apply/capture/webImageIo.ts` (§9 P9) when the office's applicant record
 * needed the same camera button: a feature may not import another's internals (`lint:boundaries`), and
 * a second copy of this would be the restatement `CLAUDE.md` calls a workaround with a delay fuse.
 */
/**
 * Pick an image the driver already has, from wherever their device keeps them (C2's Upload tab).
 *
 * ⚠ **The same detached input as the camera, without `capture`** — and it is detached for a reason
 * worth stating rather than copying: `lint:ui-adoption` counts every `<input>` in a page or a feature
 * and allows none, because this product's fields are `AppInput` and a raw one is how a control drifts
 * out of the design system. A file picker has no `AppInput` equivalent and never will (it is a
 * browser dialog, not a field), so the sanctioned shape is to build it, click it and throw it away.
 *
 * ⚠ **`capture` is omitted, not set to something else.** Setting it opens the camera directly, which
 * is right for photographing a licence and wrong here: a driver uploading a signature almost always
 * already has the picture, and forcing the camera would make them photograph a screen showing it.
 */
export function pickImageFile(accept: string, capture?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    if (capture) input.setAttribute("capture", capture);
    input.style.display = "none";

    let settled = false;
    const finish = (file: File | null): void => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener("change", () => finish(input.files?.[0] ?? null));
    // Modern browsers fire `cancel` when the picker is dismissed. Where they do not, the promise
    // simply never settles and the caller's UI stays where it was — which is what dismissing a
    // camera should look like.
    input.addEventListener("cancel", () => finish(null));

    document.body.appendChild(input);
    input.click();
  });
}
