import {
  createHash,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { CookieOptions, Request, Response } from "express";
import { db, ownerChallenges, ownerSessions } from "@workspace/db";
import { EmailDeliveryError, emailReadiness, sendEmail } from "./email";
import { writeAudit } from "./yousivar";

/**
 * Owner access ("Ω" flow).
 *
 * Step 1  the browser submits an email; the server compares it against the
 *         authorized owner email held in server-side secret storage.
 * Step 2  the browser submits username + password, validated against the
 *         registered owner account (also secret storage), and the server sends
 *         a one-time code to the authorized address only.
 * Step 3  the browser submits the code; a correct, unexpired, unused code
 *         creates an owner session.
 *
 * Codes are stored hashed, single-use, expiring, attempt-limited and
 * resend-throttled. Passwords, codes and mail credentials are never logged.
 */

export const OWNER_SESSION_COOKIE = "yousivar_owner_session";

export class OwnerAuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "OwnerAuthError";
    this.status = status;
  }
}

const scrypt = promisify(scryptCallback) as (
  secret: string,
  salt: Buffer,
  length: number,
) => Promise<Buffer>;

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const limits = {
  otpTtlSeconds: () => positiveInt(process.env.OWNER_OTP_TTL_SECONDS, 600),
  maxAttempts: () => positiveInt(process.env.OWNER_OTP_MAX_ATTEMPTS, 5),
  resendCooldownSeconds: () => positiveInt(process.env.OWNER_OTP_RESEND_COOLDOWN_SECONDS, 45),
  maxSends: () => positiveInt(process.env.OWNER_OTP_MAX_SENDS, 5),
  challengeTtlSeconds: () => positiveInt(process.env.OWNER_CHALLENGE_TTL_SECONDS, 900),
  sessionSeconds: () => positiveInt(process.env.OWNER_SESSION_SECONDS, 12 * 60 * 60),
  startPerHour: () => positiveInt(process.env.OWNER_CHALLENGE_LIMIT_PER_HOUR, 20),
  codePerHour: () => positiveInt(process.env.OWNER_CODE_LIMIT_PER_HOUR, 30),
  verifyPerHour: () => positiveInt(process.env.OWNER_VERIFY_LIMIT_PER_HOUR, 60),
};

const buckets = new Map<string, { count: number; resetAt: number }>();

function enforceRateLimit(key: string, limit: number, message: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size > 5_000) {
      for (const [entryKey, entry] of buckets) {
        if (entry.resetAt <= now) buckets.delete(entryKey);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + 3_600_000 });
    return;
  }
  if (bucket.count >= limit) {
    throw new OwnerAuthError(429, message);
  }
  bucket.count += 1;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison of two strings, independent of length. */
function secureEquals(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right));
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function derive(secret: string, salt: Buffer, length = 64): Promise<Buffer> {
  return scrypt(secret, salt, length);
}

export async function hashOwnerSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await derive(secret, salt);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyHashedSecret(secret: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length === 0) return false;
  const derived = await derive(secret, Buffer.from(saltHex, "hex"), expected.length);
  return derived.length === expected.length && timingSafeEqual(expected, derived);
}

export function authorizedOwnerEmail(): string {
  return (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
}

function ownerUsername(): string {
  return (process.env.OWNER_USERNAME ?? "").trim();
}

export function ownerCredentialsConfigured(): boolean {
  return Boolean(
    ownerUsername() && ((process.env.OWNER_PASSWORD ?? "").length > 0 || (process.env.OWNER_PASSWORD_HASH ?? "").trim()),
  );
}

/** Both factors are always evaluated so a wrong username costs the same as a wrong password. */
async function verifyOwnerCredentials(username: string, password: string): Promise<boolean> {
  const expectedUsername = ownerUsername();
  const passwordHash = (process.env.OWNER_PASSWORD_HASH ?? "").trim();
  const plainPassword = process.env.OWNER_PASSWORD ?? "";
  if (!expectedUsername || (!passwordHash && !plainPassword)) return false;
  const usernameMatches = secureEquals(username.trim().toLowerCase(), expectedUsername.toLowerCase());
  const passwordMatches = passwordHash
    ? await verifyHashedSecret(password, passwordHash)
    : secureEquals(password, plainPassword);
  return usernameMatches && passwordMatches;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "the authorized address";
  const visible = (local ?? "").slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, (local ?? "").length - visible.length))}@${domain}`;
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

async function loadChallenge(challengeId: string) {
  const id = challengeId.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new OwnerAuthError(404, "This owner access attempt is no longer valid. Start again.");
  }
  const [challenge] = await db
    .select()
    .from(ownerChallenges)
    .where(eq(ownerChallenges.id, id))
    .limit(1);
  if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
    throw new OwnerAuthError(410, "This owner access attempt has expired. Start again.");
  }
  return challenge;
}

export async function startOwnerChallenge(
  emailValue: string,
  clientKey: string,
): Promise<{ challengeId: string; expiresAt: string; destination: string }> {
  const ownerEmail = authorizedOwnerEmail();
  if (!ownerEmail) {
    throw new OwnerAuthError(
      503,
      "Owner access is not configured on the server. Set OWNER_EMAIL as an app secret.",
    );
  }
  enforceRateLimit(
    `start:${clientKey}`,
    limits.startPerHour(),
    "Too many owner access attempts from this address. Try again later.",
  );

  const submitted = emailValue.trim().toLowerCase();
  if (!submitted || !secureEquals(submitted, ownerEmail)) {
    await writeAudit("anonymous", submitted || "unknown", "owner.challenge_rejected", "email-not-authorized");
    throw new OwnerAuthError(403, "That email is not authorized for owner access.");
  }

  await db
    .delete(ownerChallenges)
    .where(lt(ownerChallenges.expiresAt, new Date(Date.now() - 86_400_000)));

  const expiresAt = new Date(Date.now() + limits.challengeTtlSeconds() * 1000);
  const [challenge] = await db
    .insert(ownerChallenges)
    .values({ email: ownerEmail, expiresAt })
    .returning();
  if (!challenge) {
    throw new OwnerAuthError(503, "Owner access could not be started. Try again.");
  }
  return {
    challengeId: challenge.id,
    expiresAt: expiresAt.toISOString(),
    destination: maskEmail(ownerEmail),
  };
}

export async function requestOwnerVerificationCode(
  challengeId: string,
  username: string,
  password: string,
  clientKey: string,
): Promise<{
  destination: string;
  codeExpiresAt: string;
  resendAfterSeconds: number;
  provider: string;
  ttlSeconds: number;
}> {
  enforceRateLimit(
    `code:${clientKey}`,
    limits.codePerHour(),
    "Too many verification codes requested from this address. Try again later.",
  );

  const challenge = await loadChallenge(challengeId);

  if (!ownerCredentialsConfigured()) {
    throw new OwnerAuthError(
      503,
      "Owner credentials are not configured on the server. Set OWNER_USERNAME and OWNER_PASSWORD (or OWNER_PASSWORD_HASH) as app secrets.",
    );
  }

  if (!(await verifyOwnerCredentials(username, password))) {
    await writeAudit(
      username.trim() || "unknown",
      challenge.email,
      "owner.credentials_rejected",
      "invalid-owner-credentials",
    );
    throw new OwnerAuthError(401, "Those credentials do not match the registered owner account.");
  }

  const readiness = emailReadiness();
  if (!readiness.configured) {
    throw new OwnerAuthError(503, readiness.detail);
  }

  const now = Date.now();
  const cooldownMs = limits.resendCooldownSeconds() * 1000;
  if (challenge.lastSentAt && now - challenge.lastSentAt.getTime() < cooldownMs) {
    const retryAfter = Math.ceil((cooldownMs - (now - challenge.lastSentAt.getTime())) / 1000);
    throw new OwnerAuthError(
      429,
      `A verification code was just sent. Wait ${retryAfter} seconds before requesting another.`,
    );
  }
  if (challenge.sends >= limits.maxSends()) {
    throw new OwnerAuthError(
      429,
      "Too many verification codes were requested for this attempt. Start the owner access flow again.",
    );
  }

  const code = generateCode();
  const codeHash = await hashOwnerSecret(code);
  const codeExpiresAt = new Date(now + limits.otpTtlSeconds() * 1000);
  const ttlMinutes = Math.max(1, Math.round(limits.otpTtlSeconds() / 60));

  await db
    .update(ownerChallenges)
    .set({
      username: ownerUsername(),
      codeHash,
      codeExpiresAt,
      attempts: 0,
      sends: challenge.sends + 1,
      lastSentAt: new Date(now),
      expiresAt: new Date(now + limits.challengeTtlSeconds() * 1000),
    })
    .where(eq(ownerChallenges.id, challenge.id));

  try {
    await sendEmail({
      to: challenge.email,
      subject: "YOUSIVAR–Ω owner verification code",
      text: [
        "Owner verification",
        "",
        `Your one-time code is: ${code}`,
        "",
        `It expires in ${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"} and can be used once.`,
        "If you did not request this code, ignore this message — no access was granted.",
      ].join("\n"),
    });
  } catch (error) {
    // The code never reached the owner, so it must not stay usable.
    await db
      .update(ownerChallenges)
      .set({ codeHash: null, codeExpiresAt: null, lastSentAt: null, sends: challenge.sends })
      .where(eq(ownerChallenges.id, challenge.id));
    // Surface the provider's own (safe) explanation, never a bare 500.
    throw new OwnerAuthError(
      503,
      error instanceof EmailDeliveryError
        ? error.message
        : "The verification email could not be delivered, so no working code was issued. Check the mail configuration and try again.",
      error,
    );
  }

  await writeAudit(`owner:${ownerUsername()}`, challenge.email, "owner.code_sent", "email-otp");
  return {
    destination: maskEmail(challenge.email),
    codeExpiresAt: codeExpiresAt.toISOString(),
    resendAfterSeconds: limits.resendCooldownSeconds(),
    provider: readiness.provider ?? "email",
    ttlSeconds: limits.otpTtlSeconds(),
  };
}

export async function verifyOwnerCode(
  challengeId: string,
  code: string,
  clientKey: string,
  userAgent: string,
): Promise<{ token: string; expiresAt: string; email: string; username: string }> {
  enforceRateLimit(
    `verify:${clientKey}`,
    limits.verifyPerHour(),
    "Too many verification attempts from this address. Try again later.",
  );

  const challenge = await loadChallenge(challengeId);

  if (!challenge.codeHash || !challenge.codeExpiresAt) {
    throw new OwnerAuthError(409, "No verification code is pending for this attempt. Request one first.");
  }
  if (challenge.codeExpiresAt.getTime() <= Date.now()) {
    throw new OwnerAuthError(410, "That verification code has expired. Request a new one.");
  }
  if (challenge.attempts >= limits.maxAttempts()) {
    throw new OwnerAuthError(
      429,
      "Too many incorrect codes for this attempt. Start the owner access flow again.",
    );
  }

  const submitted = code.trim();
  if (!/^\d{4,10}$/.test(submitted) || !(await verifyHashedSecret(submitted, challenge.codeHash))) {
    await db
      .update(ownerChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(ownerChallenges.id, challenge.id));
    throw new OwnerAuthError(401, "That verification code is not correct.");
  }

  // Single use: the challenge is consumed and the code erased.
  await db
    .update(ownerChallenges)
    .set({ consumedAt: new Date(), codeHash: null, codeExpiresAt: null })
    .where(eq(ownerChallenges.id, challenge.id));

  await db
    .delete(ownerSessions)
    .where(lt(ownerSessions.expiresAt, new Date(Date.now() - 7 * 86_400_000)));

  const username = challenge.username ?? ownerUsername();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + limits.sessionSeconds() * 1000);
  await db.insert(ownerSessions).values({
    tokenHash: hashToken(token),
    email: challenge.email,
    username,
    userAgent: userAgent.slice(0, 200),
    expiresAt,
  });

  await writeAudit(`owner:${username}`, challenge.email, "owner.login", "password+email-otp");
  return { token, expiresAt: expiresAt.toISOString(), email: challenge.email, username };
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 0) continue;
    if (trimmed.slice(0, separator) !== name) continue;
    const value = trimmed.slice(separator + 1);
    return value ? decodeURIComponent(value) : null;
  }
  return null;
}

/**
 * Cookie policy for the owner session.
 *
 * `SameSite=Lax` is the default. The Base44 preview serves the app inside an
 * iframe, where a Lax cookie is never sent, so under `BASE44_PREVIEW_MODE=1`
 * (and only then) the session cookie is SameSite=None + Secure. Both are
 * overridable with OWNER_COOKIE_SAMESITE / OWNER_COOKIE_SECURE.
 */
export function ownerCookieOptions(): CookieOptions {
  const previewMode = process.env.BASE44_PREVIEW_MODE === "1";
  const configured = (process.env.OWNER_COOKIE_SAMESITE ?? "").trim().toLowerCase();
  const sameSite: CookieOptions["sameSite"] =
    configured === "none" || configured === "strict" || configured === "lax"
      ? (configured as CookieOptions["sameSite"])
      : previewMode
        ? "none"
        : "lax";
  const configuredSecure = (process.env.OWNER_COOKIE_SECURE ?? "").trim().toLowerCase();
  const secure =
    configuredSecure === "true" ? true : configuredSecure === "false" ? false : sameSite === "none";
  return {
    httpOnly: true,
    sameSite,
    secure,
    path: "/",
    maxAge: limits.sessionSeconds() * 1000,
  };
}

export function setOwnerSessionCookie(res: Response, token: string): void {
  res.cookie(OWNER_SESSION_COOKIE, token, ownerCookieOptions());
}

export function clearOwnerSessionCookie(res: Response): void {
  const { maxAge, ...options } = ownerCookieOptions();
  void maxAge;
  res.clearCookie(OWNER_SESSION_COOKIE, options);
}

export type OwnerSessionIdentity = { userId: string; email: string; username: string };

export async function resolveOwnerSessionIdentity(
  req: Request,
): Promise<OwnerSessionIdentity | null> {
  const token = readCookie(req, OWNER_SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = hashToken(token);
  const [session] = await db
    .select()
    .from(ownerSessions)
    .where(
      and(
        eq(ownerSessions.tokenHash, tokenHash),
        isNull(ownerSessions.revokedAt),
        gt(ownerSessions.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return null;

  if (Date.now() - session.lastSeenAt.getTime() > 300_000) {
    await db
      .update(ownerSessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(ownerSessions.id, session.id));
  }

  return { userId: `owner:${session.username}`, email: session.email, username: session.username };
}

export async function revokeOwnerSession(req: Request, res: Response): Promise<boolean> {
  const token = readCookie(req, OWNER_SESSION_COOKIE);
  clearOwnerSessionCookie(res);
  if (!token) return false;
  const [revoked] = await db
    .update(ownerSessions)
    .set({ revokedAt: new Date() })
    .where(eq(ownerSessions.tokenHash, hashToken(token)))
    .returning({ email: ownerSessions.email, username: ownerSessions.username });
  if (!revoked) return false;
  await writeAudit(`owner:${revoked.username}`, revoked.email, "owner.logout", "session-revoked");
  return true;
}

export async function currentOwnerSession(req: Request) {
  const identity = await resolveOwnerSessionIdentity(req);
  if (!identity) return null;
  return { username: identity.username, email: identity.email };
}

export function ownerAccessReadiness() {
  const readiness = emailReadiness();
  return {
    ownerEmailConfigured: Boolean(authorizedOwnerEmail()),
    credentialsConfigured: ownerCredentialsConfigured(),
    emailConfigured: readiness.configured,
    emailProvider: readiness.provider,
    emailDetail: readiness.detail,
    otpTtlSeconds: limits.otpTtlSeconds(),
    resendCooldownSeconds: limits.resendCooldownSeconds(),
    maxAttempts: limits.maxAttempts(),
    sessionSeconds: limits.sessionSeconds(),
  };
}

export function ownerClientKey(req: Request): string {
  const forwarded = req.get("x-forwarded-for");
  const candidate = forwarded?.split(",")[0]?.trim() || req.ip || req.socket.remoteAddress || "";
  return candidate || "unknown";
}
