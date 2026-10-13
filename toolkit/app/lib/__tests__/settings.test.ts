import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, settingsFromForm, validateSettings, withDefaults } from "../settings";

describe("settingsFromForm", () => {
  it("reads switches as off when missing and numbers with a decimal comma", () => {
    const form = new FormData();
    form.set("freeShippingThreshold", "49,95");
    const s = settingsFromForm("salesKit", form, DEFAULT_SETTINGS.salesKit);
    expect(s.popupsEnabled).toBe(false);
    expect(s.freeShippingThreshold).toBe(49.95);
    // Fields not in the form keep their previous value.
    expect(s.freeShippingMessage).toBe(DEFAULT_SETTINGS.salesKit.freeShippingMessage);
  });
});

describe("validateSettings", () => {
  it("catches the common mistakes", () => {
    const stock = { ...DEFAULT_SETTINGS.stock, message: "Hurry!", color: "red" };
    expect(validateSettings("stock", stock)).toMatchObject({
      message: expect.any(String),
      color: expect.any(String),
    });
    const n8n = { ...DEFAULT_SETTINGS.bookkeeping, n8nWebhookUrl: "http://insecure" };
    expect(validateSettings("bookkeeping", n8n).n8nWebhookUrl).toBeDefined();
    expect(validateSettings("checkout", DEFAULT_SETTINGS.checkout)).toEqual({});
  });
});

describe("withDefaults", () => {
  it("fills new keys and ignores wrong types", () => {
    const s = withDefaults("checkout", { percent: 15, expiryDays: "soon" });
    expect(s.percent).toBe(15);
    expect(s.expiryDays).toBe(DEFAULT_SETTINGS.checkout.expiryDays);
    expect(s.enabled).toBe(true);
  });
});
