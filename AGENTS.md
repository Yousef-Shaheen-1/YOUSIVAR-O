# YOUSIVAR–Ω — sandbox working notes

Extra context for running and changing this repo in the Base44 sandbox. Product
and architecture documentation lives in `README.md` and `replit.md`.

## Running it

```sh
docker compose -f docker-compose.base44.yml up -d
```

| service   | what it does                                                                 |
| --------- | ---------------------------------------------------------------------------- |
| `db`      | Postgres 16, data in the `yousivar-pgdata` volume                            |
| `deps`    | one-shot `pnpm install --frozen-lockfile` into the bind-mounted repo         |
| `db-push` | one-shot `drizzle-kit push --force` (the repo's documented dev schema step)   |
| `api`     | Express API on host port 8000                                                |
| `web`     | Vite dev server on host port 3000 (the preview entry point)                  |

- Everything runs from the clone: `web` is a real Vite dev server with HMR, so
  frontend edits appear immediately.
- `api` uses the repo's own dev script (esbuild rebuild + start) and has **no
  watcher**. Restart it after editing API code:
  `docker compose -f docker-compose.base44.yml restart api`.
- After changing a `package.json` or `pnpm-lock.yaml`, re-run the installer:
  `docker compose -f docker-compose.base44.yml run --rm deps`.
- pnpm exists only inside the containers (`corepack prepare pnpm@10 --activate`);
  the sandbox host has Node but no pnpm.

## Non-obvious things that will bite you

- **Single origin is mandatory.** The generated browser client
  (`lib/api-client-react`) calls relative `/api/...` paths, so `web` proxies
  `/api` to `http://api:8000` (`artifacts/yousivar-omega/vite.config.ts`, active
  only when `BASE44_PREVIEW_MODE` is exactly `1` and `API_PROXY_ORIGIN` is set).
- **The API blocks writes from other origins.** `artifacts/api-server/src/app.ts`
  rejects non-GET requests whose `Origin` host differs from the host the API
  sees. Behind the preview proxy the API only ever sees the *internal* host, so
  every write used to come back `403 {"error":"Cross-origin request rejected"}`.
  `TRUSTED_ORIGIN_HOSTS` (read only when `BASE44_PREVIEW_MODE === '1'`) carries
  the browser's public origin, which keeps the check meaningful — never put a
  wildcard or a resolved host literal there, the compose file interpolates
  `${BASE44_PUBLIC_HOST_SUFFIX}`.
- **Clerk keys are effectively required for the API to answer at all.** Without
  `CLERK_SECRET_KEY` every request — including `/api/healthz` — fails with
  `Missing Clerk Secret Key` and returns 500.
- **Use Clerk *development* instance keys** (`pk_test_…` / `sk_test_…`).
  `publishableKeyFromHost()` returns the configured key only when it is a dev
  key; otherwise it derives `pk_live_…(clerk.<hostname>)` from the request host,
  which no Clerk instance knows on the preview host — Clerk JS then fails to
  load and sign-in never becomes available. The `!clerkPubKey` fallback screen in
  `App.tsx` is therefore unreachable for any real hostname.
- **Do not set `VITE_CLERK_PROXY_URL` here.** `clerkProxyMiddleware` is a no-op
  unless `NODE_ENV === 'production'` (and Clerk's Frontend API proxy does not
  work for dev instances anyway), so `/api/__clerk/*` 404s and Clerk JS cannot be
  loaded through it. Without the variable Clerk JS loads from the instance's own
  Frontend API.
- **`OWNER_EMAIL` must match a verified primary email** in that Clerk instance.
  Until it is set, no account has owner access (there is no first-user claim).
- **Object Storage cannot work in the sandbox.** `lib/objectStorage.ts` signs
  upload URLs through a Replit-local sidecar at `127.0.0.1:1106`. The placeholder
  bucket/directory values in `.env.base44-defaults` only stop the storage routes
  from failing on missing configuration; uploads and media ACL changes will still
  fail here.
- `.env.base44-defaults` holds committed placeholders only and is listed *before*
  `/run/base44/app.env` in compose, so platform-provided secrets always win.
- `scripts/post-merge.sh` filters a package named `db`; the real name is
  `@workspace/db`.

## Android wrapper (`android/`)

- `android/` is a **separate npm project on purpose** — it is *not* in the pnpm
  workspace (`artifacts/*`, `lib/*`). Adding it under `artifacts/` would make the
  one-shot `deps` installer fail on `--frozen-lockfile`. Its dependencies are
  installed from its own committed `package-lock.json` (`cd android && npm install`).
- The Capacitor project root is `android/`; the Gradle project Capacitor generates
  lives at `android/android/`. `android/www/index.html` is the bundled offline /
  "no application URL configured" screen (`server.errorPath`), never a copy of the
  site. `YOUSIVAR_APP_URL` switches the shell to loading the deployed origin.
- The Android toolchain (JDK 21 + Android SDK 36) is **not** a compose service: it
  would bloat the preview stack. Build in a throwaway container — the full recipe
  is in `ANDROID_BUILD.md`. `android/android/local.properties` (git-ignored) holds
  `sdk.dir`; `ANDROID_SDK_ROOT`/`JAVA_HOME` are set per command.
- `cd android && npm run build:debug` syncs, builds, validates the artifact and
  writes `android/dist/debug/…` (APK + `.sha256` + `build.json`). A release build
  without signing credentials fails on purpose.
- The build offered on the public site is committed at
  `artifacts/yousivar-omega/public/downloads/yousivar-omega-android.apk` and served
  by the web dev server. `.apk` responses need
  `application/vnd.android.package-archive`: that is set by a tiny Vite plugin in
  `artifacts/yousivar-omega/vite.config.ts` (the static handler otherwise sends an
  empty content type). Rebuilding changes the file, so update
  `DEFAULT_ANDROID_RELEASE` in `artifacts/api-server/src/lib/yousivar.ts` (size +
  checksum) or edit it in the console → *Android release*.

## The Android release block in site settings

- It lives on the existing `site-settings` record (`android`), so no new endpoint
  and no migration: `GET /api/site` exposes it publicly, `PUT /api/admin/settings`
  (permission `settings:write`) writes it.
- On write the API **validates**: the download must be empty, an https URL or a
  same-site path, and must end in `.apk`; the checksum must be 64 hex characters.
  `android` is optional on write, so an older console cannot erase a published
  release — the stored value is the fallback.
- The public download section renders a button only when `downloadEnabled` is true
  **and** `apkUrl` is a real `.apk`; otherwise it states plainly that no release is
  published yet. Never make it link to a placeholder.
- `readSiteSettings()` merges defaults, so a settings row written before this
  field existed still gets the shipped release record. Restart the API after
  editing `lib/yousivar.ts` (no watcher).

## Owner access (the Ω flow)

Clicking the Ω mark in the public header opens the owner sign-in modal
(`src/components/owner-auth-modal.tsx`). Every step is decided by the API in
`artifacts/api-server/src/routes/ownerAuth.ts` — the browser is never the
authority:

| endpoint                        | what it does                                                        |
| ------------------------------- | ------------------------------------------------------------------- |
| `GET /api/owner/readiness`      | reports which pieces of owner access are configured                  |
| `POST /api/owner/session/start` | compares the submitted email with `OWNER_EMAIL`, opens a challenge   |
| `POST /api/owner/session/code`  | checks `OWNER_USERNAME` + password, then mails a one-time code       |
| `POST /api/owner/session/verify`| checks the code and issues an HttpOnly owner session cookie          |
| `GET /api/owner/session`        | the current owner session (authenticated true/false)                 |
| `POST /api/owner/session/logout`| revokes the session and clears the cookie                            |

- Requires `OWNER_USERNAME` + `OWNER_PASSWORD` (or `OWNER_PASSWORD_HASH`, a
  scrypt hash) **and** a mail provider: `RESEND_API_KEY`, or SMTP
  (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, optional
  `MAIL_FROM`). Without them the flow stops with a specific message instead of
  pretending a code was sent; `/api/owner/readiness` tells the UI which piece is
  missing, and the modal shows it as a "configuration required" banner.
- Codes are 6 digits, scrypt-hashed, single-use, expiring and throttled
  (`OWNER_OTP_TTL_SECONDS` 600 s, `OWNER_OTP_MAX_ATTEMPTS` 5,
  `OWNER_OTP_RESEND_COOLDOWN_SECONDS` 45 s, `OWNER_OTP_MAX_SENDS` 5,
  `OWNER_CHALLENGE_TTL_SECONDS` 900 s, `OWNER_SESSION_SECONDS` 43200 s).
  Challenges live in `yousivar_owner_challenges`, sessions in
  `yousivar_owner_sessions` (only a SHA-256 hash of the token is stored); the
  `db-push` service creates both tables, so they appear on the next `up`.
- `requirePermission` resolves the owner session **before** Clerk, so an owner
  session reaches the whole `/api/admin/*` surface as the OWNER role.
- **Cookie policy:** `OWNER_COOKIE_SAMESITE` / `OWNER_COOKIE_SECURE` override the
  defaults. Under `BASE44_PREVIEW_MODE=1` the session cookie is
  `SameSite=None; Secure`, because the preview iframe is a third-party context
  where a `Lax` cookie is never sent; with the flag unset it is `SameSite=Lax`.
- The Vite proxy sets `xfwd: true` (preview mode only) so the API can rate limit
  per visitor instead of per proxy address.

## Verifying

```sh
curl -s http://localhost:3000/api/healthz          # {"status":"ok"}
curl -s http://localhost:3000/api/site             # public settings + profile
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/admin/summary
# must be 401 — never 403 (origin guard) and never 500 (missing Clerk key)
```

```sh
# The Android download must be the real artifact, byte for byte:
curl -sI http://localhost:3000/downloads/yousivar-omega-android.apk   # 200 + Content-Length
curl -s  http://localhost:3000/downloads/yousivar-omega-android.apk -o /tmp/a.apk && sha256sum /tmp/a.apk
# and the served file must keep Content-Type: application/vnd.android.package-archive
```

- Types: `pnpm run typecheck` (workspace-wide, passes).
- The repo ships no test suite. `scripts/smoke-api.mjs` only checks public
  endpoints and anonymous rejection; it does not sign in.
