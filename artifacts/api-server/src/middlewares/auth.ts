import { clerkClient, getAuth } from "@clerk/express";
import { eq } from "drizzle-orm";
import type { NextFunction, Request, Response } from "express";
import { db, applicationUsers } from "@workspace/db";
import { resolveOwnerSessionIdentity } from "../lib/ownerAuth";

export type AppRole =
  | "OWNER"
  | "SUPER_ADMIN"
  | "ADMIN"
  | "PARTNER"
  | "CUSTOM_ROLE"
  | "PUBLIC";

export type AppIdentity = {
  userId: string;
  email: string;
  role: AppRole;
  permissions: string[];
};

declare global {
  namespace Express {
    interface Request {
      appIdentity?: AppIdentity;
    }
  }
}

const BASE_PERMISSIONS: Record<Exclude<AppRole, "OWNER" | "CUSTOM_ROLE" | "PUBLIC">, string[]> = {
  SUPER_ADMIN: [
    "content:read",
    "content:write",
    "content:publish",
    "media:write",
    "audit:read",
  ],
  ADMIN: ["content:read", "content:write", "media:write"],
  PARTNER: ["content:read"],
};

const OWNER_PERMISSIONS = [
  "content:read",
  "content:write",
  "content:publish",
  "media:write",
  "settings:write",
  "integrations:write",
  "users:manage",
  "audit:read",
];

const emailCache = new Map<string, { email: string; expiresAt: number }>();
const EMAIL_CACHE_TTL_MS = 2 * 60 * 1000;

async function getVerifiedPrimaryEmail(userId: string): Promise<string> {
  const cached = emailCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.email;

  const user = await clerkClient.users.getUser(userId);
  const primary = user.emailAddresses.find(
    (address) => address.id === user.primaryEmailAddressId,
  );
  if (!primary || primary.verification?.status !== "verified") {
    return "";
  }

  const email = primary.emailAddress.trim().toLowerCase();
  emailCache.set(userId, { email, expiresAt: Date.now() + EMAIL_CACHE_TTL_MS });
  return email;
}

export async function resolveAppIdentity(userId: string): Promise<AppIdentity> {
  const email = await getVerifiedPrimaryEmail(userId);
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();

  if (ownerEmail && email && ownerEmail === email) {
    return { userId, email, role: "OWNER", permissions: OWNER_PERMISSIONS };
  }

  const [storedRole] = await db
    .select()
    .from(applicationUsers)
    .where(eq(applicationUsers.userId, userId))
    .limit(1);

  if (!storedRole || !email || storedRole.email.toLowerCase() !== email) {
    return { userId, email, role: "PUBLIC", permissions: [] };
  }

  const role = storedRole.role as AppRole;
  const permissions =
    role === "CUSTOM_ROLE"
      ? storedRole.permissions
      : role === "OWNER"
        ? []
        : (BASE_PERMISSIONS[role as keyof typeof BASE_PERMISSIONS] ?? []);

  return { userId, email, role, permissions };
}

export function requirePermission(permission: string) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // The Ω owner session is checked first: it is only issued after password
      // and email-code verification, so it carries the immutable OWNER role.
      const ownerSession = await resolveOwnerSessionIdentity(req);
      if (ownerSession) {
        req.appIdentity = {
          userId: ownerSession.userId,
          email: ownerSession.email,
          role: "OWNER",
          permissions: OWNER_PERMISSIONS,
        };
        next();
        return;
      }

      const { userId } = getAuth(req);
      if (!userId) {
        res.status(401).json({ error: "Authentication is required" });
        return;
      }

      const identity = await resolveAppIdentity(userId);
      req.appIdentity = identity;
      if (identity.role === "PUBLIC" || !identity.permissions.includes(permission)) {
        res.status(403).json({ error: "Insufficient application permissions" });
        return;
      }
      next();
    } catch (error) {
      req.log.error({ err: error }, "Unable to resolve application identity");
      res.status(503).json({ error: "Unable to verify application permissions" });
    }
  };
}

export function requireOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const permissionMiddleware = requirePermission("users:manage");
  void permissionMiddleware(req, res, () => {
    if (req.appIdentity?.role !== "OWNER") {
      res.status(403).json({ error: "Owner role is required" });
      return;
    }
    next();
  });
}

export function listPermissionsForRole(
  role: AppRole,
  customPermissions: string[] = [],
): string[] {
  if (role === "OWNER") return OWNER_PERMISSIONS;
  if (role === "CUSTOM_ROLE") return customPermissions;
  if (role === "PUBLIC") return [];
  return BASE_PERMISSIONS[role];
}

export async function getClerkUserEmail(userId: string): Promise<string> {
  return getVerifiedPrimaryEmail(userId);
}
