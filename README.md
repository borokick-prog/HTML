# HTML Doc Manager

Upload HTML files, publish each one at a URL you choose, and gate access with a
per-document password and/or expiry date. Single-admin dashboard for
organizing documents into folders.

## Features

- **Upload** `.html`/`.htm` files (up to 5MB each)
- **Custom slugs** — each document is published at `/your-chosen-slug`
- **Per-document password** — optional; visitors must enter it to view the doc
- **Per-document expiry date** — optional; the doc stops being viewable after that date
- **Folders** — organize documents into named folders
- **Single admin login** protects the dashboard

## Setup

```bash
npm install
cp .env.example .env
# edit .env and set SESSION_SECRET to a random string:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

npm start
```

Visit `http://localhost:3000` — the first visit redirects to `/setup` where
you create the admin password. After that, admin logs in at `/login`.

## How it works

- Documents are stored on disk in `uploads/` (filenames are randomized;
  originals are tracked in the database) and metadata lives in a SQLite
  database at `data/app.db`.
- A document with no password and no expiry is publicly viewable at its slug
  immediately after upload.
- A document with a password shows a password gate; once a visitor enters it
  correctly, that unlock is remembered for their browser session.
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
- Set `TRUST_SECURE_COOKIE=true` in `.env` only when the app is served over
  HTTPS (directly or behind a TLS-terminating proxy you trust), so session
  cookies get the `Secure` flag.

## Project structure

```
server.js              entry point
src/
  app.js                express app setup (sessions, view engine, routing)
  db.js                 SQLite connection + schema
  auth.js                password hashing (scrypt)
  slug.js                slug validation/generation + reserved words
  middleware.js          requireAdmin / first-run setup redirect
  routes/
    auth.js               /setup, /login, /logout
    dashboard.js           document + folder CRUD, admin settings
    public.js               /:slug viewer (password gate, expiry check)
views/                  EJS templates
public/                 CSS/JS served at /static
uploads/                uploaded HTML files (gitignored)
data/                   SQLite database file (gitignored)
```

## Deploying

This is a single self-contained Node process — no build step. It runs
anywhere Node runs: a VPS with a process manager (pm2/systemd), a Docker
container, or a platform like Render/Railway/Fly. `uploads/` and `data/`
should be on persistent storage (a volume) if you deploy to a platform with
ephemeral filesystems.
