"use strict";

const NAMED_AS_ICON_BUTTON = new Set(["IconButton"]);

function hasA11yLabel(node) {
  return node.attributes.some(attr => {
    if (attr.type !== "JSXAttribute") return false;
    const name = attr.name.name;
    return name === "aria-label" || name === "aria-labelledby" || name === "title";
  });
}

function hasTextChild(parent) {
  if (!parent || !parent.children) return false;
  return parent.children.some(child => {
    if (child.type === "JSXText" && child.value.trim()) return true;
    if (child.type === "JSXExpressionContainer") {
      const e = child.expression;
      if (e.type === "Literal" && typeof e.value === "string" && e.value.trim()) return true;
      if (e.type === "TemplateLiteral" && e.quasis.some(q => q.value.cooked.trim())) return true;
    }
    return false;
  });
}

module.exports = {
  meta: {
    type: "problem",
    docs: { description: "Require aria-label on icon-only buttons" },
    schema: [],
    messages: {
      missing: "Icon-only button needs an aria-label (or aria-labelledby / title).",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!name) return;
        const isIconButton = NAMED_AS_ICON_BUTTON.has(name);
        const isPlainButton = name === "button";
        if (!isIconButton && !isPlainButton) return;
        if (hasA11yLabel(node)) return;
        if (isPlainButton) {
          // Plain <button> only fails if it has no text children.
          const parent = node.parent;
          if (hasTextChild(parent)) return;
        }
        context.report({ node, messageId: "missing" });
      },
    };
  },
};
