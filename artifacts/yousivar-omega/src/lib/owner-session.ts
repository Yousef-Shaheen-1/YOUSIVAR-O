/**
 * Owner access client for the Ω flow.
 *
 * Every call is same-origin (`/api/...` through the dev server / API) and the
 * session lives in an HttpOnly cookie, so nothing here ever holds a token the
 * browser script could leak. All authorization decisions are made server-side.
 */

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export type OwnerReadiness = {
  ownerEmailConfigured: boolean;
  credentialsConfigured: boolean;
  emailConfigured: boolean;
  emailProvider: "resend" | "smtp" | null;
  emailDetail: string;
  otpTtlSeconds: number;
  resendCooldownSeconds: number;
  maxAttempts: number;
  sessionSeconds: number;
};

export type OwnerIdentity = { username: string; email: string };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${basePath}/api${path}`, {
    credentials: "same-origin",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error || `The request could not be completed (${response.status}).`);
  }
  return (payload ?? ({} as T)) as T;
}

export const ownerAccess = {
  readiness: () => call<OwnerReadiness>("/owner/readiness"),

  start: (email: string) =>
    call<{ authorized: boolean; challengeId: string; expiresAt: string; destination: string }>(
      "/owner/session/start",
      { method: "POST", body: JSON.stringify({ email }) },
    ),

  requestCode: (challengeId: string, username: string, password: string) =>
    call<{
      sent: boolean;
      destination: string;
      codeExpiresAt: string;
      resendAfterSeconds: number;
      ttlSeconds: number;
      provider: string;
    }>("/owner/session/code", {
      method: "POST",
      body: JSON.stringify({ challengeId, username, password }),
    }),

  verify: (challengeId: string, code: string) =>
    call<{ authenticated: boolean; owner: OwnerIdentity; expiresAt: string }>(
      "/owner/session/verify",
      { method: "POST", body: JSON.stringify({ challengeId, code }) },
    ),

  session: () => call<{ authenticated: boolean; owner?: OwnerIdentity }>("/owner/session"),

  logout: () => call<{ revoked: boolean }>("/owner/session/logout", { method: "POST" }),
};
