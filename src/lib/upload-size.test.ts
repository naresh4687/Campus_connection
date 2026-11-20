import { describe, expect, it } from "vitest";
import { uploadSizeStatus } from "./upload-size";

describe("upload size gate", () => {
  it("refuses a request that does not declare its size (a chunked body would skip the gate)", () => {
    for (const v of [null, "", "  ", "abc", "0", "-5", "NaN", "Infinity"]) expect(uploadSizeStatus(v, 1000), String(v)).toBe(411);
  });
  it("refuses a declared size over the limit", () => {
    expect(uploadSizeStatus("1001", 1000)).toBe(413);
  });
  it("lets a declared size within the limit through", () => {
    expect(uploadSizeStatus("1", 1000)).toBeNull();
    expect(uploadSizeStatus("1000", 1000)).toBeNull();
  });
});
