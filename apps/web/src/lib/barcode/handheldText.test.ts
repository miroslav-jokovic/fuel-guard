import { describe, expect, it } from "vitest";
import { asHandheldTypesIt } from "./handheldText";

describe("a camera read is typed the way the handheld types it", () => {
  it("gives a UPC-A as its twelve printed digits, whichever format the decoder called it", () => {
    expect(asHandheldTypesIt("UPCA", "0036000291452")).toBe("036000291452");
    expect(asHandheldTypesIt("EAN13", "0036000291452")).toBe("036000291452");
  });

  it("leaves a real EAN-13, an IMEI in Code 128 and a QR label exactly as read", () => {
    expect(asHandheldTypesIt("EAN13", "8806090572593")).toBe("8806090572593");
    expect(asHandheldTypesIt("Code128", "0356938035643809")).toBe("0356938035643809");
    expect(asHandheldTypesIt("Code128", "035693803564380")).toBe("035693803564380");
    expect(asHandheldTypesIt("QRCode", "SIL1:BIN:7K3M9P")).toBe("SIL1:BIN:7K3M9P");
  });
});
