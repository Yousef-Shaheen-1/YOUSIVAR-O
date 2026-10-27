# Deployment — YOUSIVAR–Ω

The repository ships three runnable pieces: the web application
(`artifacts/yousivar-omega`), the API server (`artifacts/api-server`) and the
PostgreSQL database they share. The Android application is a shell around the
deployed web application (see [`ANDROID_BUILD.md`](ANDROID_BUILD.md)), so it is
deployed — and rolled back — together with the website.

> **Deploying to Cloudflare?** [`CLOUDFLARE.md`](CLOUDFLARE.md) covers that
> architecture (Pages + Workers + Hyperdrive + R2), every binding, secret and
> dashboard setting, the deploy commands and the migration/rollback plan. This
> file describes the Node/Replit deployment.

> **There is no production URL for this project yet.** The website is currently
> There is no production URL for this project yet. The website is currently
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
Drizzle/PostgreSQL stack, same-origin admin checks, Clerk auth, and APK asset
behavior without rewriting the application security model.

### Cloudflare page proxy behavior

The project includes a Pages Function at
`artifacts/yousivar-omega/functions/api/[[path]].ts` that forwards `/api/*` to
`API_PROXY_ORIGIN` while preserving the browser host/origin headers. This keeps
browser requests on the same origin even when the Express API itself is hosted at
another external origin.

## 2. Environment variables the deployment needs

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | API | PostgreSQL connection string |
| `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | API | Session verification; production keys when live |
| `VITE_CLERK_PUBLISHABLE_KEY` | web build | Browser-side Clerk key |
| `VITE_CLERK_PROXY_URL` | web build | `/api/__clerk` |
| `API_PROXY_ORIGIN` | Cloudflare Pages Function | Public origin for the Express API used by the Pages proxy |
| `OWNER_EMAIL` | API | The verified owner email; only that identity gets `OWNER` |
| `OWNER_USERNAME`, `OWNER_PASSWORD` (or `OWNER_PASSWORD_HASH`) | API | The Ω owner-access flow |
| `RESEND_API_KEY` **or** `SMTP_*` + `MAIL_FROM` | API | Delivers owner verification codes |
| `PORT`, `BASE_PATH` | local web build | Optional defaults for dev/preview only; Cloudflare Pages sets its own output |
| `YOUSIVAR_APP_URL` | Android build | Origin the Android shell loads |

Secrets belong in the platform secret store. Do not commit them and do not put
real secrets in browser bundles.

## 3. Cloudflare dashboard settings

Create a Cloudflare Pages project for the frontend app:

- Project name: `yousivar-omega`
- Framework preset: `Vite`
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @workspace/yousivar-omega run build`
- Build output directory: `artifacts/yousivar-omega/dist/public`
- Root directory: `.` (or leave at the repo root if the Pages project is configured
  directly against the repo; the Vite build already points at the correct artifact)
- Environment variables:
  - `VITE_CLERK_PUBLISHABLE_KEY`: set to the live Clerk publishable key
  - `VITE_CLERK_PROXY_URL`: `/api/__clerk`
  - `VITE_API_BASE_URL`: `/`
  - `API_PROXY_ORIGIN`: `https://api.example.com` (or the API hostname that the
    Pages function should proxy to)
  - `CF_PAGES`: `1`

For the Express API deployment itself (still required):

- Create a Node-compatible backend service with the repo's API runtime settings.
- Set `PORT`, `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
  `OWNER_EMAIL`, `OWNER_USERNAME`, `OWNER_PASSWORD` or `OWNER_PASSWORD_HASH`, and
  mail provider variables in that backend environment.
- Expose the API on a real hostname, e.g. `https://api.example.com`.
- Route browser `/api` requests through Cloudflare Pages and preserve the app
  `Origin`/`Host` headers so the same-origin guard passes.

### Required API host route mapping

- Browser: `https://app.example.com/api/...`
- Cloudflare Pages Function: `/api/*` -> `API_PROXY_ORIGIN` (preserves same origin)
- Express API: `https://api.example.com/api/...`

## 4. Deploying the website

The repository was created on Replit and its own artifacts are what a production
build uses. The Cloudflare-ready path is:

1. Build the web application with the correct frontend variables:
   ```sh
   pnpm install --frozen-lockfile
   pnpm --filter @workspace/yousivar-omega run build
   ```
2. Deploy the built `artifacts/yousivar-omega/dist/public` directory to Cloudflare
   Pages.
3. Set `API_PROXY_ORIGIN` to the real API origin in the Pages project.
4. Keep one public origin for the browser app and route all `/api` calls through
   the Pages function so the backend still sees the browser host as the same host.
5. Ensure `/downloads/*.apk` is served with
   `Content-Type: application/vnd.android.package-archive`.

### Verifying a deployment

```sh
curl -s https://app.example.com/api/healthz
curl -s https://app.example.com/api/site
curl -sI https://app.example.com/downloads/yousivar-omega-android.apk
curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/
curl -s -o /dev/null -w '%{http_code}\n' https://app.example.com/api/admin/summary
```

The last check matters: an anonymous request to an admin route must be `401` —
never `403` (a broken origin guard) and never `500` (missing Clerk keys).

## 5. Deploying the Android side

The shell loads the deployed origin, so an Android release follows the website:

1. Set `YOUSIVAR_APP_URL` to the live app origin.
2. Build and tag as described in `APK_RELEASE.md`; the workflow produces the
   signed APK.
3. Paste the release asset URL, size and checksum into the console's Android
   release entry and switch the download on.

No APK rebuild is needed for content, branding, theme or catalog changes — those
arrive through the API. Only packaged code (icons, app name, permissions,
Capacitor version, shell screens) requires a new release.

## 6. What still requires external services or manual configuration

- A production host for the API itself — none exists yet.
- Production Clerk keys and the owner mail provider configuration.
- Android signing secrets in CI for any signed release.
- A public host for the release APK if you do not use GitHub Releases.
- Play Store distribution: a Play Console account, an `.aab`, listing assets and
  a privacy policy — not a prerequisite for the APK download on the website.
