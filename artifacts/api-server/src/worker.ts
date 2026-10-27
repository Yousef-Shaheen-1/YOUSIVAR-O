/**
 * Cloudflare Workers entry point for the YOUSIVAR–Ω API.
 *
 * The API is the same Express application that runs under Node (`src/app.ts`):
 * Cloudflare Workers implement the `node:http` server API, so the app is mounted
 * on an in-memory server and each incoming `fetch` request is bridged to it.
 * Every route, middleware, Clerk call, owner-session check and Drizzle query
 * therefore behaves exactly as it does in development.
 *
 * The only Worker-specific work happens in `applyCloudflareBindings`, which must
 * run BEFORE the application is imported: the database module resolves its
 * connection string while it is being evaluated, and the Hyperdrive binding is
 * only reachable from inside the `fetch` handler.
 *
 * Deploy with `pnpm --filter @workspace/api-server run cf:deploy` (see
 * CLOUDFLARE.md).
 */

import { createServer, type Server } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";

import { applyCloudflareBindings, type CloudflareWorkerEnv } from "./lib/cloudflare/bindings";

/**
 * Identifier used to register the in-memory server. Workers have no listening
 * sockets, so this number is a routing key for the bridge, not a real port.
 */
const BRIDGE_PORT = 8788;

let starting: Promise<void> | null = null;

function startNodeServer(): Promise<void> {
  starting ??= (async () => {
    // Imported dynamically so the bindings above are applied first: the app (via
    // @workspace/db) reads DATABASE_URL as its module is evaluated.
    const { default: app } = await import("./app");
    const server: Server = createServer(app as unknown as () => void);
    server.listen(BRIDGE_PORT);
  })();
  return starting;
}

export default {
  async fetch(
    request: Request,
    env: CloudflareWorkerEnv,
  ): Promise<Response> {
    applyCloudflareBindings(env);
    await startNodeServer();
    return handleAsNodeRequest(BRIDGE_PORT, request);
  },
};
