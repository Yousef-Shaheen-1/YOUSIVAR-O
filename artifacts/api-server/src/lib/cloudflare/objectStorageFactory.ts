/**
 * Picks the object-storage driver for the current runtime.
 *
 * `OBJECT_STORAGE_DRIVER=r2` (set by the Workers config) → Cloudflare R2 through
 * the `MEDIA_BUCKET` binding. Anything else keeps the Replit/Google Cloud
 * Storage driver the project has always used, so development, the sandbox and
 * self-hosted Node deployments are unaffected.
 *
 * Routes must call this instead of constructing a backend directly.
 */

import type { ObjectStorageBackend } from "./objectStorageBackend";
import { R2ObjectStorageService } from "./r2ObjectStorage";
import { ObjectStorageService } from "../objectStorage";

export function createObjectStorageService(): ObjectStorageBackend {
  return process.env.OBJECT_STORAGE_DRIVER === "r2"
    ? new R2ObjectStorageService()
    : new ObjectStorageService();
}
