import { describe, expect, it } from "vitest";
import { CATEGORY_LABEL } from "./notifications";
import { PUSH_COPY, pushCopy, pushUrl } from "./push-copy";

describe("push wording", () => {
  it("every notification category has generic copy, with no digits, currency or personal detail", () => {
    for (const c of Object.keys(CATEGORY_LABEL)) {
      const x = PUSH_COPY[c]; expect(x, c).toBeDefined();
      expect(x.title.length).toBeLessThanOrEqual(40); expect(x.body.length).toBeLessThanOrEqual(110);
      expect(`${x.title} ${x.body}`).not.toMatch(/\d|₹|lpa|ctc|salary|package/i);
    }
    expect(pushCopy("SOMETHING_NEW").title).toBe("CampusConnect");
  });
  it("the destination is always our own authenticated redirect for that notification id", () => {
    expect(pushUrl("0b0f6c1e-0000-4000-8000-000000000000")).toBe("/notifications/0b0f6c1e-0000-4000-8000-000000000000/open");
  });
});
