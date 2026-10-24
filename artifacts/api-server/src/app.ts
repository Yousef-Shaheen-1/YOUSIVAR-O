import express, { type Express } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.disable("x-powered-by");
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
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
  if (!originHost || !host || originHost !== host.toLowerCase() || fetchSite === "cross-site") {
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
  req.log.error({ err: error }, "Unhandled API error");
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
