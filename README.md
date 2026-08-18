# my-profile

A personal, single-user profile site — built on top of the original
[adbwifi.dev](https://github.com/outsector/adbwifi.dev) (MIT licensed, itself a
fork of [gunslol-open-source](https://github.com/JAQLIV/gunslol-open-source)).

Two pages:

- **`/`** — your public profile (Click to Enter → avatar, typewriter name/bio,
  badges, socials, gallery, background, music player, skills panel).
- **`/customize`** — your private, password-protected visual editor. Three
  panels: sections on the left, a live preview in the middle, contextual
  settings on the right. Click things in the preview to jump straight to
  their settings. Real file uploads, a media library, undo/redo, and autosave.

No accounts, no registration, no multi-user anything — it's just you.

## Why this needed a backend

The original repo is a static single HTML file. A visual editor that
*persists* your changes and *actually* stores uploaded images/audio/video —
so they survive a refresh and are visible to visitors — needs somewhere to
write files and JSON. So this version adds one small file, `server.js`, and
restructures the static assets into `public/` (profile) and `admin/`
(editor). Everything else about the repo's spirit (a guns.lol/fakecrime.bio
style page, GSAP tilt, typewriter effects, orbiting avatar ring, skills
reveal) is preserved and extended.

**`server.js` has zero npm dependencies.** It's built entirely on Node's
built-in `http`, `fs`, and `crypto` modules — including a small hand-rolled
multipart parser for file uploads. That means:
- `npm install` is not required to run it.
- It will run on literally any host that can run `node server.js` and gives
  you a writable disk — which is what makes this a $0 hosting problem, not a
  "which SaaS API keys do I need" problem.

## Running it locally

```bash
node server.js
```

Then open:
- Public profile: http://localhost:3000/
- Editor: http://localhost:3000/customize (password defaults to `changeme`
  — **change this before you deploy**, see below)

## Configuration

Two environment variables, both optional:

| Variable         | Default    | Purpose                                   |
|-------------------|-----------|--------------------------------------------|
| `PORT`            | `3000`    | What port the server listens on            |
| `ADMIN_PASSWORD`  | `changeme`| Password required to use `/customize`      |

You can also copy `.env.example` to `.env` and set them there — `server.js`
loads a `.env` file itself if one exists (no `dotenv` package needed).

```bash
cp .env.example .env
# edit .env, set a real ADMIN_PASSWORD
node server.js
```

## Deploying on Replit (free, no credit card)

This is the easiest genuinely-free, no-card option — Replit's disk is your
actual project filesystem, so `data/` and `uploads/` persist properly
(unlike free tiers that wipe local files on every restart). A `.replit`
config file is already included, so Replit will run `node server.js`
automatically once imported.

1. **Push this project to a GitHub repo first.** The `public/assets/`
   folder has several large binary files (video, mp3s) — dragging ~25
   individual files through the browser upload UI is unreliable, but
   `git push` handles it fine. Unzip this project, `git init`, commit, and
   push it to a new repo on GitHub.
2. **Create a Repl**: at replit.com (no card needed), choose
   **Import from GitHub** and point it at that repo. Replit will detect
   `.replit` and set the run command to `node server.js` automatically.
3. **Set your real password as a Secret** — don't put it in a committed
   `.env` file, since free Repls are publicly viewable. Open the **Secrets**
   tool (padlock icon in the left tool dock), add a secret named
   `ADMIN_PASSWORD` with your real password as the value.
4. **Click Run.** Replit opens a webview with your live URL — something
   like `https://<repl-name>.<your-username>.repl.co`. That's your public
   profile; add `/customize` to reach the editor.
5. **Test persistence** — upload a file in `/customize`, refresh the page,
   confirm it's still there. Then leave the tab closed for a while and
   revisit — the free tier sleeps after inactivity, so the first visit
   after a quiet period takes a few seconds to wake up, but your data and
   uploads will still be there once it does.

Note: Replit's plans and free-tier limits change fairly often — if
anything above doesn't match what you see in their dashboard, their
current docs at replit.com/pricing are the source of truth.

## Deploying for $0 elsewhere

This needs a host that runs a **persistent Node process with a writable
disk** — not a static host (Vercel/Netlify/GitHub Pages won't work, since
they don't give you a disk to store uploads and profile.json on). Free tiers
that do work:

- **Render** (Web Service, free tier): connect the repo, build command
  `npm install` (a no-op here since there are no dependencies), start command
  `node server.js`. Add a **persistent disk** mounted at, e.g., `/opt/render/project/src/data`
  and `/opt/render/project/src/uploads` if you want uploads to survive
  redeploys (Render's free tier disk is ephemeral across deploys without an
  attached disk — paid disks are cheap, or just accept that a redeploy clears
  uploads on the free tier and re-upload when that happens).
- **Fly.io**: `fly launch`, attach a small persistent volume, mount it at
  `/app/data` and `/app/uploads`.
- **Railway**: similar shape to Render.
- **A cheap always-on VPS** (or a spare machine / Raspberry Pi at home) is
  actually the most "$0 forever, nothing ephemeral" option if you already
  have one — just `node server.js` behind a reverse proxy like Caddy or
  nginx for HTTPS, or use a tool like Cloudflare Tunnel for free HTTPS
  without opening ports.

Whichever you choose:
1. Set `ADMIN_PASSWORD` as a real environment variable in the host's
   dashboard (don't rely on the `.env` file for anything containing your
   real password if the host log-captures build output).
2. Make sure `data/` and `uploads/` are on **persistent** storage, not the
   ephemeral container filesystem, or you'll lose your customization and
   uploads on every redeploy/restart.
3. Put a real domain + HTTPS in front of it (most of the hosts above do this
   for you automatically).

## How persistence actually works

- **Profile settings** live in `data/profile.json` (seeded on first run from
  `data/profile.default.json`, the original adbwifi content translated into
  the new schema). The editor `PUT`s the whole document to `/api/profile`
  whenever you make a change (autosave, ~800ms debounce).
- **Uploaded files** are written straight to `uploads/` with a random ID
  prefix on the filename, and served back at `/uploads/<file>`. Metadata
  (original name, type, size, upload date) lives in `data/media.json`.
- **Login sessions** are in-memory only — a server restart logs you out of
  `/customize`, but doesn't affect your live public profile at all.

## Security notes

- `/customize` and every mutating API route (`PUT /api/profile`,
  `POST /api/upload`, `PATCH`/`DELETE /api/media/:id`) require a valid
  session cookie, obtained by posting the correct password to `/api/login`.
- Login attempts are rate-limited per IP (10 attempts / 5 minutes).
- Uploaded filenames are sanitized; only allow-listed extensions are
  accepted (images: png/jpg/jpeg/webp/gif/svg/ico, audio: mp3/wav/ogg,
  video: mp4/webm, fonts: ttf/otf/woff/woff2), each with its own size cap.
- The public profile (`/`, `/uploads/*`, `GET /api/profile`) has no auth —
  that's the point, it's what visitors see.
- Nothing secret is ever sent to the browser; `ADMIN_PASSWORD` only ever
  lives server-side.

## Project structure

```
server.js                  ← the whole backend (no dependencies)
data/
  profile.default.json     ← seed data (only used the very first time)
  profile.json             ← your live profile config (git-ignored)
  media.json               ← media library metadata (git-ignored)
uploads/                   ← your uploaded files live here (git-ignored)
public/                    ← served at /
  index.html
  css/profile.css
  js/profile.js            ← renders the entire public profile from JSON
  assets/                  ← the original repo's default images/audio/video
admin/                     ← served at /customize
  index.html
  css/admin.css
  js/admin.js              ← the whole editor (auth, panels, media library, modals)
```

## What's fully built vs. what's a starting point

Everything in the spec that's a "make X configurable and have it actually
render/persist/upload" feature is real and working end-to-end: Click to
Enter (with 7 transition styles), avatar/username/bio styling and
typewriter cycling, unlimited custom badges with 7 animations, socials with
custom icons, background (image/video/color/gradient/slideshow/particles/
stars/snow/rain/grid/noise with blur/brightness/contrast/saturation),
a real music player with playlist, shuffle/loop, and a live Web-Audio
visualizer, custom cursor styles + particle trail, gallery (grid/masonry/
carousel), 9 theme presets + fully custom colors, 7 layout presets, a
custom-CSS editor scoped to the public page, drag-and-drop uploads with
validation, and a media library with search/sort/filter/rename/delete/use.

A few things are intentionally scoped down, since they either need external
services or are large enough to be their own follow-up:
- **Live third-party widgets** (Discord status, Spotify now-playing, GitHub
  stats, Roblox/Twitch/YouTube embeds) need OAuth/API keys from those
  platforms — the Widgets panel and a `widgets` array in the schema are
  there as the extension point, but only the visitor counter and the
  skills-panel toggle are wired up out of the box.
- **Freeform drag/resize/group for every element** — badges, socials, and
  gallery items are reorderable (move up/down) rather than dragged with a
  mouse; widgets have x/y fields in the schema for free positioning.
  A true pixel-drag canvas editor for arbitrary elements is a meaningfully
  bigger project on its own — happy to build that next if you want it.
- **Fonts panel** — custom font upload is supported by the media library
  (ttf/otf/woff/woff2) and can be wired into `@font-face` + the font pickers;
  it isn't its own left-nav section yet (folded into Settings/Advanced for now).

None of this is a mockup — the whole thing runs on `node server.js` with no
build step, and I've tested login, session gating, profile save/reload,
and file upload (including a binary-integrity checksum check on an mp3)
against the actual server.
