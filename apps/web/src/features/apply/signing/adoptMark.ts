import type { PacketMarkKind } from "@silvicom/shared";
import { publicFetch } from "@/features/apply/useApplication";

/**
 * Register one adopted mark — screen 13, "Adopt your signature and initials" (D-AW15, C3s1).
 *
 * ⚠ **The picture travels in the request**, unlike a photograph (`stageCapture`), because the server
 * hashes the bytes it stores rather than taking the page's word for them (0376), and a mark is small.
 * The server builds the storage key; nothing here names one.
 */
export async function adoptMark(
  token: string,
  kind: PacketMarkKind,
  typedText: string,
  picture: Blob,
): Promise<{ adopted: PacketMarkKind; superseded: boolean }> {
  return publicFetch(`/${token}/adoption`, {
    method: "POST",
    body: JSON.stringify({ kind, typed_text: typedText, png_base64: await base64Of(picture) }),
  });
}

/** Base64 without the `data:` prefix. `FileReader` rather than `btoa` over a string, which a PNG's bytes break. */
function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error ?? new Error("The picture could not be read."));
    reader.readAsDataURL(blob);
  });
}
