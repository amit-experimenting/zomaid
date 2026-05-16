"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { inviteMaidFromHome, revokeMaidInviteFromHome } from "@/app/dashboard/actions";

type Props =
  | { state: "empty" }
  | { state: "pending"; origin: string; code: string; token: string; inviteId: string }
  | { state: "joined"; maidName: string };

export function OwnerInviteMaidCard(props: Props) {
  if (props.state === "joined") return <JoinedCard maidName={props.maidName} />;
  if (props.state === "pending") return <PendingCard {...props} />;
  return <EmptyCard />;
}

function EmptyCard() {
  const [pending, start] = useTransition();
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Invite your maid</CardTitle>
        <CardDescription>Send a code or a link your maid can tap to join the household.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          disabled={pending}
          onClick={() => start(async () => { await inviteMaidFromHome(); })}
        >
          {pending ? "Generating…" : "Generate invite"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PendingCard({ origin, code, token, inviteId }: Extract<Props, { state: "pending" }>) {
  const url = `${origin}/join/${token}`;
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revoking, startRevoke] = useTransition();

  useEffect(() => {
    // Deliberately set in effect (not via useState lazy initializer) so SSR
    // and the first client render agree (`false`), preventing a hydration
    // mismatch. The effect then upgrades to the real value after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; the link is visible in the <code> block.
    }
  }

  async function share() {
    try {
      await navigator.share({
        title: "Join my Zomaid household",
        text: `Join my household on Zomaid. Code: ${code}`,
        url,
      });
    } catch {
      // User cancelled or share failed; ignore.
    }
  }

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Share this with your maid</CardTitle>
        <CardDescription>One-time link, expires in 7 days.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Code</p>
          <p className="mt-1 font-mono text-3xl font-semibold tracking-widest">{code}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Link</p>
          <code className="mt-1 block break-all rounded-md bg-muted p-3 text-xs">{url}</code>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={copy}>
            {copied ? "Copied!" : "Copy link"}
          </Button>
          {canShare ? (
            <Button type="button" size="sm" variant="outline" onClick={share}>
              Share
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={revoking}
            onClick={() => startRevoke(async () => { await revokeMaidInviteFromHome({ inviteId }); })}
          >
            {revoking ? "Revoking…" : "Revoke"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function JoinedCard({ maidName }: { maidName: string }) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Maid: {maidName}</CardTitle>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
            Joined
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <Link
          href="/household/settings"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          Manage
        </Link>
      </CardContent>
    </Card>
  );
}
