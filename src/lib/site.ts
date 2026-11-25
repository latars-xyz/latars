import "server-only";

/**
 * The public Event Connect site, which the admin links to (event pages, people's photos). The admin itself lives at
 * latars.xyz; the events app is a separate service at EVENTS_ORIGIN.
 */
export async function siteOrigin(): Promise<string> {
  return (process.env.EVENTS_ORIGIN ?? "https://events.latars.xyz").replace(/\/$/, "");
}
