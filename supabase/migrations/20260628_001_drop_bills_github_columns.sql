-- The GitHub-Issues OCR pipeline is retired (see commits 16c03b2 + e9df3d7).
-- Bills now use the Claude Sonnet 4.6 vision scan flow on /inventory/new and
-- nothing reads or writes the github_issue_number / github_issue_url columns
-- anymore. Drop them.

alter table public.bills
  drop column if exists github_issue_number,
  drop column if exists github_issue_url;
