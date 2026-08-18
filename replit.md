# my-profile

A personal, single-user profile site with a password-protected visual editor.

- **Public profile:** `/` — Click to Enter splash → avatar, typewriter bio, badges, socials, gallery, music player, background effects.
- **Editor:** `/customize` — live preview with three-panel settings editor, media library, undo/redo, autosave.

## Running

```
node server.js
```

Zero npm dependencies — no `npm install` needed. The workflow `Start application` handles this automatically.

## Configuration

| Secret / Env var  | Default    | Purpose                              |
|-------------------|------------|--------------------------------------|
| `ADMIN_PASSWORD`  | `changeme` | Password for the `/customize` editor |
| `PORT`            | `3000`     | HTTP port (set to `5000` on Replit)  |

Set `ADMIN_PASSWORD` as a Replit Secret (padlock icon) — never commit a real password to the repo.

## Key files

- `server.js` — zero-dependency Node HTTP server; all routes and API endpoints
- `public/` — public profile page (`index.html`, `css/profile.css`, `js/profile.js`)
- `admin/` — editor (`index.html`, `css/admin.css`, `js/admin.js`)
- `data/profile.default.json` — seed data (used only on first run)
- `data/profile.json` — live profile config (git-ignored, written by the editor)
- `uploads/` — uploaded media files (git-ignored)

## User preferences

- Keep the existing zero-dependency Node.js stack — no build step, no npm packages.
