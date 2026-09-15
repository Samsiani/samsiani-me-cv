# samsiani.me — CV website

Bilingual (English `/`, Georgian `/ka/`) CV for Giorgi Samsiani. The public site is plain static HTML and CSS served by the web server: no framework at runtime, no trackers. A small admin service edits the content and re-renders the static files on publish; if the admin is down, the public site keeps working.

## Admin
- **URL:** `https://samsiani.me/admin/`, one account, reachable only through Cloudflare.
- **First login** uses the initial password from the server's `admin.env`; the admin then forces a password change.
- **What it does:** every text in English and Georgian side by side, three layouts (Precision, Studio, Ledger), six palettes, default theme, last-updated date, live preview of unsaved edits, publish in about a second, 30 revisions and one-click rollback of the live site, export and import.
- **Content lives on the server** (`$SITE_HOME/data/site.json`). `src/content/site.json` in this repository is only the first-boot seed and the local development content; production edits never come back into git unless exported by hand.

## Local development
```bash
npm install
npm run cli -- init          # ./data from the seed (./dist is the local web root)
npm run dev                  # admin service on :3097 + Vite dev server on http://localhost:5173/admin/
npm run build                # static build of the seed into dist/ (no admin needed)
npm test                     # unit + admin tests
npm run check:all            # every layout x palette through the page gates (needs Playwright)
npm run test:e2e             # the admin end to end
```
Local dev reads `.env.development` if present (for example `ADMIN_INITIAL_PASSWORD=...` for the first login). `SITE_JSON=path`, `LAYOUT=` and `PALETTE=` override the static build's input.

## Deploy
Push to `main`. GitHub Actions runs four jobs: `test` (unit and admin tests, palette gate, `v-html` check, leak check), `gates` (SPA build, the layout matrix, stress fixture, end-to-end tests), `release` (production dependencies installed on the runner, packed without `deploy/`), and `deploy` (rsync to `/opt/samsiani-admin/releases/<sha>`, then `deploy/remote-deploy.sh` as root: verify, migrate if needed, flip the `current` symlink, reload PM2, health check with automatic revert, re-render the public site from the server's content). Pull requests run `test` and `gates` only.

Server details never live in this repository: the host, SSH user, deploy key and host key are repository secrets (`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, optional `DENYLIST`); paths and the unix user are in the root-only `/opt/samsiani-admin/shared/deploy.env`; secrets are in `admin.env` (see `deploy/*.env.example`). `npm run check:secrets` fails on any leaked literal.

## Structure
- `src/` — content, schema (`schema/validate.mjs`), renderer (`render.mjs`, `build-site.mjs`), layouts (`layouts/<id>/`), palettes (`palettes.json`, `palettes.mjs`), brand images (`brand/`, `shared/brand.mjs`), fonts.
- `admin/server/` — the admin service (Hono): storage, auth, API, preview, publish, CLI (`cli.mjs`). `admin/shared/` — code shared with the SPA. `admin/web/` — the Vue admin interface.
- `deploy/` — PM2 ecosystem, OpenLiteSpeed proxy block, remote deploy script, env examples.
- `scripts/` — page gates, stress gate, pixel identity, leak check, font downloads. `test/` — unit and end-to-end tests.
- `docs/plans/` — the build plan and its specs (design record).

## Runbooks (details in `docs/plans/admin-ops.md` §12)
| | Situation | First step |
|---|---|---|
| R1 | Wrong content went live | Admin → Revisions → Live builds → Roll back (or `cli rollback`) |
| R2 | A deploy broke the admin | The deploy reverts itself when the health check fails |
| R3 | A deploy broke the public pages | Roll the app back, then re-render |
| R4 | Admin down or misbehaving | The public site keeps serving; `pm2 logs samsiani-admin --err` |
| R5 | Lost password or locked out | `cli set-password`, or `pm2 restart samsiani-admin` to clear limits |
| R6 | Suspected compromise | Stop the service, rotate secrets, review the audit log |
| R7 | Corrupt data file | `draft.json` recovers from revisions; `cli restore-backup` |
| R8 | Return to the static pipeline | See the runbook |
| R9 | Rotate secrets | `SESSION_SECRET_PREV`, then reload; the edge secret with its Cloudflare rule |
| R10 | New or rebuilt server | Re-create the env files, restore a backup, deploy |
| R11 | After any Cloudflare rule change | The two admin cache and edge checks |
