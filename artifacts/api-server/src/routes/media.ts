import { Router, type IRouter } from "express";
import sanitizeHtml from "sanitize-html";
import { CompleteMediaUploadBody, CompleteMediaUploadResponse } from "@workspace/api-zod";
import { db, mediaAssets } from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import { ObjectStorageService } from "../lib/objectStorage";
import { writeAudit } from "../lib/yousivar";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const SVG_TAGS = [
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "title",
  "desc",
];
const SVG_ATTRIBUTES = [
  "xmlns",
  "viewBox",
  "width",
  "height",
  "fill",
  "stroke",
  "stroke-width",
  "d",
  "x",
  "y",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "transform",
  "opacity",
  "stop-color",
  "stop-opacity",
  "offset",
  "id",
  "gradientUnits",
  "gradientTransform",
  "preserveAspectRatio",
];

router.post(
  "/admin/media/complete",
  requirePermission("media:write"),
  async (req, res): Promise<void> => {
    const parsed = CompleteMediaUploadBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { objectPath, name, size, contentType } = parsed.data;
    if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(objectPath) || size > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: "Invalid uploaded object path or file size" });
      return;
    }

    try {
      const file = await storage.getObjectEntityFile(objectPath);
      const [metadata] = await file.getMetadata();
      if (Number(metadata.size) !== size || metadata.contentType !== contentType) {
        res.status(400).json({ error: "Uploaded file metadata does not match the declared file" });
        return;
      }
      const [buffer] = await file.download();
      if (buffer.byteLength !== size || !matchesFileSignature(buffer, contentType)) {
        res.status(400).json({ error: "Uploaded file signature does not match an allowed media type" });
        return;
      }

      if (contentType === "image/svg+xml") {
        const source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        if (!/<svg(?:\s|>)/i.test(source) || /<!DOCTYPE|<!ENTITY/i.test(source)) {
          res.status(400).json({ error: "SVG document is invalid or contains a disallowed declaration" });
          return;
        }
        const sanitized = sanitizeHtml(source, {
          allowedTags: SVG_TAGS,
          allowedAttributes: { "*": SVG_ATTRIBUTES },
          allowedSchemes: [],
          allowProtocolRelative: false,
          disallowedTagsMode: "discard",
        });
        if (!/<svg(?:\s|>)/i.test(sanitized)) {
          res.status(400).json({ error: "SVG sanitization removed unsafe or invalid content" });
          return;
        }
        await file.save(Buffer.from(sanitized, "utf8"), {
          resumable: false,
          contentType: "image/svg+xml",
          metadata: { contentType: "image/svg+xml" },
        });
      }

      await storage.trySetObjectEntityAclPolicy(objectPath, {
        owner: req.appIdentity!.userId,
        visibility: "private",
      });
      const safeName = name
        .replace(/[\\/]/g, "_")
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .slice(0, 255);
      const [record] = await db
        .insert(mediaAssets)
        .values({
          ownerId: req.appIdentity!.userId,
          name: safeName || "media",
          objectPath,
          contentType,
          size,
        })
        .returning();
      if (!record) {
        res.status(500).json({ error: "Media metadata could not be saved" });
        return;
      }
      await writeAudit(
        req.appIdentity!.userId,
        req.appIdentity!.email,
        "media.upload",
        safeName || objectPath,
      );
      res.status(201).json(
        CompleteMediaUploadResponse.parse({
          id: record.id,
          name: record.name,
          objectPath: record.objectPath,
          contentType: record.contentType,
          size: record.size,
          createdAt: record.createdAt,
        }),
      );
    } catch (error) {
      req.log.error({ err: error, objectPath }, "Unable to verify uploaded media");
      res.status(400).json({ error: "Uploaded media could not be verified" });
    }
  },
);

function matchesFileSignature(buffer: Buffer, contentType: string): boolean {
  const starts = (...bytes: number[]) =>
    bytes.every((byte, index) => buffer[index] === byte);
  switch (contentType) {
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/webp":
      return buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP";
    case "image/gif":
      return ["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6));
    case "image/svg+xml":
      return /<svg(?:\s|>)/i.test(buffer.toString("utf8", 0, Math.min(buffer.length, 4096)));
    case "video/mp4":
      return buffer.toString("ascii", 4, 8) === "ftyp";
    case "video/webm":
      return starts(0x1a, 0x45, 0xdf, 0xa3);
    case "audio/mpeg":
      return buffer.toString("ascii", 0, 3) === "ID3" || starts(0xff, 0xfb) || starts(0xff, 0xf3);
    case "audio/ogg":
      return buffer.toString("ascii", 0, 4) === "OggS";
    case "audio/wav":
      return buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WAVE";
    case "font/woff":
      return buffer.toString("ascii", 0, 4) === "wOFF";
    case "font/woff2":
      return buffer.toString("ascii", 0, 4) === "wOF2";
    default:
      return false;
  }
}

export default router;
