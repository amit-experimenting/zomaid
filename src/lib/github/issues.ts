// Thin GitHub REST client for bill-OCR ticket lifecycle. Uses a PAT in
// GITHUB_TOKEN with `repo` scope. No SDK dependency — just fetch.

const GH_API = "https://api.github.com";

type IssueRef = { issueNumber: number; issueUrl: string };

function ghHeaders(): HeadersInit {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN not set");
  return {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function ghRepo(): { owner: string; name: string } {
  const owner = process.env.GITHUB_REPO_OWNER;
  const name = process.env.GITHUB_REPO_NAME;
  if (!owner || !name) throw new Error("GITHUB_REPO_OWNER / GITHUB_REPO_NAME not set");
  return { owner, name };
}

export type CreateBillIssueArgs = {
  billId: string;
  householdId: string;
  signedImageUrl: string;
  storeHint: string | null;
  uploadedAtIso: string;
};

/**
 * Creates a GitHub Issue with the bill image embedded and an @claude prompt.
 * The body contains a sentinel <!-- zomaid-bill --> the webhook uses to filter
 * comments to the ones it owns.
 */
export async function createBillIssue(args: CreateBillIssueArgs): Promise<IssueRef> {
  const { owner, name } = ghRepo();
  const body = `<!-- zomaid-bill -->
**Bill ID:** \`${args.billId}\`
**Household:** \`${args.householdId}\`
**Uploaded:** ${args.uploadedAtIso}
**Store hint (user-provided):** ${args.storeHint ? args.storeHint : "_(none)_"}

![bill](${args.signedImageUrl})

---

@claude please read the attached receipt image and reply **only** with a single fenced JSON code block matching this schema. Use SGD. Use ISO date \`YYYY-MM-DD\`. If a value isn't visible, use \`null\`.

\`\`\`json
{
  "store_name": "string or null",
  "bill_date": "YYYY-MM-DD or null",
  "total_amount": 0.00,
  "line_items": [
    { "item_name": "string", "quantity": 0, "unit": "string or null", "unit_price": 0.00, "line_total": 0.00 }
  ]
}
\`\`\`

Do not include any prose; the parser reads only the JSON code block.
`;

  const res = await fetch(`${GH_API}/repos/${owner}/${name}/issues`, {
    method: "POST",
    headers: ghHeaders(),
    body: JSON.stringify({
      title: `Bill OCR: ${args.billId}`,
      body,
      labels: ["bill-ocr"],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub createIssue ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { number: number; html_url: string };
  return { issueNumber: json.number, issueUrl: json.html_url };
}

export type CloseBillIssueArgs = {
  issueNumber: number;
  completionComment: string;
};

export async function closeBillIssue(args: CloseBillIssueArgs): Promise<void> {
  const { owner, name } = ghRepo();
  // 1. Post completion comment.
  const commentRes = await fetch(
    `${GH_API}/repos/${owner}/${name}/issues/${args.issueNumber}/comments`,
    {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ body: args.completionComment }),
    },
  );
  if (!commentRes.ok) {
    const text = await commentRes.text();
    throw new Error(`GitHub addComment ${commentRes.status}: ${text}`);
  }
  // 2. Close the issue.
  const closeRes = await fetch(
    `${GH_API}/repos/${owner}/${name}/issues/${args.issueNumber}`,
    {
      method: "PATCH",
      headers: ghHeaders(),
      body: JSON.stringify({ state: "closed" }),
    },
  );
  if (!closeRes.ok) {
    const text = await closeRes.text();
    throw new Error(`GitHub closeIssue ${closeRes.status}: ${text}`);
  }
}
