import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { redeemInvite } from "@/app/household/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function JoinCodePage() {
  const { userId } = await auth();
  if (!userId) redirect(`/?redirect_url=${encodeURIComponent("/join/code")}`);

  async function action(formData: FormData) {
    "use server";
    try {
      await redeemInvite({ tokenOrCode: String(formData.get("code") ?? "").trim() });
    } finally {
      revalidatePath("/dashboard");
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">Enter your invite code</h1>
      <form action={action} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">6-digit code</Label>
          <Input id="code" name="code" required minLength={6} maxLength={6} pattern="\d{6}" inputMode="numeric" />
        </div>
        <Button type="submit" className="w-full">Join household</Button>
      </form>
    </main>
  );
}
