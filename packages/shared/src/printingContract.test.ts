import { describe, expect, it } from "vitest";
import { diagnoseScannerTest, SCANNER_TEST_PAYLOAD } from "./printingContract.js";

/**
 * The Settings scanner test names the setting that is wrong on THIS device (plan §3). Each verdict is
 * what a real misconfiguration produces from the test label's characters.
 */
describe("diagnoseScannerTest", () => {
  it("a clean read works, with or without the scanner's Enter or Tab", () => {
    expect(diagnoseScannerTest(SCANNER_TEST_PAYLOAD)).toBe("works");
    expect(diagnoseScannerTest(`${SCANNER_TEST_PAYLOAD}\r\n`)).toBe("works");
    expect(diagnoseScannerTest(`${SCANNER_TEST_PAYLOAD}\t`)).toBe("works");
  });

  it("Caps Lock on the host inverts every letter", () => {
    expect(diagnoseScannerTest("sil1:test:oK-42Z")).toBe("caps_lock");
  });

  it("a non-US layout turns the colon and hyphen into other characters", () => {
    // German QWERTZ: Shift+; (US colon) is Ö, US hyphen is ß; Spanish: Ñ for the colon.
    expect(diagnoseScannerTest("SIL1ÖTESTÖOkß42z")).toBe("keyboard_layout");
    expect(diagnoseScannerTest("SIL1ÑTESTÑOk-42z")).toBe("keyboard_layout");
  });

  it("anything else is not the test label — a real tag, a UPC", () => {
    expect(diagnoseScannerTest("SIL1:AST:7K3M9P")).toBe("not_the_test_label");
    expect(diagnoseScannerTest("012345678905")).toBe("not_the_test_label");
  });
});
