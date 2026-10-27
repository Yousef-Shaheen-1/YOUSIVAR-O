/**
 * The object-storage surface the API routes depend on.
 *
 * Two backends implement it:
 *   - `lib/objectStorage.ts`            — Replit Object Storage (Google Cloud
 *                                        Storage SDK + local signing sidecar),
 *                                        the driver used by the dev/sandbox and
 *                                        self-hosted Node deployments.
 *   - `lib/cloudflare/r2ObjectStorage.ts` — Cloudflare R2 through the
 *                                        `MEDIA_BUCKET` binding.
 *
 * Routes must not import either implementation directly; they go through
 * `createObjectStorageService()` in `objectStorageFactory.ts`, which picks the
 * driver from `OBJECT_STORAGE_DRIVER`.
 */

import type { ObjectAclPolicy, ObjectPermission } from "../objectAcl";

/**
 * Opaque handle for one stored object. Each driver returns its own object here
 * (a GCS `File`, or an R2 head result) and only hands it back to the same
 * driver's `downloadObject` / `canAccessObjectEntity`.
 */
export type ObjectHandle = unknown;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export interface ObjectStorageBackend {
  /** A URL the browser can `PUT` the file to. */
  getObjectEntityUploadURL(): Promise<string>;

  /** Maps an upload URL / stored URL onto the canonical `/objects/...` path. */
  normalizeObjectEntityPath(rawPath: string): string;

  /** Resolves a private object, or throws `ObjectNotFoundError`. */
  getObjectEntityFile(objectPath: string): Promise<ObjectHandle>;

  /** Resolves a public object, or returns null when it does not exist. */
  searchPublicObject(filePath: string): Promise<ObjectHandle | null>;

  /** Streams an object back as a `Response` (content type, length, caching). */
  downloadObject(file: ObjectHandle, cacheTtlSec?: number): Promise<Response>;

  /**
   * Byte size and content type of a stored object. The media route compares both
   * against what the browser declared before it accepts the upload.
   */
  readObjectMetadata(
    file: ObjectHandle,
  ): Promise<{ size: number; contentType: string }>;

  /** Reads an object's bytes (media signature checks and SVG sanitization). */
  readObjectBytes(file: ObjectHandle): Promise<Buffer>;

  /** Overwrites an object's bytes, keeping its content type in step. */
  writeObjectBytes(
    file: ObjectHandle,
    bytes: Buffer,
    contentType: string,
  ): Promise<void>;

  /** Stores the access policy on the object itself. Returns the `/objects/...` path. */
  trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string>;

  /** Applies the stored access policy for a user. */
  canAccessObjectEntity(args: {
    userId?: string;
    objectFile: ObjectHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean>;

  /**
   * Optional: accept the uploaded bytes in-process, for backends that cannot
   * mint a presigned URL. Absent means "uploads happen directly against the
   * URL from getObjectEntityUploadURL()".
   */
  receiveUpload?(
    objectId: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<string>;
}
