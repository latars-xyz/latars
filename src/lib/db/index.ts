import "server-only";
import path from "path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

// The database belongs to the `moonshot` service: it creates and migrates every table (events, ads, support and
// rates schemas) when it starts. This app only reads and writes them, so it never runs migrations itself.
// Locally, set MIGRATIONS_DIR to moonshot's `drizzle` folder to get a throwaway embedded database with the same tables.
async function connect(): Promise<DB> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_SIZE ?? 5) });
    return drizzle(client, { schema }) as unknown as DB;
  }
  if (process.env.NODE_ENV === "production" || !process.env.MIGRATIONS_DIR) {
    throw new Error("DATABASE_URL is not set (the same database the moonshot service uses)");
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: process.env.MIGRATIONS_DIR, migrationsSchema: schema.DB_SCHEMA });
  return db as unknown as DB;
}

const g = globalThis as unknown as { __latarsDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  if (!g.__latarsDb) {
    g.__latarsDb = connect().catch((err) => {
      g.__latarsDb = undefined;
      throw err;
    });
  }
  return g.__latarsDb;
}

export { schema };
