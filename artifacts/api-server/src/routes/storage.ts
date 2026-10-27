import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import { Router, type IRouter, type Request, type Response } from 'express';
import { getAuth } from '@clerk/express';

import { ObjectPermission } from '../lib/objectAcl';
import { ObjectNotFoundError } from '../lib/objectStorage';
import { createObjectStorageService } from '../lib/cloudflare/objectStorageFactory';
import { requirePermission } from '../middlewares/auth';

const router: IRouter = Router();
const objectStorageService = createObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires auth middleware so public callers cannot mint write-capable URLs.
 */
router.post(
  '/storage/uploads/request-url',
  requirePermission('media:write'),
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;

      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath =
        objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * Reads an upload body as bytes.
 *
 * `express.json()` runs before the routes and consumes the stream for JSON
 * payloads, so a parsed body is re-serialized; media uploads carry their own
 * content type (image/png, video/mp4, ...), which that parser ignores, and are
 * streamed as they arrive.
 */
async function readUploadBody(req: Request): Promise<Uint8Array> {
  const parsed = (req as Request & { body?: unknown }).body;
  if (parsed !== undefined && !Buffer.isBuffer(parsed)) {
    return Buffer.from(JSON.stringify(parsed), 'utf8');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

/**
 * PUT /storage/objects/*
 *
 * Receives the bytes for the URL handed out by /storage/uploads/request-url when
 * the configured backend cannot issue a presigned URL — Cloudflare R2 does not
 * (see lib/cloudflare/r2ObjectStorage.ts). The browser PUTs the file back to this
 * same origin, so the session cookie, the same-origin write guard and this
 * permission check all still apply.
 *
 * Backends that presign uploads (the Replit/GCS driver) do not implement
 * receiveUpload and answer 501 here, which is what keeps development unchanged.
 */
router.put(
  '/storage/objects/*path',
  requirePermission('media:write'),
  async (req: Request, res: Response) => {
    const storage = createObjectStorageService();
    if (!storage.receiveUpload) {
      res.status(501).json({
        error:
          'Direct uploads are not supported by the configured object storage backend',
      });
      return;
    }

    const raw = req.params.path;
    const objectId = Array.isArray(raw) ? raw.join('/') : raw;
    try {
      const body = await readUploadBody(req);
      const objectPath = await storage.receiveUpload(
        objectId,
        body,
        req.get('content-type') ?? 'application/octet-stream',
      );
      res.status(200).json({ objectPath });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }
      req.log.error({ err: error }, 'Error storing uploaded object');
      res.status(500).json({ error: 'Failed to store uploaded object' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * These are served from a separate path from /public-objects and can optionally
 * be protected with authentication or ACL checks based on the use case.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);
    const userId = getAuth(req).userId ?? undefined;
    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(userId ? 403 : 401).json({ error: 'Forbidden' });
      return;
    }

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;
