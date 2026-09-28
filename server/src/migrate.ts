import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./db/index.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

try {
  await migrate(db, { migrationsFolder });
  console.log("Database migrations completed successfully.");
} finally {
  await pool.end();
}
