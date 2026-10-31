import express, { type Express } from "express";
import helmet from "helmet";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";

declare global {
  namespace Express {
    interface Request {
      log: typeof logger;
    }
  }
}
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

/**
 * Extra client-facing origin hosts trusted for the same-origin write check
 * below, comma separated.
 *
 * The Base44 preview proxy terminates TLS, so the browser sends its public
 * origin in `Origin` while this service only ever sees the internal host in
 * `Host`. Trusting the configured preview origin keeps the check meaningful
 * (every other origin is still rejected) without disabling it.
 *
 * Only honoured when BASE44_PREVIEW_MODE is exactly "1"; unset or any other
 * value keeps the original same-origin-only behaviour.
 */
const previewOriginHosts =
  process.env.BASE44_PREVIEW_MODE === "1"
    ? (process.env.TRUSTED_ORIGIN_HOSTS ?? "")
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length > 0)
    : [];

const app: Express = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  const requestLogger = logger.child({
    method: req.method,
    url: req.originalUrl.split("?")[0],
  });

  req.log = requestLogger;

  const startedAt = Date.now();

  res.on("finish", () => {
    requestLogger.info(
      {
        statusCode: res.statusCode,
        responseTime: Date.now() - startedAt,
      },
      "Request completed",
    );
  });

  next();
});
app.use(helmet());
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);
app.use((req, res, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.originalUrl.startsWith(CLERK_PROXY_PATH)
  ) {
    next();
    return;
  }
  const origin = req.get("origin");
  const host = getClerkProxyHost(req);
  const fetchSite = req.get("sec-fetch-site");
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host.toLowerCase() : "";
  } catch {
    originHost = "";
  }
  const isSameOrigin = originHost !== "" && originHost === host?.toLowerCase();
  if (
    !originHost ||
    !host ||
    (!isSameOrigin && !previewOriginHosts.includes(originHost)) ||
    fetchSite === "cross-site"
  ) {
    res.status(403).json({ error: "Cross-origin request rejected" });
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("API_UNHANDLED_ERROR", {
  name: error instanceof Error ? error.name : "UnknownError",
  message: error instanceof Error ? error.message : String(error),
  stack: error instanceof Error ? error.stack : undefined,
  path: req.originalUrl,
  method: req.method,
});
  const candidate = error as { status?: number; statusCode?: number };
  const status = [400, 401, 403, 404, 409, 413, 429].includes(
    candidate.statusCode ?? candidate.status ?? 500,
  )
    ? candidate.statusCode ?? candidate.status!
    : 500;
  res.status(status).json({
    error: status >= 500 ? "Internal server error" : "Request could not be completed",
  });
});

export default app;
