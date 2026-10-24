# YOUSIVAR–Ω

مركز رقمي ثنائي اللغة لعرض المشاريع والأدوات والملف التقني، مع إدارة خاصة ومحمية على الخادم.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — build and run the API server
- `pnpm --filter @workspace/yousivar-omega run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — apply the schema to the development database only
- `API_BASE_URL=https://<dev-domain> pnpm run smoke:api` — public API and anonymous-access checks
- Required managed configuration: Clerk keys, object-storage variables, `OWNER_EMAIL`, and a PostgreSQL `DATABASE_URL`. OpenAI uses the server-only `OPENAI_API_KEY` secret.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9, React 19 and Vite
- API: Express 5, Helmet and Clerk Express
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild for the API and Vite for the web artifact

## Where things live

- `artifacts/yousivar-omega/` — public site, PWA shell, admin console and design system
- `artifacts/api-server/` — Express API, Clerk proxy, permissions and object storage
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/api-client-react/` and `lib/api-zod/` — generated browser hooks and runtime schemas; do not edit generated files
- `lib/db/src/schema/yousivar.ts` — PostgreSQL schema
- `scripts/smoke-api.mjs` — public API and anonymous-access smoke checks

## Architecture decisions

- The owner is identified by a verified primary Clerk email matching `OWNER_EMAIL`; there is no first-user owner claim or browser-side role authority.
- User roles and content/settings state are stored in PostgreSQL. Role checks happen in API middleware on every protected request.
- Uploaded media stays private until a permitted publish action changes its storage ACL. API keys never enter browser responses or generated client code.
- Public GitHub import reads repository metadata only from `api.github.com`; it accepts public repositories and saves them as drafts.
- The service worker caches the static app shell only and excludes `/api/` so authenticated or private API responses are never cached offline.

## Product

Public visitors can switch between Arabic and English, browse published content and view an owner-managed profile. Approved users can manage content, profile and site settings according to their roles; the owner manages roles, AI configuration and audit history. AI chat is available in the owner console after the assistant and a provider are enabled.

## User preferences

- Treat the attached YOUSIVAR–Ω master prompt as the product and security reference.
- Do not claim an integration is active unless its secret or service configuration is present and verified.
- Never add demo content or claim a placeholder action is complete.

## Gotchas

- After editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before typechecking the workspace.
- `OWNER_EMAIL` must exactly match a verified primary email on the owner’s Clerk account (case-insensitive); until set, no account has owner access.
- Set Replit secrets and environment values through the workspace tools; do not commit `.env` files or database connection strings.
- Applying a production database schema is separate from the development `push` command; review the production database before applying changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
