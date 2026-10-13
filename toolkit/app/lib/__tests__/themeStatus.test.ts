import { describe, expect, it } from "vitest";
import { themeStatusFromFiles } from "../admin.server";

describe("themeStatusFromFiles", () => {
  it("finds enabled embeds and placed blocks, ignoring other apps and disabled ones", () => {
    const settings = `/* auto-generated */ ${JSON.stringify({
      current: {
        blocks: {
          a: { type: "shopify://apps/911-toolkit/blocks/countdown-bar/uuid-1", disabled: false },
          b: { type: "shopify://apps/911-toolkit/blocks/sales-kit/uuid-2", disabled: true },
          c: { type: "shopify://apps/other-app/blocks/countdown-bar/uuid-3", disabled: false },
        },
      },
    })}`;
    // Shrine nests app blocks inside a "Details" group block.
    const product = JSON.stringify({
      sections: {
        main: {
          blocks: {
            Details: {
              type: "group",
              blocks: {
                x: { type: "shopify://apps/911-toolkit/blocks/reviews/uuid-4" },
                y: { type: "shopify://apps/911-toolkit/blocks/stock-counter/uuid-5", disabled: true },
              },
            },
          },
        },
      },
    });
    const status = themeStatusFromFiles(settings, { product, index: "" });
    expect(status["countdown-bar"]).toBe(true);
    expect(status["sales-kit"]).toBe(false);
    expect(status.reviews).toBe(true);
    expect(status["stock-counter"]).toBe(false);
    expect(status["reviews-carousel"]).toBe(false);
  });
});
