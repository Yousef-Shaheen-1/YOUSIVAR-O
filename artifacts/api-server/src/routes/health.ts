import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Liveness plus the deployment facts needed to verify a release without reading
 * a secret: which runtime is serving and which storage driver it selected. A
 * healthy answer with the wrong `storageDriver` is a misconfigured deployment,
 * which is exactly what a post-deploy check should catch.
 */
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    runtime: process.env.CLOUDFLARE_WORKER === "1" ? "cloudflare-worker" : "node",
    storageDriver: process.env.OBJECT_STORAGE_DRIVER === "r2" ? "r2" : "replit-object-storage",
  });
  res.json(data);
});

export default router;
