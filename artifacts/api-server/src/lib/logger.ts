import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

/**
 * True inside a Cloudflare Worker (`wrangler.jsonc` sets this var for both
 * `wrangler dev` and `wrangler deploy`).
 *
 * pino's default destination writes through `fs` to file descriptor 1 and the
 * pretty transport needs worker threads; neither exists on Workers. The runtime
 * does provide `process.stdout` as a writable stream, so logs go straight there.
 */
const isCloudflareWorker = process.env.CLOUDFLARE_WORKER === "1";

const loggerOptions = {
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction || isCloudflareWorker
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
};

export const logger = isCloudflareWorker
  ? pino(loggerOptions, {
      write: (line: string) => {
        process.stdout.write(line);
      },
    })
  : pino(loggerOptions);
