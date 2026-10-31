export type CloudflareWorkerEnv = {
  HYPERDRIVE?: { connectionString?: string };
  DATABASE_URL?: string;
  OBJECT_STORAGE_DRIVER?: string;
  [key: string]: unknown;
};

let applied = false;

export function isCloudflareWorker(): boolean {
  return process.env.CLOUDFLARE_WORKER === "1";
}

export function applyCloudflareBindings(env: CloudflareWorkerEnv): void {
  const connectionString = env.HYPERDRIVE?.connectionString;

  if (
    typeof connectionString !== "string" ||
    connectionString.trim().length === 0
  ) {
    throw new Error(
      "HYPERDRIVE binding is missing or has no connectionString."
    );
  }

  // Hyperdrive / Neon must take precedence over any stale DATABASE_URL.
  process.env.DATABASE_URL = connectionString;

  if (env.OBJECT_STORAGE_DRIVER) {
    process.env.OBJECT_STORAGE_DRIVER = env.OBJECT_STORAGE_DRIVER;
  }

  applied = true;
}

export function cloudflareBindingsApplied(): boolean {
  return applied;
}
