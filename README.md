# Latars

Latars is a product studio. Projects:

- **Neighbourly** ([neighbourly.ng](https://neighbourly.ng)): an AI guide and business directory for Redemption Camp.
- **Bak Network** ([baknetwork.com](https://baknetwork.com)): a community for the people behind the scenes in the creator economy.
- **Event Connect** ([events.latars.xyz](https://events.latars.xyz)): meet the right people at events like Moonshot by TechCabal.
- **AdsSim** ([ads.latars.xyz](https://ads.latars.xyz)): an ad-buying flight simulator for practising campaigns on Meta, TikTok, Google, X and ChatGPT ads without spending money.
- **Rates by Latars** ([rates.latars.xyz](https://rates.latars.xyz)): what creators and influencers actually charge.

This repo is two things in one Next.js app:

1. **The Latars site**: the static page in `public/` (`index.html`, `styles.css`, `script.js`, `assets/`), served at `/`.
2. **The admin for every project**, at **`/adminx`**: Event Connect, AdsSim, Rates and the support inbox in one place.

```sh
npm install
npm run dev        # http://localhost:3000
npm run lint && npm run typecheck && npm test && npm run build
```

## Admin

`latars.xyz/adminx` is a plain 404 for everyone who isn't signed in. The admin signs in with **the admin key only**: open the secret address `/adminx/<ADMIN_ENTRY>`, type the key (`ADMIN_KEY`, 12+ characters), and a cookie keeps you in for two weeks. There are no admin accounts. (Until `ADMIN_ENTRY` is set, the key form shows on `/adminx` itself so nobody is locked out.) Key attempts are rate limited. The old `/admin` redirects to `/adminx`.

- **Event Connect:** an inbox of what needs attention (reports, events waiting for approval), every event with its details, moments, people and stats, moderation, and adding an event from just its website.
- **AdsSim:** sign-ups, activity and the emails CSV.
- **Rates:** creators people added (with rates and rate cards), sign-ups, adding a creator from a link, hiding or deleting, and the sign-ups CSV.
- **Support:** chats from visitors to Event Connect and AdsSim, with replies emailed to the visitor.

## How it fits with `moonshot`

The admin reads and writes **the same Postgres as the `moonshot` service**. `moonshot` owns the database: it creates and migrates every table (the `connect`, `ads`, `support` and `rates` schemas) when it starts, and it serves the public sites and APIs (Event Connect, AdsSim, support chat, Rates). This app never runs migrations.

Some code is a copy of `moonshot`'s because both need it: the Drizzle schema (`src/lib/db/schema.ts`) and the data logic the admin shares with the public APIs (`rates.ts`, `rates-enrich.ts`, `safe-fetch.ts`, `ads.ts`, `support.ts`, `data.ts`, `events.ts`, `stats.ts` and friends). **If a table or shared logic changes in `moonshot`, update the copy here.** A single shared package would remove this; it's the obvious next step if the copies start to drift.

## Deploying on Railway

This service builds and runs the Next app: `npm run build` then `npm start` (Railway's Next.js detection does this; there's no longer a plain Node `server.js` or a forward to `moonshot`). Settings:

| Variable | What it is |
| --- | --- |
| `DATABASE_URL` | The same Postgres as `moonshot` (`${{Postgres.DATABASE_URL}}`). Required. |
| `ADMIN_KEY` | The admin key, 12+ random characters. Required. |
| `ADMIN_ENTRY` | The secret address of the key form. Strongly recommended. |
| `EVENTS_ORIGIN` | Where Event Connect lives (default `https://events.latars.xyz`): the admin links to it and loads event logos and photos from it. |
| `RESEND_API_KEY`, `ADS_MAIL_FROM` | Email, so support replies reach visitors. Without a key replies are saved but not emailed. |
| `X_BEARER_TOKEN` | Optional: pulls X post details when importing moments. |
| `EVENT_MODE` | Only if it's set on `moonshot`: use the same value. |

Support *notifications to you* (a visitor wrote in) are still sent by `moonshot`, which receives the messages: keep `SUPPORT_NOTIFY_EMAIL` and `NTFY_TOPIC` there.

Local work without a database: set `MIGRATIONS_DIR` to a checkout of `moonshot`'s `drizzle` folder and an embedded database with the same tables is created for you.
