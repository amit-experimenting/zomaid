// Mocks @clerk/nextjs/server for action tests. mockClerk() installs a runtime
// mock whose auth().getToken() returns a real HS256 JWT signed with the local
// Supabase JWT secret so the action's createClient() builds a Supabase client
// that Supabase will accept end-to-end over real HTTP.

import { vi } from "vitest";
import { sign } from "jsonwebtoken";

export type MockClerkOptions = {
  clerkUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  /** Override the JWT secret. Defaults to SUPABASE_JWT_SECRET from env. */
  jwtSecret?: string;
  /** Token lifetime in seconds. Defaults to 1 hour. */
  expiresInSec?: number;
};

export type MockClerkHandle = {
  clerkUserId: string;
  token: string;
};

/**
 * Install a runtime mock for @clerk/nextjs/server returning an authed user.
 * Call BEFORE dynamic-importing the action under test so the mock applies.
 */
export function mockClerk(opts: MockClerkOptions): MockClerkHandle {
  const secret =
    opts.jwtSecret ??
    process.env.SUPABASE_JWT_SECRET ??
    "super-secret-jwt-token-with-at-least-32-characters-long";
  const expiresInSec = opts.expiresInSec ?? 60 * 60;
  const now = Math.floor(Date.now() / 1000);
  const token = sign(
    {
      sub: opts.clerkUserId,
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + expiresInSec,
    },
    secret,
    { algorithm: "HS256" },
  );

  const email = opts.email ?? `${opts.clerkUserId}@example.test`;
  const firstName = opts.firstName ?? "Test";
  const lastName = opts.lastName ?? "User";

  vi.doMock("@clerk/nextjs/server", () => ({
    auth: async () => ({
      userId: opts.clerkUserId,
      sessionId: "sess_test",
      sessionClaims: {
        sub: opts.clerkUserId,
        aud: "authenticated",
        role: "authenticated",
      },
      orgId: null,
      orgRole: null,
      orgSlug: null,
      actor: null,
      // Ignore the template arg; one JWT covers all callsites in tests.
      getToken: async (_args?: unknown) => token,
      has: () => false,
      debug: () => ({}),
      redirectToSignIn: () => {
        throw new Error("redirectToSignIn called in test");
      },
    }),
    currentUser: async () => ({
      id: opts.clerkUserId,
      emailAddresses: [{ id: "ea_1", emailAddress: email }],
      primaryEmailAddressId: "ea_1",
      firstName,
      lastName,
    }),
    clerkClient: async () => ({}),
  }));

  return { clerkUserId: opts.clerkUserId, token };
}

/**
 * Install a runtime mock for @clerk/nextjs/server simulating a signed-out
 * caller. auth().userId is null and getToken returns null.
 */
export function mockClerkUnauthed(): void {
  vi.doMock("@clerk/nextjs/server", () => ({
    auth: async () => ({
      userId: null,
      sessionId: null,
      sessionClaims: null,
      orgId: null,
      orgRole: null,
      orgSlug: null,
      actor: null,
      getToken: async (_args?: unknown) => null,
      has: () => false,
      debug: () => ({}),
      redirectToSignIn: () => {
        throw new Error("redirectToSignIn called in test");
      },
    }),
    currentUser: async () => null,
    clerkClient: async () => ({}),
  }));
}
