# Deployment — YOUSIVAR–Ω

The repository ships three runnable pieces: the web application
(`artifacts/yousivar-omega`), the API server (`artifacts/api-server`) and the
PostgreSQL database they share. The Android application is a shell around the
deployed web application (see [`ANDROID_BUILD.md`](ANDROID_BUILD.md)), so it is
deployed — and rolled back — together with the website.

> **Deploying to Cloudflare?** [`CLOUDFLARE.md`](CLOUDFLARE.md) covers the
> Cloudflare Pages + Workers + Hyperdrive + R2 architecture, the required
> bindings, secrets, dashboard settings, deploy commands and rollback plan.
> This file describes the standard Node/Replit deployment flow.

> **There is no production URL for this project yet.** The website is currently
> reachable only in the development environment. Everywhere below, "the deployed
> origin" means the address you host it on; until one exists, an Android build
> shows its bundled "no application URL configured" screen.

## 1. Cloudflare-ready architecture for this repository

This repository is not a native Cloudflare Workers Express app. The practical
production pattern is:

1. Deploy the frontend as a Cloudflare Pages static site at the public app origin.
2. Use a Cloudflare Pages Function at `/api/*` to proxy browser requests to the
   real Express API origin configured by `API_PROXY_ORIGIN`.
3. Keep the actual Express API in a Node-compatible production runtime that can
   connect to PostgreSQL and Clerk, while the Pages app presents the API as the
   same-origin `/api` namespace.
4. Preserve the current same-origin security gate in the Express app; that check
   validates `Origin` and `Host` and will reject cross-origin writes unless the
   proxy preserves the app origin headers.

This is the safest path because it preserves the existing Express app, the
Drizzle/PostgreSQL stack, same-origin admin checks, Clerk auth and the APK asset
behavior without rewriting the application security model.

### Cloudflare Pages proxy behavior

The Pages project should proxy `/api/*` to a real Express API origin while
preserving the browser host/origin headers. This keeps browser requests on the
same origin even when the backend sits on another domain.

## 2. Development environment (Base44 sandbox)

```sh
docker compose -f docker-compose.base44.yml up -d --build
```

| service | role |
| --- | --- |
| `db` | PostgreSQL 16, data in the `yousivar-pgdata` volume |
| `deps` | one-shot `pnpm install --frozen-lockfile` into the bind-mounted repo |
| `db-push` | one-shot Drizzle schema push (`push-force`, the repo's dev step) |
| `api` | Express API on host port 8000 |
| `web` | Vite dev server on host port 3000 — the preview entry point |

Everything runs from the clone, so edits are picked up without rebuilding an
image. The API has no watcher: `docker compose -f docker-compose.base44.yml restart api`
after changing server code. Details, including the sandbox-only overrides
(`BASE44_PREVIEW_MODE`, `TRUSTED_ORIGIN_HOSTS`, `API_PROXY_ORIGIN`), are in
[`AGENTS.md`](AGENTS.md).

The Android build is **not** part of this compose file: it is a separate
toolchain (JDK 21 + Android SDK) documented in `ANDROID_BUILD.md`, so the preview
stack stays light.

## 3. Environment variables the deployment needs

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | API | PostgreSQL connection string |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | API | Session verification; **development-instance keys** while developing, production keys when live |
| `VITE_CLERK_PUBLISHABLE_KEY` | web build | Same publishable key, exposed to the browser |
| `VITE_CLERK_PROXY_URL` | web build | `/api/__clerk` in production (the Frontend API proxy runs only when `NODE_ENV=production`) |
| `API_PROXY_ORIGIN` | Pages proxy | Public origin for the Express API used by the Cloudflare proxy |
| `OWNER_EMAIL` | API | The verified owner email; only that identity gets `OWNER` |
| `OWNER_USERNAME`, `OWNER_PASSWORD` (or `OWNER_PASSWORD_HASH`) | API | The Ω owner-access flow |
| `RESEND_API_KEY` **or** `SMTP_*` + `MAIL_FROM` | API | Delivers owner verification codes |
| `PORT`, `BASE_PATH` | web build | Required by `vite.config.ts`; use the port the host serves |
| `YOUSIVAR_APP_URL` | Android build | Origin the Android shell loads |

Secrets belong in the platform's secret store (the sandbox delivers them to
`/run/base44/app.env`; Replit uses Replit Secrets). Never commit them, never put
them in a browser bundle, never paste them into chat.

## 4. Deploying the website

The repository was created on Replit and its own artifacts (`artifacts/api-server`,
`artifacts/yousivar-omega`) are what a Replit deployment publishes. Whichever host
you use, the requirements are the same:

1. **Build the web application** with `PORT` and `BASE_PATH` set, and the
   `VITE_*` variables present at build time:
   ```sh
   pnpm install --frozen-lockfile
   pnpm run typecheck
   pnpm --filter @workspace/yousivar-omega run build
   ```
2. **Run the API** against the production database, with the owner and mail
   variables above, behind https.
3. **Keep one origin.** The browser client calls relative `/api/...` paths and the
   API rejects mutating requests from other origins, so the website and the API
   must be served from the same origin (route `/api` to the API server). This is
   also what makes the Clerk session cookie and the owner session cookie work —
   do not split them across two hosts.
4. **Serve `/downloads/*.apk` with `Content-Type: application/vnd.android.package-archive`.**
   The Vite dev server and `vite preview` set this (see the plugin in
   `artifacts/yousivar-omega/vite.config.ts`); a production reverse proxy or
   object store needs the same mapping, otherwise some browsers and download
   managers refuse the file:
   ```nginx
   location ~* \.apk$ {
     types { application/vnd.android.package-archive apk; }
     default_type application/vnd.android.package-archive;
   }
   ```
5. **Apply the database schema** (`pnpm --filter @workspace/db run push`, or the
   migration flow you use). Publishing a new Android release or editing settings
   adds rows/JSON values only — no destructive migration is involved.

### Verifying a deployment

```sh
curl -s https://your-site.example/api/healthz          # {"status":"ok"}
curl -s https://your-site.example/api/site             # settings incl. the android block
curl -sI https://your-site.example/downloads/yousivar-omega-android.apk
curl -s -o /dev/null -w '%{http_code}\n' https://your-site.example/            # 200
curl -s -o /dev/null -w '%{http_code}\n' https://your-site.example/api/admin/summary # 401
```

The last check matters: an anonymous request to an admin route must be **401** —
never 403 (a broken origin guard) and never 500 (missing Clerk keys).

## 5. Deploying the Android side

The shell loads the deployed origin, so an Android release follows the website:

1. Set the `YOUSIVAR_APP_URL` repository variable (or the workflow input) to the
   deployed origin.
2. Build and tag as described in `APK_RELEASE.md`; the workflow produces the
   signed APK.
3. Paste the release asset URL, size and checksum into the console's
   **Android release** page and switch the download on.

No APK rebuild is needed for content, branding, theme or catalog changes — those
arrive through the API. Only packaged code (icon, app name, permissions,
Capacitor version, shell screens) requires a new release.

## 6. Rolling back

| What broke | How to roll back |
| --- | --- |
| A web deployment | Redeploy the previous build. The database schema is additive; nothing in this repository's changes requires a destructive revert. |
| Android download | Console → **Android release** → switch *Offer the download publicly* off, or restore the previous URL/size/checksum. Instantly effective. |
| A bad Android binary | Publish a new, higher `versionCode`. A shipped APK cannot be rewritten; installed copies stay as they are. |
| Owner lockout / auth misconfiguration | The API is the authority; fix the owner variables and mail provider, then redeploy. Sessions are stored server-side and can be revoked by clearing the relevant database rows or restarting the API. |

## 7. What still requires external services or manual configuration

- A production host for the website (and its https origin) — none exists yet.
- Production Clerk instance keys, or the owner variables and a mail provider for
  the Ω flow to work end to end.
- Android signing secrets in CI (see `APK_RELEASE.md`) for any signed release.
- A public host for the release APK if you do not use GitHub Releases.
- Play Store distribution: a Play Console account, an `.aab`, listing assets and
  a privacy policy — a distribution decision, not a prerequisite for the APK
  download on the website.

## 8. Cloudflare Pages build failure root cause

The Cloudflare Pages build fails when the frontend build runs without the
required env values for `vite.config.ts`. The app explicitly throws if `PORT` or
`BASE_PATH` are not provided before the Vite configuration is loaded. In a
Cloudflare Pages build, those values are unset unless they are supplied by the
project environment, so the build stops before the static app can be emitted.

The fix is to provide the values in the Cloudflare Pages build environment:

```sh
PORT=4173
BASE_PATH=/
```

and keep the remaining app env vars in the platform secret store rather than in
Git. The Cloudflare Pages deployment itself should still proxy `/api/*` to the
real Express backend origin, while keeping a single same-origin browser/API
experience.
