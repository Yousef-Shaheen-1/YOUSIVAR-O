import { clerkClient } from "@clerk/express";
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  ListAdminUsersResponse,
  UpdateAdminUserRoleBody,
  UpdateAdminUserRoleParams,
  UpdateAdminUserRoleResponse,
} from "@workspace/api-zod";
import { applicationUsers, db } from "@workspace/db";
import { getClerkUserEmail, listPermissionsForRole, requireOwner } from "../middlewares/auth";
import { writeAudit } from "../lib/yousivar";

const router: IRouter = Router();
const ALLOWED_CUSTOM_PERMISSIONS = new Set([
  "content:read",
  "content:write",
  "content:publish",
  "media:write",
  "settings:write",
  "integrations:write",
  "users:manage",
  "audit:read",
]);

router.get("/admin/users", requireOwner, async (_req, res): Promise<void> => {
  const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!ownerEmail) {
    res.status(503).json({ error: "Set OWNER_EMAIL to a verified Clerk account before managing users" });
    return;
  }

  const [clerkUsers, storedUsers] = await Promise.all([
    clerkClient.users.getUserList({ limit: 100 }),
    db.select().from(applicationUsers),
  ]);
  const roleById = new Map(storedUsers.map((user) => [user.userId, user]));
  const users = await Promise.all(
    clerkUsers.data.map(async (user) => {
      const primaryEmail = await getClerkUserEmail(user.id);
      if (!primaryEmail) return null;
      if (primaryEmail.toLowerCase() === ownerEmail) {
        return {
          userId: user.id,
          email: primaryEmail,
          role: "OWNER" as const,
          permissions: listPermissionsForRole("OWNER"),
        };
      }
      const stored = roleById.get(user.id);
      const role = (stored?.role ?? "CUSTOM_ROLE") as
        | "SUPER_ADMIN"
        | "ADMIN"
        | "PARTNER"
        | "CUSTOM_ROLE";
      return {
        userId: user.id,
        email: primaryEmail,
        role,
        permissions: stored?.permissions ?? [],
      };
    }),
  );

  res.json(ListAdminUsersResponse.parse(users.filter(Boolean)));
});

router.put(
  "/admin/users/:userId/role",
  requireOwner,
  async (req, res): Promise<void> => {
    const params = UpdateAdminUserRoleParams.safeParse(req.params);
    const parsed = UpdateAdminUserRoleBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({
        error: params.success ? (parsed.error?.message ?? "Invalid role assignment") : (params.error?.message ?? "Invalid user id"),
      });
      return;
    }
    if (parsed.data.role === "CUSTOM_ROLE") {
      const invalid = parsed.data.permissions.filter(
        (permission) => !ALLOWED_CUSTOM_PERMISSIONS.has(permission),
      );
      if (invalid.length) {
        res.status(400).json({ error: "One or more custom permissions are not allowed" });
        return;
      }
    }

    let email: string;
    try {
      email = await getClerkUserEmail(params.data.userId);
    } catch {
      res.status(404).json({ error: "Clerk account was not found" });
      return;
    }
    if (!email) {
      res.status(400).json({ error: "The account must have a verified primary email address" });
      return;
    }
    const ownerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    if (!ownerEmail || email.toLowerCase() === ownerEmail) {
      res.status(403).json({ error: "The configured owner cannot be demoted or reassigned" });
      return;
    }

    const permissions =
      parsed.data.role === "CUSTOM_ROLE"
        ? parsed.data.permissions
        : listPermissionsForRole(parsed.data.role);
    const [record] = await db
      .insert(applicationUsers)
      .values({
        userId: params.data.userId,
        email,
        role: parsed.data.role,
        permissions,
      })
      .onConflictDoUpdate({
        target: applicationUsers.userId,
        set: { email, role: parsed.data.role, permissions, updatedAt: new Date() },
      })
      .returning();
    if (!record) {
      res.status(500).json({ error: "Role assignment could not be saved" });
      return;
    }
    await writeAudit(
      req.appIdentity!.userId,
      req.appIdentity!.email,
      "user.role.update",
      `${email} → ${record.role}`,
    );
    res.json(
      UpdateAdminUserRoleResponse.parse({
        userId: record.userId,
        email: record.email,
        role: record.role,
        permissions: record.permissions,
      }),
    );
  },
);

export default router;
