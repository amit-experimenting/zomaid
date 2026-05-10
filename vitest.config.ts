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
    // ensures test files run serially. IMPORTANT: unlike singleFork (one fork
    // for all files), each file still runs in its own fork process — so the
    // pg.Client singleton in setup.ts connects/disconnects once per file, not
    // once per run. All DB mutations must use withTransaction; never rely on
    // cross-file Client state.
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
