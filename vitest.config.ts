import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
    server: {
      deps: {
        // next-auth's ESM build imports "next/server" without a file
        // extension, which Node can't resolve unless Vite transforms it.
        // Needed by the middleware test, which runs the real session check.
        inline: ["next-auth"],
      },
    },
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
    },
  },
});