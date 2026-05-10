import { redirect } from "next/navigation";
import { getCurrentHousehold } from "@/lib/auth/current-household";
import { createHouseholdAsOwner } from "@/app/onboarding/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function OwnerOnboardingPage() {
  if (await getCurrentHousehold()) redirect("/dashboard");

  async function action(formData: FormData) {
    "use server";
    await createHouseholdAsOwner({
      name: String(formData.get("name") ?? "").trim(),
      addressLine: String(formData.get("addressLine") ?? "").trim() || undefined,
      postalCode: String(formData.get("postalCode") ?? "").trim() || undefined,
    });
  }

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold sm:text-2xl">Start your household</h1>
      <form action={action} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Household name</Label>
          <Input id="name" name="name" required maxLength={100} placeholder="e.g. Tan Family" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addressLine">Address (optional)</Label>
          <Input id="addressLine" name="addressLine" maxLength={200} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="postalCode">Postal code (optional)</Label>
          <Input id="postalCode" name="postalCode" maxLength={20} />
        </div>
        <Button type="submit" className="w-full">Continue</Button>
      </form>
    </main>
  );
}
