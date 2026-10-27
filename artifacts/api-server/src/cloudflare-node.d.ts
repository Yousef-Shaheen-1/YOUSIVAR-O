/**
 * Ambient types for the Cloudflare-only module used by `src/worker.ts`.
 *
 * The module exists inside workerd, not in node_modules, so TypeScript needs a
 * declaration for it. `wrangler` bundles it as a runtime builtin.
 */
declare module "cloudflare:node" {
  /** Bridges one incoming Worker request to a registered Node.js http server. */
  export function handleAsNodeRequest(
    port: number,
    request: Request,
  ): Promise<Response>;

  /** Registers a Node.js http server as the Worker's default export. */
  export function httpServerHandler(serverOrOptions: unknown): unknown;
}
