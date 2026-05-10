import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    pool: "forks",
    // Vitest 4 removed poolOptions.forks.singleFork. fileParallelism: false
    // ensures test files run serially, so the pg.Client singleton (setup.ts)
    // opens and closes once per file, not per suite. Files don't overlap, but
    // connection setup is paid per-file.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
