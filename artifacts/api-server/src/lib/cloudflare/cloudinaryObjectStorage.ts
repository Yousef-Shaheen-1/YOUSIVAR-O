import { createHash, randomUUID } from "node:crypto";
import {
  isPolicyAllowed,
  ObjectPermission,
  type ObjectAclPolicy,
} from "../objectAcl";
import {
  ObjectNotFoundError,
  type ObjectHandle,
  type ObjectStorageBackend,
} from "./objectStorageBackend";

const MARKER = "/objects/";
const UPLOAD_MARKER = "/api/storage/objects/";
const ROOT = "yousivar-omega";

type CloudinaryHandle = {
  publicId: string;
  resourceType: string;
  format: string;
  size: number;
  contentType: string;
  aclPolicy: ObjectAclPolicy | null;
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function signature(params: Record<string, string>): string {
  const payload = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1")
    .update(payload + required("CLOUDINARY_API_SECRET"))
    .digest("hex");
}

function safeId(id: string): boolean {
  return !!id && !id.includes("..") && !id.includes("\\") &&
    !id.startsWith("/") && !id.endsWith("/");
}

function decodePolicy(value?: string): ObjectAclPolicy | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ObjectAclPolicy;
    return parsed && typeof parsed.owner === "string" ? parsed : null;
  } catch {
    return null;
  }
}

async function cloudinaryRequest(
  path: string,
  params: Record<string, string>,
): Promise<any> {
  const form = new FormData();
  for (const [key, value] of Object.entries(params)) form.append(key, value);
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${required("CLOUDINARY_CLOUD_NAME")}/${path}`,
    { method: "POST", body: form },
  );
  const result = await response.json() as any;
  if (!response.ok) {
    throw new Error(result?.error?.message ?? "Cloudinary request failed");
  }
  return result;
}

export class CloudinaryObjectStorageService implements ObjectStorageBackend {
  private readonly cloud = required("CLOUDINARY_CLOUD_NAME");

  async getObjectEntityUploadURL(): Promise<string> {
    return `${UPLOAD_MARKER}uploads/${randomUUID()}`;
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath) return rawPath;
    let path = rawPath;
    if (/^https?:\/\//i.test(path)) {
      try { path = new URL(path).pathname; } catch { return rawPath; }
    }
    if (path.startsWith(MARKER)) return path;
    const index = path.indexOf(UPLOAD_MARKER);
    if (index < 0) return rawPath;
    const id = path.slice(index + UPLOAD_MARKER.length);
    return safeId(id) ? `${MARKER}${id}` : rawPath;
  }

  private publicId(path: string): string {
    if (!path.startsWith(MARKER)) throw new ObjectNotFoundError();
    const id = path.slice(MARKER.length);
    if (!safeId(id)) throw new ObjectNotFoundError();
    return `${ROOT}/${id}`;
  }

  async receiveUpload(
    objectId: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<string> {
    if (!safeId(objectId) || body.byteLength > 50 * 1024 * 1024) {
      throw new ObjectNotFoundError();
    }
    const resourceType =
      contentType.startsWith("video/") || contentType.startsWith("audio/")
        ? "video"
        : "image";
    const params: Record<string, string> = {
      public_id: `${ROOT}/${objectId}`,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "authenticated",
      overwrite: "true",
      resource_type: resourceType,
      context: "acl_policy=",
    };
    params.signature = signature({
      public_id: params.public_id,
      timestamp: params.timestamp,
      type: params.type,
      overwrite: params.overwrite,
      context: params.context,
    });
    params.api_key = required("CLOUDINARY_API_KEY");

    const form = new FormData();
    form.append("file", new Blob([body], { type: contentType }));
    for (const [key, value] of Object.entries(params)) {
      form.append(key, value);
    }
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloud}/${resourceType}/upload`,
      { method: "POST", body: form },
    );
    const result = await response.json() as any;
    if (!response.ok) {
      throw new Error(result?.error?.message ?? "Cloudinary upload failed");
    }
    return `${MARKER}${objectId}`;
  }

  async getObjectEntityFile(path: string): Promise<ObjectHandle> {
    const publicId = this.publicId(path);
    const resourceType = "image";
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = {
      public_id: publicId,
      timestamp,
    };
    const sig = signature(params);
    const url = new URL(
      `https://api.cloudinary.com/v1_1/${this.cloud}/resources/${resourceType}/upload/${encodeURIComponent(publicId)}`,
    );
    url.searchParams.set("api_key", required("CLOUDINARY_API_KEY"));
    url.searchParams.set("timestamp", timestamp);
    url.searchParams.set("signature", sig);

    let response = await fetch(url);
    let result = await response.json() as any;

    if (!response.ok) {
      const videoUrl = new URL(
        `https://api.cloudinary.com/v1_1/${this.cloud}/resources/video/upload/${encodeURIComponent(publicId)}`,
      );
      videoUrl.searchParams.set("api_key", required("CLOUDINARY_API_KEY"));
      videoUrl.searchParams.set("timestamp", timestamp);
      videoUrl.searchParams.set("signature", sig);
      response = await fetch(videoUrl);
      result = await response.json() as any;
    }

    if (!response.ok) throw new ObjectNotFoundError();

    return {
      publicId,
      resourceType: result.resource_type,
      format: result.format,
      size: result.bytes,
      contentType: result.resource_type === "image"
        ? `image/${result.format}`
        : `${result.resource_type}/${result.format}`,
      aclPolicy: decodePolicy(result.context?.custom?.acl_policy),
    } satisfies CloudinaryHandle;
  }

  async searchPublicObject(filePath: string): Promise<ObjectHandle | null> {
    return null;
  }

  async downloadObject(file: ObjectHandle): Promise<Response> {
    const handle = file as CloudinaryHandle;
    const timestamp = String(Math.floor(Date.now() / 1000));
    const params = {
      public_id: handle.publicId,
      timestamp,
      type: "authenticated",
    };
    const sig = signature(params);
    const url = `https://api.cloudinary.com/v1_1/${this.cloud}/${handle.resourceType}/authenticated/${handle.publicId}.${handle.format}?api_key=${required("CLOUDINARY_API_KEY")}&timestamp=${timestamp}&signature=${sig}`;
    const response = await fetch(url);
    if (!response.ok) throw new ObjectNotFoundError();
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type": handle.contentType,
        "Cache-Control": "private, no-store",
        "Content-Length": String(handle.size),
      },
    });
  }

  async readObjectMetadata(file: ObjectHandle) {
    const handle = file as CloudinaryHandle;
    return { size: handle.size, contentType: handle.contentType };
  }

  async readObjectBytes(file: ObjectHandle): Promise<Buffer> {
    const response = await this.downloadObject(file);
    return Buffer.from(await response.arrayBuffer());
  }

  async writeObjectBytes(
    file: ObjectHandle,
    bytes: Buffer,
    contentType: string,
  ): Promise<void> {
    const handle = file as CloudinaryHandle;
    const params: Record<string, string> = {
      public_id: handle.publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      type: "authenticated",
      overwrite: "true",
    };
    params.signature = signature(params);
    params.api_key = required("CLOUDINARY_API_KEY");
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }));
    for (const [key, value] of Object.entries(params)) form.append(key, value);
    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloud}/${handle.resourceType}/upload`,
      { method: "POST", body: form },
    );
    if (!response.ok) throw new Error("Cloudinary overwrite failed");
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    const handle = await this.getObjectEntityFile(normalized) as CloudinaryHandle;
    const context = `acl_policy=${JSON.stringify(aclPolicy)}`;
    const params = {
      public_id: handle.publicId,
      timestamp: String(Math.floor(Date.now() / 1000)),
      context,
    };
    const signed = {
      ...params,
      signature: signature(params),
      api_key: required("CLOUDINARY_API_KEY"),
    };
    await cloudinaryRequest(`${handle.resourceType}/explicit`, signed);
    return normalized;
  }

  async canAccessObjectEntity(args: {
    userId?: string;
    objectFile: ObjectHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    const handle = args.objectFile as CloudinaryHandle;
    return isPolicyAllowed({
      userId: args.userId,
      aclPolicy: handle.aclPolicy,
      requestedPermission: args.requestedPermission ?? ObjectPermission.READ,
    });
  }
}
