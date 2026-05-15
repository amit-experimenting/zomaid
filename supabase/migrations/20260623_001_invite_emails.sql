-- Optional email-whitelist on invites. When intended_email is set and a user
-- signs in via Clerk with that email, the app auto-redeems the invite on
-- their first authenticated request (see tryRedeemPendingEmailInvite). The
-- existing token + 6-digit-code flow is unchanged; this is additive.

alter table public.invites
  add column intended_email text
    check (
      intended_email is null
      or length(intended_email) between 3 and 254
    );

-- Block two unconsumed invites for the same (household, email).
create unique index invites_active_email_per_household_idx
  on public.invites (household_id, lower(intended_email))
  where consumed_at is null and intended_email is not null;

-- Fast lookup at redemption: pending invites for a given lower(email).
create index invites_active_email_lookup_idx
  on public.invites (lower(intended_email))
  where consumed_at is null and intended_email is not null;
