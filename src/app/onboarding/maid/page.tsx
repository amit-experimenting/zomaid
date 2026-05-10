import { redirect } from "next/navigation";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createHouseholdAsMaid } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function MaidOnboardingPage() {
  if (await getCurrentHousehold()) redirect("/dashboard");

  async function action(formData: FormData) {
    "use server";
    await createHouseholdAsMaid({
      ownerName: String(formData.get("ownerName") ?? "").trim(),
      ownerEmail: String(formData.get("ownerEmail") ?? "").trim(),
    });
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold sm:text-2xl">Tell us about your owner</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We'll create your household and send a join invite to your owner.
      </p>
      <form action={action} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="ownerName">Owner's name</Label>
          <Input id="ownerName" name="ownerName" required maxLength={100} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ownerEmail">Owner's email</Label>
          <Input id="ownerEmail" name="ownerEmail" type="email" required maxLength={200} />
        </div>
        <Button type="submit" className="w-full">Continue</Button>
      </form>
    </main>
  );
}
