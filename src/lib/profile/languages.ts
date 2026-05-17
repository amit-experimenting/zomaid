// src/lib/profile/languages.ts
// Stored as short codes in the DB so labels can be localized later without a
// data migration. Order is the display order in the dropdown.

export const LANGUAGE_CODES = [
  "en", "hi", "ta", "te", "kn", "mr", "bn", "ml", "mni", "lus", "pa",
] as const;

export type LanguageCode = (typeof LANGUAGE_CODES)[number];

const LABELS: Record<LanguageCode, string> = {
  en:  "English",
  hi:  "Hindi",
  ta:  "Tamil",
  te:  "Telugu",
  kn:  "Kannada",
  mr:  "Marathi",
  bn:  "Bengali",
  ml:  "Malayalam",
  mni: "Manipuri",
  lus: "Mizo",
  pa:  "Punjabi",
};

export function languageLabel(code: LanguageCode): string {
  return LABELS[code];
}

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}
