import { describe, expect, it } from "vitest";
import {
  buildBillScanStoragePath,
  extForMime,
  shouldRetryAttempt,
} from "@/app/api/bills/scan/_storage";

describe("extForMime", () => {
  it("maps the three allowed MIME types", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/webp")).toBe("webp");
  });
  it("falls back to bin for unknown MIME types", () => {
    expect(extForMime("application/pdf")).toBe("bin");
    expect(extForMime("")).toBe("bin");
  });
});

describe("buildBillScanStoragePath", () => {
  it("places attempts under the household id with a typed extension", () => {
    const hh = "11111111-1111-1111-1111-111111111111";
    const a = "22222222-2222-2222-2222-222222222222";
    expect(buildBillScanStoragePath(hh, a, "image/jpeg")).toBe(`${hh}/${a}.jpg`);
    expect(buildBillScanStoragePath(hh, a, "image/png")).toBe(`${hh}/${a}.png`);
    expect(buildBillScanStoragePath(hh, a, "image/webp")).toBe(`${hh}/${a}.webp`);
  });
  it("falls back to bin extension for an unexpected MIME", () => {
    const hh = "h";
    const a = "a";
    expect(buildBillScanStoragePath(hh, a, "image/gif")).toBe("h/a.bin");
  });
});

describe("shouldRetryAttempt", () => {
  const now = new Date("2026-05-16T12:00:00Z");

  it("retries a brand-new pending row (last_attempted_at null)", () => {
    expect(
      shouldRetryAttempt(
        { status: "pending", attempts: 1, max_attempts: 3, last_attempted_at: null },
        now,
      ),
    ).toBe(true);
  });

  it("does not retry a row that's been touched within the retry gap", () => {
    expect(
      shouldRetryAttempt(
        {
          status: "pending",
          attempts: 1,
          max_attempts: 3,
          // 5 minutes ago — well within the 14-minute window
          last_attempted_at: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it("retries a row whose last attempt is outside the retry gap", () => {
    expect(
      shouldRetryAttempt(
        {
          status: "pending",
          attempts: 1,
          max_attempts: 3,
          // 15 minutes ago — past the 14-minute window
          last_attempted_at: new Date(now.getTime() - 15 * 60 * 1000).toISOString(),
        },
        now,
      ),
    ).toBe(true);
  });

  it("does not retry rows that are not pending", () => {
    for (const status of ["succeeded", "failed"] as const) {
      expect(
        shouldRetryAttempt(
          { status, attempts: 1, max_attempts: 3, last_attempted_at: null },
          now,
        ),
      ).toBe(false);
    }
  });

  it("does not retry rows that have hit max_attempts", () => {
    expect(
      shouldRetryAttempt(
        { status: "pending", attempts: 3, max_attempts: 3, last_attempted_at: null },
        now,
      ),
    ).toBe(false);
  });

  it("honours a custom retry gap", () => {
    // 8 minutes ago, gap = 5 minutes → ready
    expect(
      shouldRetryAttempt(
        {
          status: "pending",
          attempts: 1,
          max_attempts: 3,
          last_attempted_at: new Date(now.getTime() - 8 * 60 * 1000).toISOString(),
        },
        now,
        5 * 60 * 1000,
      ),
    ).toBe(true);
  });

  it("treats an unparseable last_attempted_at as ready to retry", () => {
    expect(
      shouldRetryAttempt(
        {
          status: "pending",
          attempts: 1,
          max_attempts: 3,
          last_attempted_at: "not-a-date",
        },
        now,
      ),
    ).toBe(true);
  });
});
