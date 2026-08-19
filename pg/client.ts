import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import "dotenv/config";
import * as schema from "./schema/index";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL manquant (vérifie .env)");
}

export const pgPool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pgPool.on("error", (err) => {
  console.error("[pg] erreur pool non gérée:", err.message);
});

export const db = drizzle(pgPool, { schema });

export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DBOrTx = DB | Tx;
