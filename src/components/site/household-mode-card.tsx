"use client";

import { useTransition } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inviteMaidFromHome, setHouseholdFamilyRun } from "@/app/dashboard/actions";

export function HouseholdModeCard() {
  const [pendingInvite, startInvite] = useTransition();
  const [pendingFamily, startFamily] = useTransition();
  const busy = pendingInvite || pendingFamily;

  return (
    <Card>
      <CardHeader>
        <CardTitle>How does your household run?</CardTitle>
        <CardDescription>
          Pick one. You can change this later in Household Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() => startInvite(async () => { await inviteMaidFromHome(); })}
        >
          Invite your maid
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() => startFamily(async () => { await setHouseholdFamilyRun(); })}
        >
          We&apos;re family-run
        </Button>
      </CardContent>
    </Card>
  );
}
