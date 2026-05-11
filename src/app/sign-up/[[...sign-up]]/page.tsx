import { SignUp } from "@clerk/nextjs";

// Catch-all route so Clerk can route its multi-step sign-up flow
// (verification, second factor, etc.) under /sign-up/*.
export default function SignUpPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <SignUp />
    </main>
  );
}
