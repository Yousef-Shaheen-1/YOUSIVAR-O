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
  const hyperdrive = env.HYPERDRIVE;
  if (typeof hyperdrive?.connectionString === "string") {
    process.env.DATABASE_URL ??= hyperdrive.connectionString;
  } else if (typeof env.DATABASE_URL === "string" && env.DATABASE_URL) {
    process.env.DATABASE_URL ??= env.DATABASE_URL;
  }

  if (env.OBJECT_STORAGE_DRIVER) {
    process.env.OBJECT_STORAGE_DRIVER ??= env.OBJECT_STORAGE_DRIVER;
  }
  applied = true;
}

export function cloudflareBindingsApplied(): boolean {
  return applied;
}
