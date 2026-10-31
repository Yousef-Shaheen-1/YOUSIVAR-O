import type { ObjectStorageBackend } from "./objectStorageBackend";
import { CloudinaryObjectStorageService } from "./cloudinaryObjectStorage";
import { R2ObjectStorageService } from "./r2ObjectStorage";
import { ObjectStorageService } from "../objectStorage";

export function createObjectStorageService(): ObjectStorageBackend {
  const driver = process.env.OBJECT_STORAGE_DRIVER;
  if (driver === "cloudinary") return new CloudinaryObjectStorageService();
  if (driver === "r2") return new R2ObjectStorageService();
  return new ObjectStorageService();
}
