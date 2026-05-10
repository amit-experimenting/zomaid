import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { redeemInvite } from "@/app/household/settings/actions";

type Params = { params: Promise<{ token: string }> };

export default async function JoinTokenPage({ params }: Params) {
  const { token } = await params;
  const { userId } = await auth();

  if (!userId) {
    redirect(
      `/?redirect_url=${encodeURIComponent(`/join/${token}`)}`,
    );
  }

  try {
    await redeemInvite({ tokenOrCode: token });
  } catch (e) {
    // Don't swallow Next's redirect signal
    if (e && typeof e === "object" && "digest" in e && typeof e.digest === "string" && e.digest.startsWith("NEXT_REDIRECT")) {
      throw e;
    }
    const msg = e instanceof Error ? e.message : "could not join";
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-xl font-semibold">Could not join</h1>
        <p className="mt-2 text-sm text-muted-foreground">{msg}</p>
      </main>
    );
  }
  redirect("/dashboard");
}
