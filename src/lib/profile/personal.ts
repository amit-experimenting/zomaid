import { z } from "zod";
import { LANGUAGE_CODES } from "./languages";

// Empty strings (the natural form-field zero value) normalize to null so the
// caller can shovel form data straight in without distinguishing "" vs missing.
const emptyToNull = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? null : v;

export const personalProfileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(120, "Name is too long"),
  passport_number: z
    .preprocess(emptyToNull, z.string().trim().max(64).nullable())
    .optional()
    .transform((v) => v ?? null),
  passport_expiry: z
    .preprocess(emptyToNull, z.iso.date().nullable())
    .optional()
    .transform((v) => v ?? null),
  preferred_language: z
    .preprocess(emptyToNull, z.enum(LANGUAGE_CODES).nullable())
    .optional()
    .transform((v) => v ?? null),
});

export type PersonalProfileInput = z.infer<typeof personalProfileSchema>;
