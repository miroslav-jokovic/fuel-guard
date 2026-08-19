/** heic-decode ships no types. WASM libheif: HEVC/AV1 HEIF → raw RGBA (A3). */
declare module "heic-decode" {
  export interface DecodedHeic {
    width: number;
    height: number;
    /** RGBA, width × height × 4. */
    data: ArrayBuffer;
  }
  export default function decode(input: { buffer: Buffer | Uint8Array }): Promise<DecodedHeic>;
}
