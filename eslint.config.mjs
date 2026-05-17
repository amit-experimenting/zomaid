import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noArbitraryDesignValues from "./eslint-rules/no-arbitrary-design-values.js";
import iconButtonNeedsLabel from "./eslint-rules/icon-button-needs-label.js";

const designPlugin = {
  rules: {
    "no-arbitrary-design-values": noArbitraryDesignValues,
    "icon-button-needs-label": iconButtonNeedsLabel,
  },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { design: designPlugin },
    rules: {
      "design/no-arbitrary-design-values": "error",
      "design/icon-button-needs-label": "error",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/sw.js",
  ]),
]);

export default eslintConfig;
