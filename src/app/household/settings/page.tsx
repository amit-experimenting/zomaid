import { requireHousehold } from "@/lib/auth/require";
import { createServiceClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site-url";
import { MainNav } from "@/components/site/main-nav";
import {
  createInvite, removeMembership,
  updateHouseholdDiet, updateMembershipDiet, updateMembershipPrivilege,
} from "@/app/household/settings/actions";
import { HouseholdDietForm } from "@/components/household/household-diet-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { NotificationToggle } from "@/components/tasks/notification-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Diet, Privilege } from "@/lib/db/types";

const DIET_LABELS: Record<Diet, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  eggitarian: "Eggitarian",
  non_vegetarian: "Non-vegetarian",
};
function dietLabel(d: Diet): string {
  return DIET_LABELS[d];
}

export default async function HouseholdSettingsPage() {
  const ctx = await requireHousehold();
  const svc = createServiceClient();
  const origin = await siteUrl();

  const [members, invites] = await Promise.all([
    svc
      .from("household_memberships")
      .select("id, role, privilege, status, diet_preference, profile:profiles(id, display_name, email)")
      .eq("household_id", ctx.household.id)
      .eq("status", "active"),
    svc
      .from("invites")
      .select("id, intended_role, intended_privilege, intended_email, code, token, expires_at, consumed_at")
      .eq("household_id", ctx.household.id)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (invites.error) throw new Error(invites.error.message);

  const isOwner = ctx.membership.role === "owner";
  const isMaid  = ctx.membership.role === "maid";

  async function inviteFamily(formData: FormData) {
    "use server";
    await createInvite({
      role: "family_member",
      privilege: (formData.get("privilege") ?? "view_only") as Privilege,
      email: String(formData.get("email") ?? ""),
    });
  }
  async function inviteMaid(formData: FormData) {
    "use server";
    await createInvite({
      role: "maid",
      email: String(formData.get("email") ?? ""),
    });
  }
  async function inviteOwner(formData: FormData) {
    "use server";
    await createInvite({
      role: "owner",
      email: String(formData.get("email") ?? ""),
    });
  }
  async function remove(formData: FormData) {
    "use server";
    await removeMembership({ membershipId: String(formData.get("membershipId")) });
  }
  async function changePriv(formData: FormData) {
    "use server";
    await updateMembershipPrivilege({
      membershipId: String(formData.get("membershipId")),
      privilege: String(formData.get("privilege")) as Privilege,
    });
  }
  async function changeDiet(formData: FormData) {
    "use server";
    await updateMembershipDiet({
      membershipId: String(formData.get("membershipId")),
      diet: String(formData.get("diet")),
    });
  }
  async function changeHouseholdDiet(formData: FormData) {
    "use server";
    await updateHouseholdDiet({ diet: String(formData.get("diet") ?? "") });
  }

  return (
    <main className="mx-auto max-w-md">
      <MainNav active="home" />
      <div className="px-4 py-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{ctx.household.name}</h1>
        <p className="text-sm text-muted-foreground">Household settings</p>
      </header>

      {(isOwner || isMaid) && (
        <Card>
          <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
          <CardContent>
            <NotificationToggle />
          </CardContent>
        </Card>
      )}

      <Card id="diet">
        <CardHeader><CardTitle>Meal preference</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Sets what shows up in your meal plan and recipes for the whole household.
            When set, this overrides each member&apos;s personal preference for planning.
          </p>
          {isOwner || isMaid ? (
            <HouseholdDietForm
              currentValue={ctx.household.diet_preference}
              members={[...members.data!]
                .filter((m) => m.role !== "maid")
                .map((m) => {
                  const p = (m as unknown as {
                    profile: { display_name: string; email: string };
                  }).profile;
                  return {
                    displayName: p.display_name || p.email,
                    dietPreference: m.diet_preference,
                  };
                })}
              action={changeHouseholdDiet}
            />
          ) : (
            <p className="text-sm">
              {ctx.household.diet_preference
                ? dietLabel(ctx.household.diet_preference)
                : "No household preference"}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Members</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y">
            {[...members.data!]
              .sort((a, b) => (a.role === "maid" ? 1 : 0) - (b.role === "maid" ? 1 : 0))
              .map((m) => {
              const p = (m as unknown as { profile: { id: string; display_name: string; email: string } }).profile;
              const isMaidRow = m.role === "maid";
              const canRemove =
                isOwner ? m.role !== "owner" || p.id !== ctx.profile.id
                        : p.id === ctx.profile.id && m.role !== "owner";
              const isSelf = p.id === ctx.profile.id;
              const canEditDiet = isOwner || isMaid || isSelf;
              return (
                <li
                  key={m.id}
                  className={cn(
                    "flex flex-wrap items-center justify-between gap-3 py-3",
                    isMaidRow && "border-l-2 border-l-primary bg-primary/5 pl-3",
                  )}
                >
                  <div>
                    <p className="font-medium">{p.display_name || p.email}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className={cn(isMaidRow && "text-primary font-medium")}>{m.role}</span>
                      {m.role === "family_member" ? ` · ${m.privilege}` : ""}
                      {isMaidRow ? " · diet noted but plan ignores it" : ""}
                      {!isMaidRow && ctx.household.diet_preference !== null
                        ? " · household preference active — this is ignored for planning"
                        : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {canEditDiet ? (
                      <form action={changeDiet} className="flex items-center gap-2">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <select
                          name="diet"
                          defaultValue={m.diet_preference ?? "none"}
                          className="rounded-md border bg-background px-2 py-1 text-sm"
                          aria-label="Diet preference"
                        >
                          <option value="none">No preference</option>
                          <option value="vegan">Vegan</option>
                          <option value="vegetarian">Vegetarian</option>
                          <option value="eggitarian">Eggitarian</option>
                          <option value="non_vegetarian">Non-veg</option>
                        </select>
                        <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                      </form>
                    ) : null}
                    {isOwner && m.role === "family_member" ? (
                      <form action={changePriv} className="flex items-center gap-2">
                        <input type="hidden" name="membershipId" value={m.id} />
                        <select name="privilege" defaultValue={m.privilege} className="rounded-md border bg-background px-2 py-1 text-sm">
                          <option value="meal_modify">meal_modify</option>
                          <option value="view_only">view_only</option>
                        </select>
                        <SubmitButton size="sm" variant="secondary">Update</SubmitButton>
                      </form>
                    ) : null}
                    {canRemove ? (
                      <form action={remove}>
                        <input type="hidden" name="membershipId" value={m.id} />
                        <SubmitButton size="sm" variant="destructive">
                          {p.id === ctx.profile.id ? "Leave" : "Remove"}
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Invites</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          {isOwner ? (
            <form action={inviteFamily} className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grow space-y-1.5">
                  <Label htmlFor="privilege">Family member privilege</Label>
                  <select name="privilege" id="privilege" defaultValue="view_only"
                          className="block w-full rounded-md border bg-background px-2 py-1 text-sm">
                    <option value="view_only">view_only ($5)</option>
                    <option value="meal_modify">meal_modify ($9)</option>
                  </select>
                </div>
                <SubmitButton>Invite family member</SubmitButton>
              </div>
              <div className="space-y-1">
                <Input name="email" type="email" placeholder="Email (optional)" />
                <p className="text-xs text-muted-foreground">Auto-join when this email signs in.</p>
              </div>
            </form>
          ) : null}
          {isOwner ? (
            <form action={inviteMaid} className="space-y-3">
              <SubmitButton variant="secondary">Invite maid</SubmitButton>
              <div className="space-y-1">
                <Input name="email" type="email" placeholder="Email (optional)" />
                <p className="text-xs text-muted-foreground">Auto-join when this email signs in.</p>
              </div>
            </form>
          ) : null}
          {isMaid ? (
            <form action={inviteOwner} className="space-y-3">
              <SubmitButton variant="secondary">Invite owner</SubmitButton>
              <div className="space-y-1">
                <Input name="email" type="email" placeholder="Email (optional)" />
                <p className="text-xs text-muted-foreground">Auto-join when this email signs in.</p>
              </div>
            </form>
          ) : null}

          {invites.data!.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active invites.</p>
          ) : (
            <ul className="divide-y">
              {invites.data!.map((i) => (
                <li key={i.id} className="space-y-1 py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{i.intended_role}</span>
                    <span className="text-xs text-muted-foreground">code: <code>{i.code}</code></span>
                  </div>
                  {i.intended_email && (
                    <div className="text-xs text-muted-foreground">→ {i.intended_email}</div>
                  )}
                  <code className="block break-all rounded bg-muted px-2 py-1 text-xs">
                    {`${origin}/join/${i.token}`}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </div>
    </main>
  );
}
