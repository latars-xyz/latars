import "server-only";
import crypto from "crypto";
import { cookies, headers } from "next/headers";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

// Admin sign-in is the admin key only: the key (ADMIN_KEY, 12+ characters) is typed into the form at the secret
// address and kept in an httpOnly cookie. There are no admin accounts.

export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

/** Returns false when this IP has done `action` `limit` times within `windowMinutes`. */
export async function rateLimit(action: string, limit: number, windowMinutes: number): Promise<boolean> {
  const db = await getDb();
  const key = `${action}:${hashToken(await clientIp()).slice(0, 32)}`;
  const since = new Date(Date.now() - windowMinutes * 60_000);
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.rateEvents)
    .where(and(eq(schema.rateEvents.key, key), gte(schema.rateEvents.createdAt, since)));
  if (n >= limit) return false;
  await db.insert(schema.rateEvents).values({ key });
  return true;
}

export function isAdminKey(key: string | undefined | null): boolean {
  const expected = process.env.ADMIN_KEY;
  if (!expected || expected.length < 12 || !key) return false;
  const a = Buffer.from(hashToken(key));
  const b = Buffer.from(hashToken(expected));
  return crypto.timingSafeEqual(a, b);
}

export async function isAdmin(): Promise<boolean> {
  return isAdminKey((await cookies()).get("mc_admin")?.value);
}
