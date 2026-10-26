# Security policy

## Current controls

- Clerk session verification and application-role checks run in the API server.
- The configured owner is a verified Clerk primary email selected by `OWNER_EMAIL`; sign-up never grants an administrative role.
- Mutating API routes enforce same-origin checks. The API uses Helmet, bounded JSON bodies, and non-sensitive request logs.
- AI secrets are read by server code only. Provider status responses expose a boolean, never a key or key fragment.
- GitHub imports are restricted to `github.com` repository URLs and public metadata from the GitHub API.
- Uploaded objects are private until an authorized content publication makes them public. Upload completion validates declared metadata, byte limits, file signatures, and SVG markup.
- The PWA service worker excludes API routes from its cache.

## Owner access (the Ω flow)

- Every step is decided by the API (`artifacts/api-server/src/routes/ownerAuth.ts`); the browser is never the authority, and hiding a button is never treated as protection.
- Owner credentials are compared server-side against `OWNER_USERNAME` and `OWNER_PASSWORD`/`OWNER_PASSWORD_HASH` (scrypt). The password is never stored in the browser and never logged.
- Verification codes are 6 digits, hashed, single-use, expiring, attempt-limited and resend-throttled (`OWNER_OTP_*` in `AGENTS.md`).
- Sessions are HttpOnly cookies; only a SHA-256 hash of the session token is stored in `yousivar_owner_sessions`. `SameSite=Lax` normally, `SameSite=None; Secure` when the preview flag is set (a third-party iframe context).
- Admin routes resolve the owner session **before** Clerk, so an owner session reaches `/api/admin/*` as `OWNER`; every privileged route still runs through `requirePermission`, and audit entries are written for mutations.

## Android application and release integrity

- The APK is a Capacitor shell around the deployed site. It contains **no credentials**: no owner password, no SMTP or API key, no signing material — only the application id, name and the configured origin.
- The shell requests the `INTERNET` permission only, and refuses cleartext traffic (Android's default), so the origin must be https.
- Page content never gains native privileges: Capacitor's own client sends any URL whose host or scheme differs from the loaded application to the system browser, and no privileged plugin or bridge is exposed.
- Release signing keys live only in protected CI secrets (or the git-ignored `android/key.properties`). Nothing in the pipeline echoes a secret, and a tagged build fails rather than shipping an unsigned APK.
- A published download must be an https URL (or same-site path) ending in `.apk` — the API validates this, so a source archive or an HTML page can never be presented as the application — and its SHA-256 checksum is shown to visitors for verification.
- Rollback is a switch (`downloadEnabled`), so a suspected bad artifact can be withdrawn immediately without a rebuild; the published checksum is what visitors compare against.

## Reporting a vulnerability

Report security issues privately to the project owner through the Replit workspace. Do not open a public issue or include active API keys, cookies, private URLs, or user data in a report. Rotate any credential that may have been exposed before sharing the report.

## Deployment checklist

- Configure the owner’s verified Clerk email in `OWNER_EMAIL`.
- Keep Replit Secrets out of source control and browser bundles.
- Configure production database and storage independently from development.
- Review role assignments and remove unneeded accounts.
- Do not enable public AI access or private GitHub import without adding abuse controls and a documented credential flow.
