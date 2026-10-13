import { defineConfig } from "vitest/config";

// Unit tests for app/lib and server-render smoke tests for the admin pages.
export default defineConfig({
  test: { include: ["app/**/*.test.{ts,tsx}"] },
  esbuild: { jsx: "automatic" },
});
