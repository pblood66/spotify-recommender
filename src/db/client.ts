import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { config } from "../config";
import * as schema from "./schema";

const pool = new Pool({
  connectionString: config.db.url,
  min: config.db.poolMin,
  max: config.db.poolMax,
  idleTimeoutMillis: config.db.idleTimeoutMs,
  connectionTimeoutMillis: config.db.connectionTimeoutMs,
  ssl: config.env === "production" ? { rejectUnauthorized: true } : false,
});

pool.on("error", (err) => {
  console.error("[Postgres] unexpected pool error:", err);
});

export const db = drizzle(pool, { schema });

export async function checkDbConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

export async function closeDb(): Promise<void> {
  await pool.end();
}