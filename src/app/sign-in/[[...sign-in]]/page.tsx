import { SignIn } from "@clerk/nextjs";

// Catch-all route so Clerk can route its multi-step sign-in flow
// (verification, second factor, etc.) under /sign-in/*.
export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <SignIn />
    </main>
  );
}
