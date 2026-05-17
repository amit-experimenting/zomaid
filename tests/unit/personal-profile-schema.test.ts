import { describe, expect, it } from "vitest";
import { personalProfileSchema } from "@/lib/profile/personal";

describe("personalProfileSchema", () => {
  it("accepts the minimum valid payload (name only)", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // Empty optional fields normalize to null.
      expect(r.data.passport_number).toBeNull();
      expect(r.data.passport_expiry).toBeNull();
      expect(r.data.preferred_language).toBeNull();
      expect(r.data.display_name).toBe("Asha");
    }
  });

  it("rejects an empty name", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "   ",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(false);
  });

  it("trims the name", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "  Asha  ",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.display_name).toBe("Asha");
  });

  it("accepts a full payload", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "P1234567",
      passport_expiry: "2030-01-15",
      preferred_language: "ta",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.passport_number).toBe("P1234567");
      expect(r.data.passport_expiry).toBe("2030-01-15");
      expect(r.data.preferred_language).toBe("ta");
    }
  });

  it("rejects an unknown language code", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "",
      preferred_language: "xx",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-ISO date for passport_expiry", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "",
      passport_expiry: "15/01/2030",
      preferred_language: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a too-long passport number", () => {
    const r = personalProfileSchema.safeParse({
      display_name: "Asha",
      passport_number: "x".repeat(65),
      passport_expiry: "",
      preferred_language: "",
    });
    expect(r.success).toBe(false);
  });
});
