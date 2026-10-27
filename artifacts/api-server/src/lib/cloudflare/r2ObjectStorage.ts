/**
 * Cloudflare R2 object storage for the media/uploads routes.
 *
 * Why this exists: the Replit driver signs upload URLs through a local sidecar
 * (`http://127.0.0.1:1106`) and streams through the Google Cloud Storage SDK.
 * Neither can run on Workers — there is no localhost sidecar and no GCS
 * credentials to reuse — so on Cloudflare the bucket arrives as an R2 binding
 * and the bytes take a different route:
 *
 *   upload:   POST /api/storage/uploads/request-url  (unchanged, authorised)
 *             → returns `<same origin>/api/storage/objects/uploads/<uuid>`
 *             → the browser PUTs the file back to this API
 *             → PUT /api/storage/objects/* writes it to R2 through the binding
 *   download: GET /api/storage/objects/* and /api/storage/public-objects/*
 *             (unchanged) read the object back through the binding.
 *
 * The client contract is untouched: it still asks the API for an upload URL and
 * PUTs the file to it. Doing the write through the binding — instead of S3
 * presigning — means no R2 access keys have to exist as API secrets at all.
 *
 * Access policies are stored as R2 custom metadata on the object itself, exactly
 * as the GCS driver stores them in object metadata, so `trySetObjectEntityAclPolicy`
 * and the visibility flows in the media routes keep working unchanged.
 *
 * Configuration (same shapes the GCS driver uses, so one set of secrets works for
 * either driver):
 *   PRIVATE_OBJECT_DIR          e.g. "/media/private"  → R2 key prefix "private"
 *   PUBLIC_OBJECT_SEARCH_PATHS  e.g. "/media/public"   → R2 key prefix "public"
 * The first path segment is a label only (the real bucket is the R2 binding).
 */

import { randomUUID } from "node:crypto";

import { isPolicyAllowed, ObjectPermission, type ObjectAclPolicy } from "../objectAcl";
import {
  ObjectNotFoundError,
  type ObjectHandle,
  type ObjectStorageBackend,
} from "./objectStorageBackend";

/** Marker of the API path an uploaded object is served from. */
const OBJECT_PATH_MARKER = "/objects/";
const UPLOAD_URL_MARKER = "/api/storage/objects/";
const ACL_METADATA_KEY = "acl-policy";

type R2HttpMetadata = { contentType?: string };

type R2ObjectMeta = {
  key: string;
  size: number;
  httpMetadata?: R2HttpMetadata;
  customMetadata?: Record<string, string>;
};

type R2ObjectBody = R2ObjectMeta & { body: ReadableStream<Uint8Array> };

/** The subset of the R2 bucket binding this driver uses. */
export type R2BucketLike = {
  head(key: string): Promise<R2ObjectMeta | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string | ReadableStream,
    options?: {
      httpMetadata?: R2HttpMetadata;
      customMetadata?: Record<string, string>;
    },
  ): Promise<unknown>;
};

type R2ObjectHandle = {
  key: string;
  size: number;
  contentType: string;
  customMetadata?: Record<string, string>;
  aclPolicy: ObjectAclPolicy | null;
};

let mediaBucket: R2BucketLike | null = null;

/** Called once per isolate by `applyCloudflareBindings` with `env.MEDIA_BUCKET`. */
export function setR2Bucket(bucket: unknown): void {
  mediaBucket = (bucket as R2BucketLike | null) ?? null;
}

export function getR2Bucket(): R2BucketLike | null {
  return mediaBucket;
}

export class R2ObjectStorageService implements ObjectStorageBackend {
  private bucket(): R2BucketLike {
    if (!mediaBucket) {
      throw new Error(
        "The MEDIA_BUCKET R2 binding is not available. Add an r2_buckets entry " +
          "to artifacts/api-server/wrangler.jsonc (see CLOUDFLARE.md).",
      );
    }
    return mediaBucket;
  }

  /**
   * Turns a configured path such as "/media/private" into the R2 key prefix
   * "private". The leading segment is the bucket label and is ignored: on
   * Cloudflare the bucket comes from the binding, not from the path.
   */
  private static prefix(configuredPath: string | undefined, what: string): string {
    const segments = (configuredPath ?? "")
      .trim()
      .split("/")
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      throw new Error(
        `${what} is not set. Point it at the R2 key prefix that stores the ` +
          `objects, for example "/media/private" (see CLOUDFLARE.md).`,
      );
    }
    return segments.length > 1 ? segments.slice(1).join("/") : segments[0]!;
  }

  private privatePrefix(): string {
    return R2ObjectStorageService.prefix(
      process.env.PRIVATE_OBJECT_DIR,
      "PRIVATE_OBJECT_DIR",
    );
  }

  private publicPrefixes(): string[] {
    const configured = (process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    if (configured.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS is not set. Point it at the R2 key prefixes " +
          'that hold public objects, for example "/media/public" (see CLOUDFLARE.md).',
      );
    }
    return configured.map((entry) =>
      R2ObjectStorageService.prefix(entry, "PUBLIC_OBJECT_SEARCH_PATHS"),
    );
  }

  private handleFrom(meta: R2ObjectMeta): R2ObjectHandle {
    return {
      key: meta.key,
      size: meta.size,
      contentType: meta.httpMetadata?.contentType ?? "application/octet-stream",
      customMetadata: meta.customMetadata,
      aclPolicy: decodeAclPolicy(meta.customMetadata?.[ACL_METADATA_KEY]),
    };
  }

  private keyFromObjectPath(objectPath: string): string {
    if (!objectPath.startsWith(OBJECT_PATH_MARKER)) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice(OBJECT_PATH_MARKER.length);
    if (!isSafeEntityId(entityId)) {
      throw new ObjectNotFoundError();
    }
    return `${this.privatePrefix()}/${entityId}`;
  }

  async getObjectEntityUploadURL(): Promise<string> {
    // Root-relative on purpose: the browser PUTs it back to this same origin, so
    // the request keeps the session cookie, the same-origin write guard and the
    // per-user permission check. See this file's header for the full flow.
    return `${UPLOAD_URL_MARKER}uploads/${randomUUID()}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath) return rawPath;

    let pathname = rawPath;
    if (/^https?:\/\//i.test(rawPath)) {
      try {
        pathname = new URL(rawPath).pathname;
      } catch {
        return rawPath;
      }
    }
    if (pathname.startsWith(OBJECT_PATH_MARKER)) {
      return pathname;
    }

    const index = pathname.indexOf(UPLOAD_URL_MARKER);
    if (index < 0) return rawPath;

    const entityId = pathname.slice(index + UPLOAD_URL_MARKER.length);
    return isSafeEntityId(entityId)
      ? `${OBJECT_PATH_MARKER}${entityId}`
      : rawPath;
  }

  async getObjectEntityFile(objectPath: string): Promise<ObjectHandle> {
    const key = this.keyFromObjectPath(objectPath);
    const meta = await this.bucket().head(key);
    if (!meta) {
      throw new ObjectNotFoundError();
    }
    return this.handleFrom(meta);
  }

  async searchPublicObject(filePath: string): Promise<ObjectHandle | null> {
    for (const prefix of this.publicPrefixes()) {
      const key = `${prefix}/${filePath}`.replace(/\/{2,}/g, "/");
      const meta = await this.bucket().head(key);
      if (meta) {
        return this.handleFrom(meta);
      }
    }
    return null;
  }

  async downloadObject(file: ObjectHandle, cacheTtlSec = 3600): Promise<Response> {
    const handle = file as R2ObjectHandle;
    const object = await this.bucket().get(handle.key);
    if (!object) {
      throw new ObjectNotFoundError();
    }

    const isPublic = handle.aclPolicy?.visibility === "public";
    const headers: Record<string, string> = {
      "Content-Type": handle.contentType,
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (Number.isFinite(handle.size)) {
      headers["Content-Length"] = String(handle.size);
    }

    return new Response(object.body, { status: 200, headers });
  }

  async readObjectMetadata(
    file: ObjectHandle,
  ): Promise<{ size: number; contentType: string }> {
    const handle = file as R2ObjectHandle;
    return { size: handle.size, contentType: handle.contentType };
  }

  async readObjectBytes(file: ObjectHandle): Promise<Buffer> {
    const handle = file as R2ObjectHandle;
    const object = await this.bucket().get(handle.key);
    if (!object) {
      throw new ObjectNotFoundError();
    }
    return Buffer.from(await new Response(object.body).arrayBuffer());
  }

  async writeObjectBytes(
    file: ObjectHandle,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    const handle = file as R2ObjectHandle;
    await this.bucket().put(handle.key, bytes, {
      httpMetadata: { contentType },
      // Keep whatever is already on the object (the access policy lives there).
      customMetadata: handle.customMetadata,
    });
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const bucket = this.bucket();
    const key = this.keyFromObjectPath(normalizedPath);
    const existing = await bucket.get(key);
    if (!existing) {
      throw new ObjectNotFoundError();
    }

    // R2 has no metadata-only update: rewrite the object with the same bytes and
    // the new policy.
    const body = await new Response(existing.body).arrayBuffer();
    await bucket.put(key, body, {
      httpMetadata: { contentType: existing.httpMetadata?.contentType },
      customMetadata: {
        ...existing.customMetadata,
        [ACL_METADATA_KEY]: encodeAclPolicy(aclPolicy),
      },
    });

    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: ObjectHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const handle = objectFile as R2ObjectHandle;
    return isPolicyAllowed({
      userId,
      aclPolicy: handle.aclPolicy,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /**
   * Stores the bytes of a direct upload (`PUT /api/storage/objects/*`). The
   * object starts without an access policy, exactly like the GCS flow, so it is
   * reachable only once the media flow grants visibility.
   */
  async receiveUpload(
    objectId: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<string> {
    if (!isSafeEntityId(objectId)) {
      throw new ObjectNotFoundError();
    }
    const key = `${this.privatePrefix()}/${objectId}`;
    await this.bucket().put(key, body, {
      httpMetadata: { contentType: contentType || "application/octet-stream" },
    });
    return `${OBJECT_PATH_MARKER}${objectId}`;
  }
}

function isSafeEntityId(entityId: string): boolean {
  return (
    entityId.length > 0 &&
    !entityId.includes("..") &&
    !entityId.includes("\\") &&
    !entityId.endsWith("/")
  );
}

/**
 * R2 custom metadata values must be header-safe, and the policy carries a JSON
 * document, so it is base64 encoded here.
 */
function encodeAclPolicy(aclPolicy: ObjectAclPolicy): string {
  return Buffer.from(JSON.stringify(aclPolicy), "utf8").toString("base64");
}

function decodeAclPolicy(value: string | undefined): ObjectAclPolicy | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64").toString("utf8"),
    ) as ObjectAclPolicy;
    return parsed && typeof parsed.owner === "string" ? parsed : null;
  } catch {
    return null;
  }
}
