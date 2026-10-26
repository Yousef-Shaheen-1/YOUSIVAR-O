# The backend remains a Node/Express service; Cloudflare Pages only hosts the
# static app and proxies /api requests to the real API origin.
#
# This repo is not a native Cloudflare Workers Express project. Keep the existing
# Express code and PostgreSQL/Drizzle stack in the real backend runtime; use
# Cloudflare Pages Functions to keep the browser origin stable.
