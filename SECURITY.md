# Security policy

## Current controls

- Clerk session verification and application-role checks run in the API server.
- The configured owner is a verified Clerk primary email selected by `OWNER_EMAIL`; sign-up never grants an administrative role.
- Mutating API routes enforce same-origin checks. The API uses Helmet, bounded JSON bodies, and non-sensitive request logs.
- AI secrets are read by server code only. Provider status responses expose a boolean, never a key or key fragment.
- GitHub imports are restricted to `github.com` repository URLs and public metadata from the GitHub API.
- Uploaded objects are private until an authorized content publication makes them public. Upload completion validates declared metadata, byte limits, file signatures, and SVG markup.
- The PWA service worker excludes API routes from its cache.

## Reporting a vulnerability

Report security issues privately to the project owner through the Replit workspace. Do not open a public issue or include active API keys, cookies, private URLs, or user data in a report. Rotate any credential that may have been exposed before sharing the report.

## Deployment checklist

- Configure the owner’s verified Clerk email in `OWNER_EMAIL`.
- Keep Replit Secrets out of source control and browser bundles.
- Configure production database and storage independently from development.
- Review role assignments and remove unneeded accounts.
- Do not enable public AI access or private GitHub import without adding abuse controls and a documented credential flow.
