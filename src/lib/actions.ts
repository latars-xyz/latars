"use server";

import { parseEventForm } from "@/lib/event-form";
import { ImportError, fetchPublicPage, readEventPage } from "@/lib/site-import";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { isAdmin, isAdminKey, rateLimit } from "@/lib/me";
import { UserError, importPosts, momentDetailFields, parseImport, type ImportResult } from "@/lib/data";
import { fetchOEmbed, fetchPostDetails } from "@/lib/social/providers";
import { parseXPostUrl, snowflakeToDate } from "@/lib/social/x-url";
import { parsePhoto } from "@/lib/photo";
import { clientIp, visitorHash } from "@/lib/track";
import { MAX_MOMENT_PHOTOS } from "@/lib/constants";
import { parseHandles, topAccountsKey } from "@/lib/featured";
import { cleanColor, getEvent, listEvents } from "@/lib/events";

export type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; fields?: Record<string, string> };

async function guard(fn: () => Promise<Result | void>): Promise<Result> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (err) {
    if (err instanceof UserError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: "Something went wrong — please try again." };
  }
}

const refresh = () => revalidatePath("/", "layout");

/** The event a form belongs to (its hidden "event" field, the event's slug). */
async function formEvent(form: FormData) {
  const e = await getEvent(await getDb(), String(form.get("event") ?? ""));
  if (!e) throw new UserError("That event wasn't found.");
  return e;
}

async function xMomentFields(xPost: NonNullable<ReturnType<typeof parseXPostUrl>>) {
  const [embed, details] = await Promise.all([fetchOEmbed(xPost.url), fetchPostDetails(xPost.id)]);
  if (!embed?.text && !details?.media.length) return null;
  return {
    xPostUrl: xPost.url,
    xAuthorHandle: xPost.handle,
    xAuthorName: embed?.authorName ?? null,
    xText: embed?.text?.slice(0, 1000) ?? null,
    xMedia: details?.media ?? [],
    xAvatarUrl: details?.avatarUrl ?? null,
    xPostedAt: snowflakeToDate(xPost.id),
    ...(details ? momentDetailFields(details) : {}),
  };
}

/** Admin: add many X posts as moments at once (one link per line). Posts already in Moments are skipped. */
export async function importMomentsAction(_: Result | null, form: FormData): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    const event = await formEvent(form);
    const lines = Array.from(new Set(String(form.get("links") ?? "").split(/[\s,]+/).map((l) => l.trim()).filter(Boolean))).slice(0, 50);
    if (!lines.length) return { ok: false, error: "Paste at least one X post link." };
    const existing = new Set((await db.select({ url: schema.moments.xPostUrl }).from(schema.moments).where(and(eq(schema.moments.eventId, event.id), sql`${schema.moments.xPostUrl} is not null`))).map((r) => r.url));
    const results: ImportResult[] = [];
    const h = await headers();
    const visitor = visitorHash(clientIp(h), h.get("user-agent") ?? "");
    // A few at a time, oldest first, so the newest post ends up on top of Moments.
    const todo: { input: string; post: NonNullable<ReturnType<typeof parseXPostUrl>> }[] = [];
    for (const input of lines) {
      const post = parseXPostUrl(input);
      if (!post) results.push({ input, status: "invalid", message: "Not an X post link" });
      else if (existing.has(post.url)) results.push({ input, status: "duplicate" });
      else {
        existing.add(post.url);
        todo.push({ input, post });
      }
    }
    todo.sort((a, b) => (BigInt(a.post.id) < BigInt(b.post.id) ? -1 : 1));
    for (let i = 0; i < todo.length; i += 4) {
      const batch = todo.slice(i, i + 4);
      const fetched = await Promise.all(batch.map((t) => xMomentFields(t.post)));
      for (const [j, t] of batch.entries()) {
        const fields = fetched[j];
        if (!fields) {
          results.push({ input: t.input, status: "invalid", message: "Couldn't load it (is it public?)" });
          continue;
        }
        await db.insert(schema.moments).values({ ...fields, eventId: event.id, body: "", visitor });
        results.push({ input: t.input, status: "added" });
      }
    }
    const n = (st: string) => results.filter((r) => r.status === st).length;
    refresh();
    return { ok: true, message: `${n("added")} added, ${n("duplicate")} already there, ${n("invalid")} couldn't be added.`, data: results };
  });
}

/** Moments: anyone can post photos and/or a short update. A card is optional. */
export async function postMomentAction(_: Result | null, form: FormData): Promise<Result> {
  const body = String(form.get("body") ?? "").trim();
  const place = String(form.get("place") ?? "").trim();
  const rawName = String(form.get("name") ?? "").trim();
  if (body.length > 280) return { ok: false, error: "Keep it under 280 characters.", fields: { body: "Keep it under 280 characters." } };
  if (place.length > 100) return { ok: false, error: "Keep the place short.", fields: { place: "Keep it under 100 characters." } };
  const rawPhotos = form.getAll("photo").map(String).filter(Boolean);
  if (rawPhotos.length > MAX_MOMENT_PHOTOS) return { ok: false, error: `Up to ${MAX_MOMENT_PHOTOS} photos.`, fields: { photo: `Up to ${MAX_MOMENT_PHOTOS} photos.` } };
  const photos: { mime: string; data: string }[] = [];
  for (const raw of rawPhotos) {
    const photo = parsePhoto(raw);
    if ("error" in photo) return { ok: false, error: photo.error, fields: { photo: photo.error } };
    photos.push(photo);
  }
  const rawX = String(form.get("xUrl") ?? "").trim();
  const xPost = rawX ? parseXPostUrl(rawX) : null;
  if (rawX && !xPost) return { ok: false, error: "That isn't an X post link.", fields: { xUrl: "Paste a link like x.com/name/status/123…" } };
  if (!photos.length && !body && !xPost) return { ok: false, error: "Add a photo, an X post link, or write something." };
  // "@handle" credits an X account; anything else is shown as a plain name.
  const handle = rawName.match(/^@?([A-Za-z0-9_]{1,15})$/) && rawName.startsWith("@") ? rawName.slice(1) : null;
  const name = handle ? null : rawName.slice(0, 40) || null;

  let slug = "";
  const result = await guard(async () => {
    if (!(await isAdmin())) return { ok: false, error: "Admins only." };
    const db = await getDb();
    const event = await formEvent(form);
    slug = event.slug;
    // Moments added from the admin page are credited to the name typed there.
    const me = null as { id: string } | null;
    const h = await headers();
    // An X post moment copies the post's text, images and author from X (it must be public).
    let x = {};
    if (xPost) {
      const fields = await xMomentFields(xPost);
      if (!fields) return { ok: false, error: "We couldn't load that X post. Is it public?", fields: { xUrl: "We couldn't load that post." } };
      x = fields;
    }
    const [m] = await db
      .insert(schema.moments)
      .values({
        ...x,
        eventId: event.id,
        personId: me?.id ?? null,
        name: me ? null : name,
        xHandle: me ? null : handle,
        body,
        place: place || null,
        hasPhoto: photos.length > 0,
        photoCount: photos.length,
        visitor: visitorHash(clientIp(h), h.get("user-agent") ?? ""),
      })
      .returning({ id: schema.moments.id });
    if (photos.length) await db.insert(schema.momentPhotos).values(photos.map((p, position) => ({ momentId: m.id, position, ...p })));
  });
  refresh();
  // Back to Moments with the new one's id, so the "Posted" note can offer to share it on X.
  if (result.ok) redirect(`/adminx/connect/events/${slug}?tab=moments&added=1`);
  return result;
}

// ─── Admin (ADMIN_KEY) ───────────────────────────────────────────────────────

async function requireAdmin() {
  if (!(await isAdmin())) throw new UserError("Admins only.");
  return getDb();
}

export async function adminLoginAction(_: Result | null, form: FormData): Promise<Result> {
  if (!process.env.ADMIN_KEY) return { ok: false, error: "Set the ADMIN_KEY variable (12+ characters) to enable admin." };
  const key = String(form.get("key") ?? "");
  if (!(await rateLimit("admin_key", 10, 15))) return { ok: false, error: "Too many tries. Wait a few minutes." };
  if (!isAdminKey(key)) return { ok: false, error: "That key isn't right." };
  (await cookies()).set("mc_admin", key, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 14 });
  redirect("/adminx");
}

export async function adminLogoutAction() {
  (await cookies()).delete("mc_admin");
  redirect("/");
}

export async function importPostsAction(_: Result | null, form: FormData): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    const { records, errors } = parseImport(String(form.get("records") ?? "").slice(0, 200_000));
    if (!records.length && !errors.length) return { ok: false, error: "Paste at least one X post link." };
    const event = await formEvent(form);
    const results = [...errors, ...(await importPosts(db, event.id, records, fetchOEmbed))];
    const n = (st: string) => results.filter((r) => r.status === st).length;
    refresh();
    return { ok: true, message: `${n("added")} added, ${n("duplicate")} already there, ${n("invalid")} invalid.`, data: results };
  });
}

/**
 * 🔥 ❤️ 👏 on a moment. Tapping again takes it back. The browser's random id is only stored hashed,
 * so a reaction can't be traced to anyone.
 */
export async function saveEventAction(_: Result | null, form: FormData): Promise<Result> {
  return guard(async (): Promise<Result> => {
    const db = await requireAdmin();
    const id = String(form.get("id") ?? "");
    const parsed = parseEventForm(form);
    if (!parsed.ok) return parsed;
    const logo = String(form.get("logo") ?? "").trim().slice(0, 300) || null;
    if (logo && !/^(\/brands\/[\w.-]+|https:\/\/\S+)$/.test(logo)) return { ok: false, error: "The logo should be a /brands/… file or an https:// link.", fields: { logo: "e.g. /brands/my-event.png" } };
    const rawBg = String(form.get("logoBg") ?? "").trim();
    const logoBg = cleanColor(rawBg);
    if (rawBg && !logoBg) return { ok: false, error: "Pick a backing colour like #1b2a52.", fields: { logoBg: "e.g. #1b2a52" } };
    const values = { ...parsed.values, logo, logoBg, position: Number(form.get("position") ?? 100) || 100, hidden: form.get("hidden") === "on", listed: form.get("listed") === "on", promo: form.get("promo") === "on" };
    const clash = await db.query.eventSpaces.findFirst({ where: eq(schema.eventSpaces.slug, values.slug) });
    if (clash && clash.id !== id) return { ok: false, error: "Another event already uses that address.", fields: { slug: "Already taken" } };
    if (id) await db.update(schema.eventSpaces).set(values).where(eq(schema.eventSpaces.id, id));
    else await db.insert(schema.eventSpaces).values(values);
    refresh();
    return { ok: true, message: id ? "Saved." : `Added. It lives at /${values.slug}.` };
  });
}

/**
 * Admin: add an event from just its website. Reads the page for the name, dates, venue, logo and colour, and adds
 * it to "Waiting for approval" so the details can be checked (and fixed) before it goes on the homepage.
 */
export async function importEventFromSiteAction(_: Result | null, form: FormData): Promise<Result> {
  return guard(async (): Promise<Result> => {
    const db = await requireAdmin();
    const site = String(form.get("site") ?? "").trim().slice(0, 500);
    if (!site) return { ok: false, error: "Paste the event's website.", fields: { site: "Required" } };
    if (!(await rateLimit("import_event", 30, 60))) return { ok: false, error: "Too many imports. Try again in a while." };
    let page: { html: string; url: string };
    try {
      page = await fetchPublicPage(site);
    } catch (err) {
      return { ok: false, error: err instanceof ImportError ? err.message : "Couldn't read that website.", fields: { site: "Couldn't read it" } };
    }
    const found = readEventPage(page.html, page.url);
    if (!found.name) return { ok: false, error: "Couldn't find the event's name on that page. Add it with the form below instead." };
    const url = page.url.replace(/[?#].*$/, "");
    const host = new URL(url).host.replace(/^www\./, "");
    const existing = (await listEvents(db, { includeHidden: true })).find((e) => e.url && new URL(e.url).host.replace(/^www\./, "") === host && new URL(e.url).pathname.replace(/\/$/, "") === new URL(url).pathname.replace(/\/$/, ""));
    if (existing) return { ok: false, error: `That event is already here: /${existing.slug}.` };
    const fd = new FormData();
    const set = (k: string, v: string | null) => v && fd.set(k, v);
    set("name", found.name);
    set("organiser", found.organiser);
    set("tagline", found.tagline);
    set("venue", found.venue);
    set("url", url);
    set("xHandle", found.xHandle);
    set("brandColor", found.brandColor);
    set("startDay", found.startDay);
    set("endDay", found.endDay);
    let parsed = parseEventForm(fd);
    if (!parsed.ok) {
      // Dates that don't make sense: keep the rest and let the admin add them.
      fd.delete("startDay");
      fd.delete("endDay");
      parsed = parseEventForm(fd);
    }
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const values = parsed.values;
    // A free address: "name", else "name-2", "name-3"…
    const base = values.slug;
    for (let n = 2; await db.query.eventSpaces.findFirst({ where: eq(schema.eventSpaces.slug, values.slug) }); n++) values.slug = `${base.slice(0, 56)}-${n}`;
    await db.insert(schema.eventSpaces).values({ ...values, logo: found.logo, listed: false, position: 100 });
    refresh();
    const missing = [!values.startsAt && "dates", !values.venue && "venue", !found.logo && "logo"].filter(Boolean);
    return {
      ok: true,
      message: `Added ${values.name}${values.dates ? `, ${values.dates}` : ""}${values.venue ? ` at ${values.venue}` : ""} as /${values.slug}. It's waiting for approval${missing.length ? `: add the ${missing.join(" and ")} first (not on the page)` : ""}.`,
      data: { slug: values.slug },
    };
  });
}

/** Admin: put an event someone created on the homepage list. */
export async function approveEventAction(id: string): Promise<Result> {
  return guard(async () => {
    await (await requireAdmin()).update(schema.eventSpaces).set({ listed: true, hidden: false }).where(eq(schema.eventSpaces.id, id));
    refresh();
    return { ok: true, message: "Approved: it's on the homepage." };
  });
}

/** Admin: pin a moment as Featured (one at a time), or unpin it so Featured rotates by engagement again. */
export async function setFeaturedAction(id: string, on: boolean): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    const [m] = await db.select({ eventId: schema.moments.eventId }).from(schema.moments).where(eq(schema.moments.id, id)).limit(1);
    if (!m) return { ok: false, error: "That moment isn't here any more." };
    // One pin per event.
    await db.update(schema.moments).set({ featuredAt: null }).where(and(eq(schema.moments.eventId, m.eventId), sql`${schema.moments.featuredAt} is not null`));
    if (on) await db.update(schema.moments).set({ featuredAt: new Date() }).where(eq(schema.moments.id, id));
    refresh();
    return { ok: true, message: on ? "Pinned as Featured." : "Unpinned." };
  });
}

/** Admin: the X accounts whose posts get a strong boost for Featured. */
export async function saveTopAccountsAction(_: Result | null, form: FormData): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    const event = await formEvent(form);
    const handles = parseHandles(String(form.get("handles") ?? "").slice(0, 5000));
    await db
      .insert(schema.settings)
      .values({ key: topAccountsKey(event.id), value: handles.join(" ") })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value: handles.join(" ") } });
    refresh();
    return { ok: true, message: handles.length ? `Saved ${handles.length} account${handles.length === 1 ? "" : "s"}.` : "Cleared." };
  });
}

export async function setHiddenAction(kind: "person" | "post" | "comment" | "moment" | "checkin", id: string, hidden: boolean): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    if (kind === "checkin") await db.update(schema.checkins).set({ hidden }).where(eq(schema.checkins.id, id));
    else if (kind === "moment") await db.update(schema.moments).set({ hidden }).where(eq(schema.moments.id, id));
    else if (kind === "person") await db.update(schema.people).set({ hidden }).where(eq(schema.people.id, id));
    else if (kind === "comment") await db.update(schema.comments).set({ hidden }).where(eq(schema.comments.id, id));
    else await db.update(schema.socialPosts).set({ hidden }).where(eq(schema.socialPosts.id, id));
    refresh();
  });
}

export async function removePhotoAction(personId: string): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    await db.delete(schema.photos).where(eq(schema.photos.personId, personId));
    await db.update(schema.people).set({ photoUpdatedAt: null }).where(eq(schema.people.id, personId));
    refresh();
  });
}

/** Admin: decide on something that was reported: hide it (or keep it hidden), or show it again. Closes its reports. */
export async function decideReportAction(reportId: string, hide: boolean): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    const [r] = await db.select().from(schema.reports).where(eq(schema.reports.id, reportId)).limit(1);
    if (!r) return { ok: false, error: "That report isn't here any more." };
    const kind = (["post", "comment", "moment", "checkin"].includes(r.targetType) ? r.targetType : "person") as "post" | "comment" | "moment" | "checkin" | "person";
    const table = { person: schema.people, moment: schema.moments, checkin: schema.checkins, post: schema.socialPosts, comment: schema.comments }[kind];
    await db.update(table).set({ hidden: hide }).where(eq(table.id, r.targetId));
    await db.update(schema.reports).set({ resolved: true }).where(eq(schema.reports.targetId, r.targetId));
    refresh();
    return { ok: true, message: hide ? "Hidden." : "Shown again." };
  });
}

export async function resolveReportAction(id: string): Promise<Result> {
  return guard(async () => {
    const db = await requireAdmin();
    // Reports on the same thing show as one, so dismissing closes them all.
    const [r] = await db.select({ targetId: schema.reports.targetId }).from(schema.reports).where(eq(schema.reports.id, id)).limit(1);
    if (r) await db.update(schema.reports).set({ resolved: true }).where(eq(schema.reports.targetId, r.targetId));
    refresh();
  });
}
