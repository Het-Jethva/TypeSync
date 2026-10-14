import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { readMigrationUrl } from "./src/db/migration-url.js";

export default defineConfig({
  out: "./drizzle",
  schema: "./src/db/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: readMigrationUrl(process.env),
  },
});
