# HTML Doc Manager

Upload HTML files, publish each one at a URL you choose, and gate access with a
per-document password and/or expiry date. Single-admin dashboard for
organizing documents into folders. Built to run on Vercel (or any Node host)
with Postgres as the only backing store — no local disk required.

## Features

- **Upload** `.html`/`.htm` files (up to 4MB each, stored in Postgres)
- **Custom slugs** — each document is published at `/your-chosen-slug`
- **Per-document password** — optional; visitors must enter it to view the doc
- **Per-document expiry date** — optional; the doc stops being viewable after that date
- **Folders** — organize documents into named folders
- **Single admin login** protects the dashboard

## Setup

1. Get a Postgres database. Any of these have a free tier:
   - [Neon](https://neon.tech) or [Supabase](https://supabase.com) (add via Vercel's Storage marketplace, or sign up directly)
   - Railway, Render Postgres, or your own server
   - Local Postgres for development

2. Configure environment variables:

   ```bash
   cp .env.example .env
   # edit .env: set DATABASE_URL to your Postgres connection string
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   # paste that into SESSION_SECRET in .env
   ```

3. Install and run:

   ```bash
   npm install
   npm start
   ```

Visit `http://localhost:3000` — the first visit redirects to `/setup` where
you create the admin password. After that, admin logs in at `/login`. Tables
are created automatically on first run.

## Deploying to Vercel

1. Push this repo to GitHub and import it into Vercel (or run `vercel` from
   this directory).
2. In the Vercel project, add a Postgres integration under **Storage**
   (Neon or Supabase both work) — this sets `DATABASE_URL`/`POSTGRES_URL`
   automatically. If your provider only sets `POSTGRES_URL`, also add
   `DATABASE_URL` in **Settings → Environment Variables** with the same value.
3. Add a `SESSION_SECRET` environment variable (see command above).
4. Deploy. `vercel.json` routes every request through `api/index.js`, which
   is the same Express app used locally — `server.js` is only for local dev.

No other configuration is needed: Vercel always serves over HTTPS, so secure
session cookies are enabled automatically (detected via the `VERCEL` env var
Vercel sets for you).

## How it works

- Document HTML is stored directly in Postgres (a `content` column), and
  metadata (slug, title, password hash, expiry, folder) lives alongside it —
  there's no filesystem dependency, which is why this works on serverless.
- A document with no password and no expiry is publicly viewable at its slug
  immediately after upload.
- A document with a password shows a password gate; once a visitor enters it
  correctly, that unlock is remembered for their browser session (sessions
  are stored in Postgres too, via `connect-pg-simple`, so they survive across
  serverless instances).
- A document with an expiry date returns "link expired" after that date,
  regardless of password.
- Slugs must be lowercase letters, numbers, and hyphens, and can't collide
  with reserved paths (`login`, `dashboard`, `api`, `static`, etc.) or other
  documents.

## Security notes

- Admin and document passwords are hashed with `scrypt` (Node's built-in
  crypto), never stored in plain text.
- Session cookies are `HttpOnly` and `SameSite=Strict`.
- Uploaded HTML is served with a `Content-Security-Policy: sandbox` header,
  which gives each document an opaque browser origin. Scripts in the
  document still run, but they cannot read this app's cookies, localStorage,
  or make authenticated requests back into the dashboard — this contains the
  blast radius of a malicious or compromised upload.

## Project structure

```
server.js              local dev entry point (app.listen)
api/index.js            Vercel serverless entry point (exports the Express app)
vercel.json              routes all requests to api/index.js
src/
  app.js                 express app setup (sessions, view engine, routing)
  db.js                   Postgres pool + schema + settings helpers
  auth.js                  password hashing (scrypt)
  slug.js                   slug validation/generation + reserved words
  middleware.js             requireAdmin / first-run setup redirect
  routes/
    auth.js                  /setup, /login, /logout
    dashboard.js              document + folder CRUD, admin settings
    public.js                  /:slug viewer (password gate, expiry check)
views/                  EJS templates
public/                 CSS/JS served at /static
```

## Deploying elsewhere

This also runs as a plain Node process (`npm start`) on Railway, Render,
Fly.io, or a VPS — just set `DATABASE_URL` and `SESSION_SECRET`. No build
step, no local disk required.
