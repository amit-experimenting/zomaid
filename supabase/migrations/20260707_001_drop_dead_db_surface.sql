-- Drop dead DB surface surfaced by the 2026-05-16 codebase audit.
--
-- 1. ingest_bill_ocr(uuid, jsonb) RPC was the GitHub-Issues OCR pipeline (slice 3).
--    Superseded by the direct Sonnet vision flow in src/app/api/bills/scan/.
--    Zero callers in src/ as of the audit.
--
-- 2. profiles.locale and profiles.timezone were defined in the initial
--    profiles migration but never written or read by any application code.

begin;

drop function if exists public.ingest_bill_ocr(uuid, jsonb);

alter table public.profiles drop column if exists locale;
alter table public.profiles drop column if exists timezone;

commit;
