import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@raycast/api": new URL("./tests/raycast-stub.ts", import.meta.url).pathname,
      "@raycast/utils": new URL("./tests/raycast-stub-utils.ts", import.meta.url).pathname,
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    testTimeout: 15000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/core/types.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        statements: 80,
        "src/adapters/parsers.ts": { branches: 100 },
        "src/core/state-machine.ts": { branches: 100 },
      },
    },
  },
});
