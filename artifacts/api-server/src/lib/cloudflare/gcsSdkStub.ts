/**
 * Inert stand-in for `@google-cloud/storage` in the Workers bundle.
 *
 * The Replit/GCS object-storage driver is Node-only (it signs upload URLs through
 * a sidecar on 127.0.0.1 and ships a large Node SDK), and it is never selected on
 * Cloudflare — `OBJECT_STORAGE_DRIVER=r2` routes the storage routes to
 * `r2ObjectStorage.ts`. Wrangler aliases the SDK to this file so the Worker still
 * bundles, and any accidental use fails with an explanation instead of a
 * mysterious "not a function" at runtime.
 */

export type File = unknown;

export class Storage {
  constructor(..._args: unknown[]) {
    // Deliberately inert: the driver constructs this at module scope and only
    // touches it from methods that the R2 driver never calls.
  }

  bucket(_name: string): never {
    throw new Error(unsupported());
  }
}

function unsupported(): string {
  return (
    'The Replit/Google Cloud Storage backend is not available on Cloudflare ' +
    'Workers. Set OBJECT_STORAGE_DRIVER=r2 and configure the MEDIA_BUCKET ' +
    'binding (see CLOUDFLARE.md) instead of routing uploads to object storage ' +
    'provided by Replit.'
  );
}
