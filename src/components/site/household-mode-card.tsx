"use client";

import { useTransition } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { inviteMaidFromHome, setHouseholdFamilyRun } from "@/app/dashboard/actions";

export function HouseholdModeCard() {
  const [pendingInvite, startInvite] = useTransition();
  const [pendingFamily, startFamily] = useTransition();
  const busy = pendingInvite || pendingFamily;

  return (
    <Banner
      tone="info"
      title="How does your household run?"
      action={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => startInvite(async () => { await inviteMaidFromHome(); })}
          >
            Invite your maid
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={busy}
            onClick={() => startFamily(async () => { await setHouseholdFamilyRun(); })}
          >
            We&apos;re family-run
          </Button>
        </div>
      }
    >
      Pick one. You can change this later in Household Settings.
    </Banner>
  );
}
