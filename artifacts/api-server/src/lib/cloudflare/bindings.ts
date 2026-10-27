/**
 * Bridge between Cloudflare bindings and the environment variables the existing
 * API reads.
 *
 * The API was written for a Node process where everything arrives through
 * `process.env`. On Workers most settings do too (Wrangler auto-populates
 * `process.env` with the Worker's vars and secrets), but two bindings are
 * objects rather than strings and can only be read from the `fetch` handler's
 * `env` argument:
 *
 *   - `HYPERDRIVE`  → the PostgreSQL connection string the Drizzle/pg layer needs.
 *   - `MEDIA_BUCKET`→ the R2 bucket the storage routes write to.
 *
 * This module hands both to the code that expects them, without changing how the
 * app is configured under Node.
 */

import { setR2Bucket } from "./r2ObjectStorage";

export type CloudflareWorkerEnv = {
  /** Hyperdrive binding for the PostgreSQL database. */
  HYPERDRIVE?: { connectionString?: string };
  /** R2 bucket holding media/uploads. */
  MEDIA_BUCKET?: unknown;
  /** Present when the Worker is run in local development. */
  DATABASE_URL?: string;
  OBJECT_STORAGE_DRIVER?: string;
  [key: string]: unknown;
};

/**
 * True when the API is running inside a Cloudflare Worker.
 *
 * `wrangler.jsonc` sets this var for both `wrangler dev` and `wrangler deploy`
 * (see the `vars` block in `artifacts/api-server/wrangler.jsonc`). It is the
 * switch for the worker-only paths: stdout logging, the mail transport, the
 * object-storage driver and the in-process Clerk proxy.
 */
export function isCloudflareWorker(): boolean {
  return process.env.CLOUDFLARE_WORKER === "1";
}

let applied = false;

/**
 * Copies the bindings into the shape the rest of the API expects. Safe to call
 * on every request: it only fills in values that are still missing, and the
 * database pool and the bucket handle are created once per isolate.
 */
export function applyCloudflareBindings(env: CloudflareWorkerEnv): void {
  if (env.MEDIA_BUCKET) {
    setR2Bucket(env.MEDIA_BUCKET);
  }

  const hyperdrive = env.HYPERDRIVE;
  if (typeof hyperdrive?.connectionString === "string") {
    process.env.DATABASE_URL ??= hyperdrive.connectionString;
  } else if (typeof env.DATABASE_URL === "string" && env.DATABASE_URL) {
    // Local `wrangler dev` has no Hyperdrive: it talks to a plain PostgreSQL URL.
    process.env.DATABASE_URL ??= env.DATABASE_URL;
  }

  if (env.OBJECT_STORAGE_DRIVER) {
    process.env.OBJECT_STORAGE_DRIVER ??= env.OBJECT_STORAGE_DRIVER;
  }

  applied = true;
}

/** Whether the bindings have been applied at least once in this isolate. */
export function cloudflareBindingsApplied(): boolean {
  return applied;
}
