import { describe, it } from "vitest";
import { RuleTester } from "eslint";
// @ts-expect-error – plain JS rule, no types
import noArbitrary from "../../eslint-rules/no-arbitrary-design-values.js";
// @ts-expect-error – plain JS rule, no types
import iconBtnLabel from "../../eslint-rules/icon-button-needs-label.js";

const tsxParserOptions = {
  ecmaVersion: 2024 as const,
  sourceType: "module" as const,
  ecmaFeatures: { jsx: true },
};

const rt = new RuleTester({ languageOptions: { parserOptions: tsxParserOptions } });

describe("no-arbitrary-design-values", () => {
  it("rule tests", () => {
    rt.run("no-arbitrary-design-values", noArbitrary, {
      valid: [
        { code: `const x = <div className="bg-primary text-foreground p-4" />`, filename: "src/app/page.tsx" },
        { code: `const x = <div className="bg-[#123456]" />`, filename: "src/components/ui/button.tsx" }, // allowlisted
        // cn() with token classes is fine
        { code: `const x = <div className={cn("bg-primary text-foreground")} />`, filename: "src/app/page.tsx" },
        // cn() inside allowlisted file is fine even with arbitraries
        { code: `const x = <div className={cn("bg-[#abc]")} />`, filename: "src/components/ui/button.tsx" },
        // clsx alias works
        { code: `const x = <div className={clsx("bg-primary")} />`, filename: "src/app/page.tsx" },
      ],
      invalid: [
        {
          code: `const x = <div className="bg-[#abcdef]" />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        {
          code: `const x = <div className="text-[#111]" />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        {
          code: `const x = <div className="h-[42px]" />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        {
          code: "const x = <div className={`text-[${dyn}]`} />",
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        // Bare cn() with arbitrary
        {
          code: `const x = <div className={cn("bg-[#abc]")} />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        // Conditional inside cn()
        {
          code: `const x = <div className={cn("base", isActive && "h-[42px]")} />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        // Nested cn() (some codebases do this — verify the walker recurses)
        {
          code: `const x = <div className={cn("base", cn("text-[#111]"))} />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
        // clsx with arbitrary
        {
          code: `const x = <div className={clsx("bg-[#abc]")} />`,
          filename: "src/app/page.tsx",
          errors: [{ messageId: "arbitrary" }],
        },
      ],
    });
  });
});

describe("icon-button-needs-label", () => {
  it("rule tests", () => {
    rt.run("icon-button-needs-label", iconBtnLabel, {
      valid: [
        { code: `const x = <IconButton aria-label="Add" />`, filename: "src/app/page.tsx" },
        { code: `const x = <IconButton aria-labelledby="x" />`, filename: "src/app/page.tsx" },
        { code: `const x = <button>Save</button>`, filename: "src/app/page.tsx" },
        { code: `const x = <button aria-label="Close"><span>x</span></button>`, filename: "src/app/page.tsx" },
      ],
      invalid: [
        { code: `const x = <IconButton />`, filename: "src/app/page.tsx", errors: [{ messageId: "missing" }] },
        { code: `const x = <button><span /></button>`, filename: "src/app/page.tsx", errors: [{ messageId: "missing" }] },
      ],
    });
  });
});
