// Mocks Next.js modules that action code imports at module-load time:
// next/cache (revalidatePath/Tag), next/navigation (redirect/notFound), and
// next/headers (cookies). Provides expectRedirect() for asserting on the
// thrown NEXT_REDIRECT error that redirect() raises.

import { vi } from "vitest";

/**
 * Install runtime mocks for next/cache, next/navigation, and next/headers.
 * Call BEFORE dynamic-importing the action under test so the mocks apply.
 */
export function mockNextStubs(): void {
  vi.doMock("next/cache", () => ({
    revalidatePath: vi.fn(),
    revalidateTag: vi.fn(),
  }));

  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      const e = new Error("NEXT_REDIRECT") as Error & { digest?: string };
      e.digest = `NEXT_REDIRECT;${url};`;
      throw e;
    },
    notFound: () => {
      const e = new Error("NEXT_NOT_FOUND") as Error & { digest?: string };
      e.digest = "NEXT_NOT_FOUND";
      throw e;
    },
  }));

  vi.doMock("next/headers", () => ({
    cookies: async () => ({
      getAll: () => [],
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
    }),
    headers: async () => new Map(),
  }));
}

/**
 * Await `promise` and assert it threw a NEXT_REDIRECT error pointing at
 * `expectedUrl`. Throws an AssertionError-shaped Error if the promise
 * resolves normally or throws with a different digest.
 */
export async function expectRedirect(
  promise: Promise<unknown>,
  expectedUrl: string,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    const digest = (err as { digest?: string } | null)?.digest;
    if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) {
      throw new Error(
        `Expected NEXT_REDIRECT but got: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!digest.includes(`;${expectedUrl};`)) {
      throw new Error(
        `Expected redirect to ${expectedUrl} but digest was ${digest}`,
      );
    }
    return;
  }
  throw new Error(
    `Expected redirect to ${expectedUrl} but promise resolved without throwing`,
  );
}
