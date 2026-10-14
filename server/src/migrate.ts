import "dotenv/config";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { readMigrationUrl } from "./db/migration-url.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
const pool = new pg.Pool({
  connectionString: readMigrationUrl(process.env),
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
});
const db = drizzle(pool);

try {
  await migrate(db, { migrationsFolder });
  console.log("Database migrations completed successfully.");
} finally {
  await pool.end();
}
