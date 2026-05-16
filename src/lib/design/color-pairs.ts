export type ColorPair = {
  /** Hex foreground (e.g. "#111111"). */
  fg: string;
  /** Hex background (e.g. "#FAF7F2"). */
  bg: string;
  /** WCAG ratio required. 4.5 = AA body, 3.0 = AA large text / non-text. */
  min: 4.5 | 3.0;
  /** Human label used in failure messages. */
  label: string;
};

export const colorPairs: ColorPair[] = [
  // Text on page surface
  { fg: "#111111", bg: "#FAF7F2", min: 4.5, label: "text-primary on surface-0" },
  { fg: "#555555", bg: "#FAF7F2", min: 4.5, label: "text-secondary on surface-0" },
  // NOTE: text-muted darkened from plan's #767676 -> #6F6F6F.
  // #767676 on #FAF7F2 only hit 4.25:1 (AA fails). Task 1.4 must use #6F6F6F too.
  { fg: "#6F6F6F", bg: "#FAF7F2", min: 4.5, label: "text-muted on surface-0" },

  // Text on card surface
  { fg: "#111111", bg: "#FFFFFF", min: 4.5, label: "text-primary on surface-1" },
  { fg: "#555555", bg: "#FFFFFF", min: 4.5, label: "text-secondary on surface-1" },
  // NOTE: text-muted darkened from plan's #767676 -> #6F6F6F (same token, paired w/ white).
  { fg: "#6F6F6F", bg: "#FFFFFF", min: 4.5, label: "text-muted on surface-1" },

  // Primary CTA
  { fg: "#FFFFFF", bg: "#3949AB", min: 4.5, label: "primary-foreground on primary" },
  { fg: "#FFFFFF", bg: "#283593", min: 4.5, label: "primary-foreground on primary-pressed" },

  // Tonal (primary-subtle backgrounds with primary text)
  { fg: "#3949AB", bg: "#E8EAF6", min: 4.5, label: "primary on primary-subtle (tonal icon-button)" },

  // Semantic on subtle backgrounds (banner inner text)
  { fg: "#1F7A3B", bg: "#E9F8EE", min: 4.5, label: "success on success-subtle" },
  // NOTE: warning darkened from plan's #B26100 -> #A55A00.
  // #B26100 on #FFF1E0 only hit 4.11:1 (AA fails). Task 1.4 must use #A55A00 too.
  { fg: "#A55A00", bg: "#FFF1E0", min: 4.5, label: "warning on warning-subtle" },
  { fg: "#C62828", bg: "#FEEAEA", min: 4.5, label: "danger on danger-subtle" },
  { fg: "#1859D1", bg: "#E8F3FF", min: 4.5, label: "info on info-subtle" },

  // Semantic foreground on white (icon chip foregrounds — large/non-text)
  { fg: "#FFFFFF", bg: "#1F7A3B", min: 4.5, label: "white on success" },
  // NOTE: warning bg darkened from plan's #B26100 -> #A55A00 (token-wide change; see warning-on-subtle above).
  { fg: "#FFFFFF", bg: "#A55A00", min: 4.5, label: "white on warning" },
  { fg: "#FFFFFF", bg: "#C62828", min: 4.5, label: "white on danger" },
  { fg: "#FFFFFF", bg: "#1859D1", min: 4.5, label: "white on info" },

  // Borders are intentionally NOT in this registry. WCAG 1.4.11 (non-text
  // contrast 3:1) applies to borders that are essential to perceiving a UI
  // boundary. Our card borders are decorative — the boundary is conveyed by
  // surface tone + border + padding together — so border tokens stay at
  // their designed cream values (border #EFE9E1, border-strong #D9D2C5)
  // and are not registry-checked.
];
