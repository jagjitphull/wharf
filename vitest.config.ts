import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: that one's `root` is scoped to
// src/renderer for the app's own build and isn't meant to also drive tests
// of main-process code (which run under plain Node, not a browser-like
// environment, and live outside that root).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
