import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { isAdminKey } from "@/lib/me";

const KEY = "a-long-admin-key-123";
const saved = process.env.ADMIN_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_KEY;
  else process.env.ADMIN_KEY = saved;
});

describe("admin key", () => {
  it("accepts only the exact key", () => {
    process.env.ADMIN_KEY = KEY;
    expect(isAdminKey(KEY)).toBe(true);
    for (const bad of ["", "wrong-admin-key-123", KEY + "x", KEY.slice(0, -1), undefined, null]) expect(isAdminKey(bad)).toBe(false);
  });
  it("is off when no key is set, or the key is too short to be safe", () => {
    delete process.env.ADMIN_KEY;
    expect(isAdminKey(KEY)).toBe(false);
    process.env.ADMIN_KEY = "short";
    expect(isAdminKey("short")).toBe(false);
  });
});

describe("routing", () => {
  it("serves the landing page at / and sends the old /admin to /adminx", async () => {
    const rewrites = (await nextConfig.rewrites!()) as { beforeFiles: { source: string; destination: string }[] };
    expect(rewrites.beforeFiles).toContainEqual({ source: "/", destination: "/index.html" });
    expect(await nextConfig.redirects!()).toContainEqual({ source: "/admin", destination: "/adminx", permanent: true });
  });
  it("keeps the landing page's own files in /public", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    for (const m of html.matchAll(/(?:href|src)="([^"#:]+\.(?:css|js|jpg|png|svg))"/g)) expect(fs.existsSync(path.join(__dirname, "..", "public", m[1])), m[1]).toBe(true);
  });
  it("doesn't carry the events site's own pages or accounts", () => {
    const src = (f: string) => fs.existsSync(path.join(__dirname, "..", "src", f));
    expect(src("lib/auth.ts")).toBe(false);
    expect(src("app/api")).toBe(false);
    expect(fs.existsSync(path.join(__dirname, "..", "drizzle"))).toBe(false); // moonshot owns the schema and its migrations
  });
});
