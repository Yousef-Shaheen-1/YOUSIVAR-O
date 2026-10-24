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

## Verifying

```sh
curl -s http://localhost:3000/api/healthz          # {"status":"ok"}
curl -s http://localhost:3000/api/site             # public settings + profile
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/admin/summary
# must be 401 — never 403 (origin guard) and never 500 (missing Clerk key)
```

- Types: `pnpm run typecheck` (workspace-wide, passes).
- The repo ships no test suite. `scripts/smoke-api.mjs` only checks public
  endpoints and anonymous rejection; it does not sign in.
