import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DATABASE_URL: "postgresql://typesync:typesync_dev@127.0.0.1:1/typesync",
      NODE_ENV: "test",
    },
  },
});
