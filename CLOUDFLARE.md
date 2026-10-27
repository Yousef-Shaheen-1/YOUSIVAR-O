# YOUSIVAR–Ω on Cloudflare

How this repository deploys to Cloudflare, what every setting is, and how to move
off it again safely.

Nothing here changes how the app behaves: the same Express API, the same React
site, the same Clerk sign-in, the same Ω owner flow, the same Postgres schema and
the same admin console. Development (`docker compose -f docker-compose.base44.yml
up -d`) and self-hosted Node deployments are untouched — every Cloudflare-specific
path is switched on by configuration, not by a fork of the code.

---

## 1. Architecture

| Piece           | Cloudflare product           | Runtime code                                                     |
| --------------- | ---------------------------- | ---------------------------------------------------------------- |
| Web client      | **Pages** (static)           | `artifacts/yousivar-omega` — unchanged Vite/React build            |
| API             | **Worker**                   | `artifacts/api-server/src/worker.ts` → the existing Express app    |
| Database        | **Hyperdrive** → PostgreSQL  | `lib/db` (Drizzle + `pg`) — unchanged                              |
| Media / uploads | **R2**                       | `src/lib/cloudflare/r2ObjectStorage.ts` (new driver, same routes)  |
| Email (Ω codes) | Resend API over HTTPS         | `src/lib/email.ts` — unchanged Resend transport                    |
| Android APK     | Pages static asset + Function | `public/downloads/*.apk`, `functions/downloads/[file].ts`          |

The site and the API share **one origin**: Pages serves the site, and a Worker
*route* on the same hostname (`example.com/api/*`) sends API traffic to the
Worker. That is mandatory, not cosmetic — the owner session cookie is `HttpOnly`
and same-origin, Clerk's session behaves the same way, and
`artifacts/api-server/src/app.ts` rejects state-changing requests whose `Origin`
is not the host it is serving. Never move the API to a different domain or a
`workers.dev` hostname.

### Why Express runs unchanged on Workers

Cloudflare Workers implement the `node:http` **server** API, so an Express app can
be served directly (`cloudflare:node` → `handleAsNodeRequest`). `src/worker.ts`
mounts `src/app.ts` on an in-memory server and bridges every request to it, which
is why **every endpoint, middleware and behaviour is preserved** rather than
reimplemented. `cloudflare:node` has no published types, so
`src/cloudflare-node.d.ts` declares it.

### Why Postgres + Hyperdrive and not D1

Decision: **keep PostgreSQL behind Hyperdrive.** The schema
(`lib/db/src/schema/yousivar.ts`) is Postgres-specific — `pgTable`, sequences,
`jsonb`, enum-like text columns, `timestamptz` — and the application uses
transactional Drizzle queries throughout. D1 is SQLite with a different Drizzle
driver (`drizzle-orm/d1`), no Postgres type compatibility and different
concurrency semantics; migrating would mean rewriting the schema, the queries and
every id/default, i.e. a data migration the requirement explicitly forbids running
destructively. Hyperdrive keeps the schema, the migrations and the queries as they
are, and adds connection pooling/caching in front of the existing database.

Hyperdrive works with the driver that is already installed: `drizzle-orm/node-postgres`
over `pg` (Cloudflare's own recommended pairing). `src/lib/cloudflare/bindings.ts`
copies `env.HYPERDRIVE.connectionString` into `process.env.DATABASE_URL` before the
application is imported, so `lib/db/src/index.ts` is unchanged.

---

## 2. Files added for Cloudflare

```
artifacts/api-server/wrangler.jsonc                     Worker config: bindings, compat flags, routes
artifacts/api-server/src/worker.ts                      Worker entry point (bridges to the Express app)
artifacts/api-server/src/cloudflare-node.d.ts           Types for cloudflare:node
artifacts/api-server/src/lib/cloudflare/bindings.ts     Hyperdrive/R2 → process.env bridge
artifacts/api-server/src/lib/cloudflare/objectStorageBackend.ts  Driver interface + ObjectNotFoundError
artifacts/api-server/src/lib/cloudflare/r2ObjectStorage.ts       R2 driver
artifacts/api-server/src/lib/cloudflare/objectStorageFactory.ts  Picks the driver
artifacts/api-server/src/lib/cloudflare/gcsSdkStub.ts   Keeps the Node-only GCS SDK out of the bundle
artifacts/yousivar-omega/wrangler.jsonc                 Pages project config
artifacts/yousivar-omega/public/_redirects              SPA deep-link fallback
artifacts/yousivar-omega/public/_headers                Caching + APK content type
artifacts/yousivar-omega/public/_routes.json            Scopes the APK Function to /downloads/*
artifacts/yousivar-omega/functions/downloads/[file].ts  Guarantees the Android package content type
```

Edits to existing files are deliberately small and additive:

| File                                     | Change                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `src/lib/logger.ts`                      | Log to `process.stdout` inside a Worker (no `fs`, no worker threads)     |
| `src/lib/email.ts`                       | Say plainly that SMTP is impossible on Workers instead of failing oddly |
| `src/middlewares/clerkProxyMiddleware.ts`| Skip the in-process Clerk proxy on Workers (see §7)                     |
| `src/lib/objectAcl.ts`                   | Extracted `isPolicyAllowed` so both drivers evaluate ACLs identically   |
| `src/lib/objectStorage.ts`               | Implements the driver interface; re-exports the shared not-found error  |
| `src/routes/{storage,media,content}.ts`, `src/lib/yousivar.ts` | Use `createObjectStorageService()` instead of `new ObjectStorageService()` |
| `src/routes/storage.ts`                  | Added `PUT /api/storage/objects/*` (R2 direct upload, see §6)           |

---

## 3. Bindings

| Binding          | Type              | Wrangler key   | Purpose                                    |
| ---------------- | ----------------- | -------------- | ------------------------------------------ |
| `HYPERDRIVE`     | Hyperdrive config | `hyperdrive`   | Postgres connection string for `lib/db`     |
| `MEDIA_BUCKET`   | R2 bucket         | `r2_buckets`   | Media, uploads and object access policies   |

Both are declared in `artifacts/api-server/wrangler.jsonc`. The file ships the
placeholder ids `REPLACE_WITH_HYPERDRIVE_ID` and the bucket name
`yousivar-omega-media` — replace them in §5 before deploying. Plain (non-secret)
runtime values live in that file's `vars` block: `CLOUDFLARE_WORKER=1`,
`OBJECT_STORAGE_DRIVER=r2`, `LOG_LEVEL`.

`CLOUDFLARE_WORKER=1` is a *runtime marker*, read by the API to switch the
Worker-only paths (stdout logging, mail transport, storage driver, Clerk proxy).
It is set for `wrangler dev` and `wrangler deploy` and unset everywhere else, so
Node keeps its original behaviour.

---

## 4. Environment variables and secrets

Set every secret with `wrangler secret put <NAME>` **inside
`artifacts/api-server`** (or in the dashboard: Worker → Settings → Variables and
Secrets → add as *secret*). Never commit a value.

### Required at boot

| Name                  | Notes                                                                      |
| --------------------- | -------------------------------------------------------------------------- |
| `CLERK_SECRET_KEY`    | `sk_…` from the Clerk instance. Without it **every** request 500s.          |
| `CLERK_PUBLISHABLE_KEY`| `pk_…` from the same instance — the server derives the frontend API from it. |

### Required for Clerk sign-in in the browser

| Name                         | Notes                                                                       |
| ---------------------------- | --------------------------------------------------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Set as a **Pages build-time variable**, not a Worker secret — Vite bakes it into the bundle. Must be the same instance as the keys above. |

### Owner access (Ω flow) and email

| Name                  | Notes                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------- |
| `OWNER_EMAIL`         | Verified primary email of the owner's Clerk account; the only address that can start the Ω flow. |
| `OWNER_USERNAME`      | Owner account username checked server-side.                                            |
| `OWNER_PASSWORD`      | Owner password (or supply `OWNER_PASSWORD_HASH`, a scrypt hash, instead of both).       |
| `RESEND_API_KEY`      | **Required on Cloudflare.** Verification codes are emailed; SMTP cannot run on Workers. |
| `MAIL_FROM`           | Optional sender, e.g. `YOUSIVAR-OMEGA <no-reply@yourdomain>`.                          |

SMTP variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`) remain
supported for Node deployments but are ignored on Workers — see §7.

### Media / object storage

| Name                         | Example            | Notes                                                                 |
| ---------------------------- | ------------------ | --------------------------------------------------------------------- |
| `PRIVATE_OBJECT_DIR`         | `/media/private`   | R2 key prefix for private objects. Leading segment is a label only.     |
| `PUBLIC_OBJECT_SEARCH_PATHS` | `/media/public`    | Comma-separated R2 key prefixes for public objects.                     |

These are ordinary Worker variables (not secrets) — no R2 credentials are needed
at all, because uploads and downloads go through the bucket binding.

### Optional AI providers (admin console)

`OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_API_KEY` — only the
ones you use.

### Owner-flow tuning (defaults are fine)

`OWNER_OTP_TTL_SECONDS=600`, `OWNER_OTP_MAX_ATTEMPTS=5`,
`OWNER_OTP_RESEND_COOLDOWN_SECONDS=45`, `OWNER_OTP_MAX_SENDS=5`,
`OWNER_CHALLENGE_TTL_SECONDS=900`, `OWNER_SESSION_SECONDS=43200`.

---

## 5. Cloudflare dashboard settings and deploy commands

### 5.1 Order of operations

```sh
# 0. Credentials for wrangler (never commit these)
npx wrangler@4 login

# 1. Hyperdrive → your Postgres
npx wrangler@4 hyperdrive create yousivar-omega-db \
  --connection-string="postgres://user:password@host:5432/database"
#    → copy the printed id into artifacts/api-server/wrangler.jsonc

# 2. R2 bucket for media
npx wrangler@4 r2 bucket create yousivar-omega-media

# 3. Apply the schema to Postgres (runs from your machine/CI, never from the
#    Worker) — see §6 before running this against production data
cd lib/db && DATABASE_URL="postgres://…" npx drizzle-kit push

# 4. API secrets (repeat for each name in §4)
cd ../../artifacts/api-server
npx wrangler@4 secret put CLERK_SECRET_KEY
npx wrangler@4 secret put CLERK_PUBLISHABLE_KEY
npx wrangler@4 secret put OWNER_EMAIL
npx wrangler@4 secret put OWNER_USERNAME
npx wrangler@4 secret put OWNER_PASSWORD
npx wrangler@4 secret put RESEND_API_KEY

# 5. Media prefixes
npx wrangler@4 secret put …   # (or Variables) PRIVATE_OBJECT_DIR, PUBLIC_OBJECT_SEARCH_PATHS

# 6. Deploy the API Worker
pnpm --filter @workspace/api-server run cf:deploy

# 7. Deploy the site to Pages
pnpm --filter @workspace/yousivar-omega run build
cd ../yousivar-omega && npx wrangler@4 pages deploy
```

`pnpm run cf:dry-run` (in `artifacts/api-server`) bundles the Worker and prints
the bindings it resolved without deploying — use it before every deploy.

### 5.2 Worker routing (required)

Add the API route to the site's hostname, either by uncommenting `routes` in
`artifacts/api-server/wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "example.com/api/*", "zone_name": "example.com" }]
```

or in the dashboard: **Workers & Pages → yousivar-omega-api → Settings →
Domains & Routes → Add route** → `example.com/api/*`.

Do **not** point the site at a `*.workers.dev` hostname: that would split the
origin and break the owner session cookie and the API's same-origin write guard.

### 5.3 Pages project

| Setting                | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Project name           | `yousivar-omega` (must match `name` in `artifacts/yousivar-omega/wrangler.jsonc`) |
| Root directory         | repository root (the monorepo root, so pnpm workspaces resolve)     |
| Build command          | `pnpm install && PORT=3000 BASE_PATH=/ pnpm --filter @workspace/yousivar-omega run build` |
| Build output directory | `artifacts/yousivar-omega/dist/public`                              |
| Build variable         | `VITE_CLERK_PUBLISHABLE_KEY` = the same `pk_…` as the Worker        |
| Compatibility flags    | `nodejs_compat` (already in `wrangler.jsonc`)                      |
| Custom domain          | your site hostname (the same zone the API route sits on)            |

`PORT` and `BASE_PATH` are required by `artifacts/yousivar-omega/vite.config.ts`
and must be set for any build, including in CI.

### 5.4 DNS for Clerk

The app can proxy Clerk's Frontend API through its own domain, which needs no DNS
work on Node — on Cloudflare it is a DNS record instead:

1. Add a CNAME: `clerk` → `frontend-api.clerk.dev` (proxied **off**).
2. Register `https://clerk.example.com` as the Clerk Frontend API URL in the
   Clerk dashboard.
3. Set the Pages build variable `VITE_CLERK_PROXY_URL=https://clerk.example.com`.

Leave `VITE_CLERK_PROXY_URL` unset to load Clerk JS from the instance's own
Frontend API host instead — sign-in still works; only the custom domain is lost.

---

## 6. Database migrations, cutover and rollback

Hyperdrive connects to the database you already have: there is **no data
migration and no schema conversion**. Two paths are possible.

### Path A — move the database host (recommended, reversible)

The application never sees the difference; only the connection string changes.

1. **Back up.** `pg_dump --format=custom --no-owner --no-privileges "$OLD_URL" > yousivar-$(date +%F).dump`
2. **Restore** into the Cloudflare-reachable Postgres:
   `pg_restore --no-owner --no-privileges --dbname "$NEW_URL" yousivar-<date>.dump`
3. **Verify** row counts and the newest rows on both sides
   (`yousivar_content_items`, `yousivar_site_records`, `yousivar_owner_sessions`).
4. **Point Hyperdrive at the new database**, apply any pending schema change with
   `drizzle-kit push` (it is additive for the current schema), deploy and smoke-test.
5. **Keep the old database read-only** for at least one release cycle.

### Path B — keep the existing database

Create the Hyperdrive configuration against the current host (the requirement is
only that it is reachable over the public internet with TLS, typically your
provider's pooler or a Cloudflare Tunnel). Nothing is copied and rollback is
"delete the Worker".

### Rollback

| Situation                                    | Rollback                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Worker behaves incorrectly                   | `wrangler rollback --name yousivar-omega-api` (previous deployment, seconds) or `wrangler deployments list` → `wrangler rollback <id>` |
| Pages release is bad                         | Redeploy the previous build, or roll back the Pages deployment in the dashboard (Deployments → … → Rollback) |
| Database host must go back                   | Point Hyperdrive at the previous database (`wrangler hyperdrive update`) — the app follows the binding, no code change |
| Media objects need to move back              | Objects are plain files under the R2 prefixes in §4; copy them to the old bucket with `rclone`/`aws s3 cp` and reset `OBJECT_STORAGE_DRIVER` |
| Everything must leave Cloudflare             | Delete the Worker route and the Pages project; `docker compose -f docker-compose.base44.yml up -d` (or the existing Node deployment) still runs the identical code |

Nothing in this migration is destructive: it adds configuration and one storage
driver, and it never deletes rows, buckets or the existing deployment.

---

## 7. Runtime limitations on Workers, and the choice made for each

Every item below is a runtime limitation with a documented alternative, not a
silent behaviour change.

1. **SMTP cannot run on Workers.** The owner-code mailer's SMTP transport opens a
   raw TCP/TLS socket (`node:net`, `node:tls`), and Workers have no direct TCP
   egress — all networking goes through managed services. Only the Resend HTTP
   transport works. `emailReadiness()` now reports this explicitly (and the Ω
   modal shows it) instead of claiming a code was sent. **Set
   `RESEND_API_KEY`.** SMTP stays supported for Node deployments.
2. **The in-process Clerk proxy cannot run on Workers.** `http-proxy-middleware`
   needs a proxy socket; on Cloudflare the equivalent is the `clerk.<domain>`
   CNAME plus `VITE_CLERK_PROXY_URL` (§5.4), which is how Clerk documents proxying
   on Cloudflare. The middleware is skipped when `CLOUDFLARE_WORKER=1`, so the
   behaviour is explicit rather than a failing request path.
3. **Replit Object Storage cannot run on Workers.** `@google-cloud/storage` plus a
   signing sidecar on `127.0.0.1:1106` exist only in the Replit environment.
   Replaced by R2 through the bucket binding (§6 and §8). The GCS SDK is aliased to
   `gcsSdkStub.ts` so the Worker bundles and any accidental use explains itself.
4. **No arbitrary filesystem access.** Nothing in the API writes files; logs go to
   `process.stdout`, which Workers support. The logger still writes to stdout under
   Node, so nothing is lost in development.
5. **Worker bundle size.** 4.1 MiB (≈812 KiB gzipped) because the whole Express
   app and its middleware ship in one Worker. Comfortably inside the paid plan
   limit; the free plan's 3 MiB script limit may reject it, so deploy on a paid
   plan or trim dependencies (the pino transports are the largest removable part).
6. **Workerd's local run needs a binary download.** `pnpm` skips `workerd`'s
   postinstall in this workspace (`onlyBuiltDependencies` in `pnpm-workspace.yaml`),
   so `pnpm --filter @workspace/api-server run cf:dev` is unavailable until you run
   `pnpm approve-builds` (or add `workerd` to `onlyBuiltDependencies`). Use
   `cf:dry-run` to validate the bundle without it. Local `wrangler dev` also cannot
   exercise Hyperdrive (use a plain `DATABASE_URL` variable locally).

---

## 8. File uploads on Cloudflare (R2)

The client contract is unchanged: the browser asks
`POST /api/storage/uploads/request-url` for an upload URL, then `PUT`s the file to
it.

* **Node / Replit driver** — the API returns a presigned Google Cloud Storage URL
  (unchanged).
* **Cloudflare driver** — R2 has no presigning in the binding, and adding S3 access
  keys would mean an extra secret and a second authorisation path. Instead the API
  returns `<same origin>/api/storage/objects/uploads/<uuid>` and the browser PUTs
  the file back to the API; `PUT /api/storage/objects/*` writes it to R2 through
  `MEDIA_BUCKET` after the same `media:write` permission check. Because it is the
  same origin, the session cookie and the same-origin write guard both still apply,
  and no R2 credentials exist anywhere.

Downloads (`GET /api/storage/objects/*`, `GET /api/storage/public-objects/*`) and
the visibility/ACL flows are unchanged; access policies are stored as R2 object
custom metadata (`acl-policy`, base64 JSON) exactly as the GCS driver stores them
in object metadata.

One caveat: an upload sent with `Content-Type: application/json` is parsed into
`req.body` by `express.json()` before the route sees it, and is re-serialized. The
browser uploads media with the file's own content type, so this only affects
hand-crafted JSON uploads.

---

## 9. Verifying

```sh
# Bundle the Worker and print the bindings it resolved (no deploy, no account)
pnpm --filter @workspace/api-server run cf:dry-run

# Site build (must be run with the two required variables)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/yousivar-omega run build
ls artifacts/yousivar-omega/dist/public   # _redirects, _headers, _routes.json, downloads/

# Types
pnpm run typecheck

# Against a deployed or local instance
API_BASE_URL=https://example.com node scripts/smoke-api.mjs
curl -s https://example.com/api/healthz                  # {"status":"ok"}
curl -si -X PUT https://example.com/api/storage/objects/x | head -1   # 401 (never 500)
curl -sI https://example.com/downloads/yousivar-omega-android.apk | grep -i content-type
# must be application/vnd.android.package-archive
```

Status of this work: typecheck, both production builds, the Worker bundle
(`cf:dry-run`) and the API smoke checks were run and pass. Deploying and the live
Cloudflare paths (Hyperdrive queries, R2 round-trip, Resend delivery) were **not**
executed here — they need a Cloudflare account, credentials and a real zone, and
the first three commands in §5.1 are the cutover.
