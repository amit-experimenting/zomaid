"use strict";

/**
 * Bans arbitrary color/size values in className strings:
 *   - bg-[#…], text-[##px], border-[…hex…]
 *   - raw hex (#abc, #aabbcc) appearing inside JSX className attribute strings
 *   - raw oklch(…) inside className
 * Files in allowlistedPaths are exempt because they DEFINE the system.
 */

const ARBITRARY_PATTERN = /\b(?:bg|text|border|fill|stroke|ring|from|to|via|outline|divide|placeholder)-\[(#[0-9a-f]+|oklch\([^\]]+\))\]/i;
const SIZE_ARBITRARY_PATTERN = /\b(?:h|w|min-h|min-w|max-h|max-w|p[xytrbl]?|m[xytrbl]?|gap|space-[xy]|text|leading|tracking)-\[\d+(\.\d+)?(px|rem|em)\]/;
// Matches just the arbitrary-value opener (e.g. `text-[`) without requiring a
// closed body. Used to catch template-literal interpolation like
// `` `text-[${dyn}]` `` where the value is split across multiple quasis.
const ARBITRARY_OPENER_PATTERN = /\b(?:bg|text|border|fill|stroke|ring|from|to|via|outline|divide|placeholder|h|w|min-h|min-w|max-h|max-w|p[xytrbl]?|m[xytrbl]?|gap|space-[xy]|leading|tracking)-\[/;
const HEX_IN_STRING = /#[0-9a-fA-F]{3,8}\b/;
const OKLCH_IN_STRING = /oklch\s*\(/i;

// Class-name builders whose string arguments we should also walk. Covers the
// common aliases used across the codebase plus a couple of widely-used ones so
// teams swapping libraries don't silently lose coverage.
const CN_NAMES = new Set(["cn", "clsx", "classNames", "tw"]);

const DEFAULT_ALLOWLIST = [
  "src/app/globals.css",
  "src/components/ui/",
  "src/lib/design/",
  "eslint-rules/",
  "tests/design/",
];

function isAllowlisted(filename, allowlist) {
  const norm = filename.replace(/\\/g, "/");
  return allowlist.some(p => norm.includes(p));
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Disallow arbitrary design values outside the design system" },
    schema: [
      {
        type: "object",
        properties: { allowlist: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      arbitrary: "Arbitrary design value '{{match}}' — use a design token instead.",
      hex: "Hex literal '{{match}}' in className — use a design token instead.",
      oklch: "Raw oklch() in className — use a design token instead.",
    },
  },
  create(context) {
    const opts = context.options[0] || {};
    const allowlist = opts.allowlist || DEFAULT_ALLOWLIST;
    if (isAllowlisted(context.getFilename(), allowlist)) return {};

    function check(node, value, allowOpenerOnly) {
      if (typeof value !== "string") return;
      const arb = value.match(ARBITRARY_PATTERN) || value.match(SIZE_ARBITRARY_PATTERN);
      if (arb) { context.report({ node, messageId: "arbitrary", data: { match: arb[0] } }); return; }
      if (allowOpenerOnly) {
        const opener = value.match(ARBITRARY_OPENER_PATTERN);
        if (opener) { context.report({ node, messageId: "arbitrary", data: { match: opener[0] } }); return; }
      }
      const hex = value.match(HEX_IN_STRING);
      if (hex) { context.report({ node, messageId: "hex", data: { match: hex[0] } }); return; }
      if (OKLCH_IN_STRING.test(value)) { context.report({ node, messageId: "oklch", data: { match: "oklch(" } }); return; }
    }

    function walkExpression(expr, node) {
      if (!expr) return;
      if (expr.type === "Literal") {
        check(node, expr.value, false);
        return;
      }
      if (expr.type === "TemplateLiteral") {
        // For template literals, a single quasi can contain an arbitrary-value
        // opener (e.g. `text-[`) followed by an interpolated `${dyn}` — that
        // counts as an arbitrary value even though the closing bracket lives
        // in a later quasi. Allow opener-only matches in this case.
        for (const q of expr.quasis) check(node, q.value.cooked, true);
        return;
      }
      if (expr.type === "CallExpression") {
        const calleeName =
          expr.callee.type === "Identifier"
            ? expr.callee.name
            : expr.callee.type === "MemberExpression" && expr.callee.property.type === "Identifier"
              ? expr.callee.property.name
              : null;
        if (calleeName && CN_NAMES.has(calleeName)) {
          for (const arg of expr.arguments) walkExpression(arg, node);
        }
        return;
      }
      if (expr.type === "ConditionalExpression") {
        walkExpression(expr.consequent, node);
        walkExpression(expr.alternate, node);
        return;
      }
      if (expr.type === "LogicalExpression") {
        walkExpression(expr.left, node);
        walkExpression(expr.right, node);
        return;
      }
      // Identifiers, spread, etc. — can't inspect statically. Skip.
    }

    return {
      JSXAttribute(node) {
        if (node.name.name !== "className") return;
        if (node.value && node.value.type === "Literal") check(node, node.value.value, false);
        if (node.value && node.value.type === "JSXExpressionContainer") {
          walkExpression(node.value.expression, node);
        }
      },
    };
  },
};
