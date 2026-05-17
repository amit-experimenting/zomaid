"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/components/ui/submit-button";
import { LANGUAGE_CODES, languageLabel, type LanguageCode } from "@/lib/profile/languages";

type Initial = {
  display_name: string;
  passport_number: string | null;
  passport_expiry: string | null;       // YYYY-MM-DD
  preferred_language: string | null;
};

type Props = {
  initial: Initial;
  action: (formData: FormData) => Promise<void>;
  redirectTo: "/dashboard" | "/household/settings";
  submitLabel: string;
};

export function PersonalProfileForm({ initial, action, redirectTo, submitLabel }: Props) {
  const [name, setName] = useState(initial.display_name);
  const valid = name.trim().length > 0;

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="redirect_to" value={redirectTo} />

      <div className="space-y-1.5">
        <Label htmlFor="display_name">Your name</Label>
        <Input
          id="display_name"
          name="display_name"
          required
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />
        <p className="text-xs text-text-muted">Required. Edit if the auto-filled name isn&apos;t right.</p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passport_number">Passport number (optional)</Label>
        <Input
          id="passport_number"
          name="passport_number"
          maxLength={64}
          defaultValue={initial.passport_number ?? ""}
          autoComplete="off"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passport_expiry">Passport expiry (optional)</Label>
        <Input
          id="passport_expiry"
          name="passport_expiry"
          type="date"
          defaultValue={initial.passport_expiry ?? ""}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="preferred_language">Preferred language (optional)</Label>
        <select
          id="preferred_language"
          name="preferred_language"
          defaultValue={initial.preferred_language ?? ""}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-11"
        >
          <option value="">— Select —</option>
          {LANGUAGE_CODES.map((code: LanguageCode) => (
            <option key={code} value={code}>{languageLabel(code)}</option>
          ))}
        </select>
      </div>

      <SubmitButton disabled={!valid} className="w-full">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
