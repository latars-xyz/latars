"use client";

import { useEffect, useRef, useState } from "react";
import { adminLoginAction, importMomentsAction, importPostsAction, postMomentAction, saveEventAction, saveTopAccountsAction, importEventFromSiteAction } from "@/lib/actions";
import type { EventSpace } from "@/lib/db/schema";
import { MAX_MOMENT_PHOTOS } from "@/lib/constants";
import type { ImportResult } from "@/lib/data";
import { MultiPhotoPicker, Status, Submit, useForm } from "./client";
import { Field, Tag, cx, inputClass } from "./ui";

export function AdminLogin() {
  const { state, pending, onSubmit } = useForm(adminLoginAction);
  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-wrap gap-2">
      <label htmlFor="key" className="sr-only">
        Admin key
      </label>
      <input id="key" name="key" type="password" placeholder="Admin key" className={cx(inputClass, "flex-1")} />
      <Submit pending={pending} variant="dark">
        Enter
      </Submit>
      <Status state={state} />
    </form>
  );
}

export function ImportForm({ event }: { event: string }) {
  const { state, pending, onSubmit } = useForm(importPostsAction, { refresh: true });
  const rows = state?.ok ? (state.data as ImportResult[]) : [];
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="event" value={event} />
      <Field label="X post links" htmlFor="records" hint="One per line. Text and author are filled in from X's public embed.">
        <textarea id="records" name="records" rows={4} className={cx(inputClass, "font-mono text-xs")} placeholder="https://x.com/someone/status/1234567890123456789" />
      </Field>
      <div className="flex items-center gap-3">
        <Submit pending={pending} variant="dark">
          Add posts
        </Submit>
        <Status state={state} />
      </div>
      <ImportResults rows={rows} />
    </form>
  );
}

function ImportResults({ rows }: { rows: ImportResult[] }) {
  if (!rows.length) return null;
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((r, i) => (
        <li key={i} className="flex gap-2">
          <Tag tone={r.status === "added" ? "green" : r.status === "invalid" ? "flame" : "neutral"}>{r.status}</Tag>
          <span className="break-all">{r.input}</span>
          {r.message && <span className="text-red-600">{r.message}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Admin: X post links are all it takes, many at once. A photo or written update sits under "Or add…". */
export function AdminMomentForm({ event }: { event: string }) {
  const links = useForm(importMomentsAction, { refresh: true });
  const { state, pending, onSubmit, err } = useForm(postMomentAction);
  const linksForm = useRef<HTMLFormElement>(null);
  // Every batch's results, newest first, so a run of pastes reads as one list.
  const [log, setLog] = useState<ImportResult[]>([]);
  useEffect(() => {
    const st = links.state;
    if (!st?.ok) return;
    setLog((l) => [...(st.data as ImportResult[]), ...l].slice(0, 100));
    const box = linksForm.current?.elements.namedItem("links") as HTMLTextAreaElement | null;
    if (box) box.value = "";
  }, [links.state]);
  return (
    <div className="space-y-3">
      <form ref={linksForm} onSubmit={links.onSubmit} noValidate className="space-y-2">
      <input type="hidden" name="event" value={event} />
        <label htmlFor="admin-links" className="sr-only">
          X post links for Moments
        </label>
        <textarea
          id="admin-links"
          name="links"
          rows={3}
          placeholder={"Paste an X post link — it's added right away\nhttps://x.com/someone/status/…"}
          className={cx(inputClass, "font-mono text-xs")}
          // Pasting a post link adds it at once; typed links still use the button.
          onPaste={(e) => {
            if (!/\/status\/\d+/.test(e.clipboardData.getData("text"))) return;
            setTimeout(() => !links.pending && linksForm.current?.requestSubmit(), 0);
          }}
        />
        <div className="flex items-center gap-3">
          <Submit pending={links.pending} className="shrink-0" data-track="admin_import_moments">
            {links.pending ? "Adding…" : "Add"}
          </Submit>
          <div className="min-w-0 text-sm">
            <Status state={links.state} />
          </div>
        </div>
        <ImportResults rows={log} />
      </form>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Or add a photo or update instead</summary>
        <form onSubmit={onSubmit} noValidate className="mt-3 space-y-3">
      <input type="hidden" name="event" value={event} />
          <input type="hidden" name="from" value="admin" />
          <MultiPhotoPicker max={MAX_MOMENT_PHOTOS} error={err("photo")} />
          <Field label="What's happening?" htmlFor="admin-body" optional error={err("body")}>
            <textarea id="admin-body" name="body" rows={2} maxLength={280} className={inputClass} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Where?" htmlFor="admin-place" optional error={err("place")}>
              <input id="admin-place" name="place" maxLength={100} className={inputClass} />
            </Field>
            <Field label="Credit" htmlFor="admin-mname" optional hint="A name or @handle. X posts are credited to their author.">
              <input id="admin-mname" name="name" maxLength={40} autoCapitalize="none" className={inputClass} />
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Submit pending={pending} className="shrink-0" data-track="admin_post_moment">
              Post
            </Submit>
            <div className="min-w-0 text-sm">
              <Status state={state} />
            </div>
          </div>
        </form>
      </details>
    </div>
  );
}

export function TopAccountsForm({ current, event }: { current: string; event: string }) {
  const { state, pending, onSubmit } = useForm(saveTopAccountsAction, { refresh: true });
  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <input type="hidden" name="event" value={event} />
      <Field label="Top accounts" htmlFor="top-accounts" hint="X handles whose posts get a strong boost for Featured (e.g. organisers, speakers, well-known founders). Separate with spaces or new lines.">
        <textarea id="top-accounts" name="handles" rows={2} defaultValue={current} placeholder="@techcabal @someone" className={cx(inputClass, "font-mono text-xs")} />
      </Field>
      <div className="flex items-center gap-3">
        <Submit pending={pending} variant="secondary" size="sm">
          Save
        </Submit>
        <Status state={state} />
      </div>
    </form>
  );
}

/** "2026-11-27" (Lagos) for a date input, from a stored start, or the day an end falls in. */
function lagosDate(d: Date | null, end = false): string {
  if (!d) return "";
  return new Date(d.getTime() + 3600_000 - (end ? 1 : 0)).toISOString().slice(0, 10);
}

/** Admin: add an event by pasting its website; the details are read from the page. */
export function ImportSiteForm({ id = "site" }: { id?: string }) {
  const { state, pending, onSubmit, err } = useForm(importEventFromSiteAction, { refresh: true });
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-2">
      <label htmlFor={id} className="sr-only">
        Event website
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id={id} name="site" type="url" inputMode="url" placeholder="https://the-event-website.com" className={cx(inputClass, "flex-1")} aria-invalid={!!err("site")} />
        <Submit pending={pending} variant="dark" data-track="admin_import_site">
          {pending ? "Reading the site…" : "Add event"}
        </Submit>
      </div>
      <Status state={state} />
    </form>
  );
}

/** Admin: one event's details (or a blank form to add one). */
export function EventForm({ event }: { event: EventSpace | null }) {
  const { state, pending, onSubmit, err } = useForm(saveEventAction, { refresh: true });
  const k = event?.id ?? "new";
  const f = (name: string, label: string, opts: { value?: string | null; placeholder?: string; hint?: string; type?: string; optional?: boolean } = {}) => (
    <Field label={label} htmlFor={`${k}-${name}`} optional={opts.optional ?? true} hint={opts.hint} error={err(name)}>
      <input id={`${k}-${name}`} name={name} type={opts.type ?? "text"} defaultValue={opts.value ?? ""} placeholder={opts.placeholder} className={inputClass} />
    </Field>
  );
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      {event && <input type="hidden" name="id" value={event.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {f("name", "Name", { value: event?.name, placeholder: "Ogun Digital Summit 2026", optional: false })}
        {f("slug", "Address", { value: event?.slug, placeholder: "ogun-digital-summit", hint: "The site address: /your-address", optional: false })}
        {f("short", "Short name", { value: event?.short, placeholder: "Ogun Digital", hint: "For the logo: “OGUN DIGITAL CONNECT”" })}
        {f("organiser", "Organiser", { value: event?.organiser })}
        {f("dates", "Dates (as shown)", { value: event?.dates, placeholder: "26 November 2026" })}
        {f("venue", "Venue", { value: event?.venue, placeholder: "June 12 Cultural Centre, Abeokuta" })}
        {f("startDay", "First day", { value: lagosDate(event?.startsAt ?? null), type: "date", hint: "Before it: “Who's going”" })}
        {f("endDay", "Last day", { value: lagosDate(event?.endsAt ?? null, true), type: "date", hint: "After it: “Find the people you met”" })}
        {f("tagline", "Tagline", { value: event?.tagline })}
        {f("url", "Official site", { value: event?.url, placeholder: "https://…" })}
        {f("hashtag", "Hashtag", { value: event?.hashtag, placeholder: "#OgunDigitalSummit" })}
        {f("xHandle", "X handle", { value: event?.xHandle, placeholder: "@organiser" })}
        {f("position", "Order on the homepage", { value: String(event?.position ?? 100), type: "number" })}
        {f("brandColor", "Brand colour", { value: event?.brandColor, placeholder: "#5b3df5", hint: "For events without a built-in look" })}
        {f("logo", "Logo", { value: event?.logo, placeholder: "/brands/my-event.png or https://…", hint: "The event's own logo" })}
        {f("logoBg", "Logo backing colour", { value: event?.logoBg, placeholder: "#1b2a52", hint: "Only for a white or light logo" })}
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" name="listed" defaultChecked={event?.listed ?? true} className="h-4 w-4 accent-[var(--color-flame-700)]" /> On the homepage
        </label>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" name="promo" defaultChecked={event?.promo ?? false} className="h-4 w-4 accent-[var(--color-flame-700)]" /> Featured ad (a banner at the top of the homepage, linking to its site, until it ends)
        </label>
        <label className="flex items-center gap-2 self-end pb-3 text-sm">
          <input type="checkbox" name="hidden" defaultChecked={event?.hidden ?? false} className="h-4 w-4 accent-[var(--color-flame-700)]" /> Hidden (a draft only admins can open)
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Submit pending={pending} variant="dark" size="sm">
          {event ? "Save" : "Add event"}
        </Submit>
        <Status state={state} />
      </div>
    </form>
  );
}
