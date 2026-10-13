import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";
import { config } from "../config.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5_000,
  query_timeout: 10_000,
});

export const db = drizzle(pool, { schema });

export { pool };
