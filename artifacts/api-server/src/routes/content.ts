import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, ilike, or } from "drizzle-orm";
import {
  auditEntries,
  contentItems,
  db,
  siteRecords,
  type ContentAction,
  type MediaReference,
} from "@workspace/db";
import {
  CreateContentItemBody,
  CreateContentItemResponse,
  DeleteContentItemParams,
  GetAdminIdentityResponse,
  GetAdminProfileResponse,
  GetAdminSettingsResponse,
  GetAdminSummaryResponse,
  GetPublicSiteResponse,
  ListAdminActivityQueryParams,
  ListAdminActivityResponse,
  ListAdminContentQueryParams,
  ListAdminContentResponse,
  ListPublicContentQueryParams,
  ListPublicContentResponse,
  SetContentItemPublishedBody,
  SetContentItemPublishedParams,
  SetContentItemPublishedResponse,
  UpdateAdminProfileBody,
  UpdateAdminProfileResponse,
  UpdateAdminSettingsBody,
  UpdateAdminSettingsResponse,
  UpdateContentItemBody,
  UpdateContentItemParams,
  UpdateContentItemResponse,
} from "@workspace/api-zod";
import { requirePermission } from "../middlewares/auth";
import {
  DEFAULT_PROFILE,
  SITE_SETTINGS_KEY,
  mergeAndroidRelease,
  readSiteRecord,
  readSiteSettings,
  setMediaVisibility,
  writeAudit,
  writeSiteRecord,
  type DeveloperProfile,
} from "../lib/yousivar";
import { mergeSiteTheme } from "../lib/theme";
import { mediaAssets } from "@workspace/db";
import { eq as equals } from "drizzle-orm";

const router: IRouter = Router();

function mediaUrlObjectPath(url: string): string | null {
  try {
    const path = new URL(url, "https://yousivar.invalid").pathname;
    const prefix = "/api/storage/objects/";
    const index = path.indexOf(prefix);
    if (index < 0) return null;
    const name = path.slice(index + prefix.length);
    return name && !name.includes("..") && !name.includes("\\")
      ? `/objects/${name}`
      : null;
  } catch {
    return null;
  }
}

async function changeMediaVisibility(
  media: MediaReference[],
  fallbackOwnerId: string,
  visibility: "public" | "private",
): Promise<void> {
  const storage = new (await import("../lib/objectStorage")).ObjectStorageService();
  for (const objectPath of new Set(
    media
      .map((entry) => mediaUrlObjectPath(entry.url))
      .filter((path): path is string => path !== null),
  )) {
    const [asset] = await db
      .select({ ownerId: mediaAssets.ownerId })
      .from(mediaAssets)
      .where(equals(mediaAssets.objectPath, objectPath))
      .limit(1);
    await storage.trySetObjectEntityAclPolicy(objectPath, {
      owner: asset?.ownerId ?? fallbackOwnerId,
      visibility,
    });
  }
}

function isSafePublicUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A release download may be empty (nothing published yet), an https URL or a
 * same-site path, and it must resolve to an .apk file — a source archive, a
 * placeholder or an HTML page is rejected instead of being offered as a build.
 */
function isApkDownload(value: string | null | undefined): boolean {
  if (!value) return true;
  if (!isSafePublicUrl(value)) return false;
  try {
    const path = new URL(value, "https://yousivar.invalid").pathname;
    return path.toLowerCase().endsWith(".apk");
  } catch {
    return false;
  }
}

function isSafeContentPayload(data: {
  url?: string | null;
  actions?: Array<{ url: string }>;
  media?: MediaReference[];
}): boolean {
  return isSafePublicUrl(data.url) &&
    (data.actions ?? []).every((action) => isSafePublicUrl(action.url)) &&
    (data.media ?? []).every((media) => isSafePublicUrl(media.url));
}

router.get("/site", async (_req, res): Promise<void> => {
  const [settings, profile] = await Promise.all([
    readSiteSettings(),
    readSiteRecord<DeveloperProfile>("developer-profile", DEFAULT_PROFILE),
  ]);
  res.json(
    GetPublicSiteResponse.parse({
      settings,
      profile: { ...profile, socials: profile.socials.filter((social) => social.visible) },
    }),
  );
});

router.get("/content", async (req, res): Promise<void> => {
  const parsed = ListPublicContentQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { category, search, limit = 30, offset = 0 } = parsed.data;
  const filters = [eq(contentItems.status, "published")];
  if (category) filters.push(eq(contentItems.category, category));
  if (search) {
    filters.push(
      or(
        ilike(contentItems.title, `%${search}%`),
        ilike(contentItems.titleAr, `%${search}%`),
        ilike(contentItems.description, `%${search}%`),
        ilike(contentItems.descriptionAr, `%${search}%`),
      )!,
    );
  }

  const records = await db
    .select()
    .from(contentItems)
    .where(and(...filters))
    .orderBy(desc(contentItems.featured), asc(contentItems.sortOrder), desc(contentItems.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(
    ListPublicContentResponse.parse(
      records.map((record) => ({ ...record, metadata: {} })),
    ),
  );
});

router.get(
  "/admin/me",
  requirePermission("content:read"),
  async (req, res): Promise<void> => {
    const identity = req.appIdentity;
    if (!identity) {
      res.status(401).json({ error: "Authentication is required" });
      return;
    }
    res.json(GetAdminIdentityResponse.parse(identity));
  },
);

router.get(
  "/admin/summary",
  requirePermission("content:read"),
  async (_req, res): Promise<void> => {
    const [allCounts, publishedCounts, draftCounts, categories, activities] =
      await Promise.all([
        db.select({ value: count() }).from(contentItems),
        db
          .select({ value: count() })
          .from(contentItems)
          .where(eq(contentItems.status, "published")),
        db
          .select({ value: count() })
          .from(contentItems)
          .where(eq(contentItems.status, "draft")),
        db.selectDistinct({ category: contentItems.category }).from(contentItems),
        db.select({ value: count() }).from(auditEntries),
      ]);
    res.json(
      GetAdminSummaryResponse.parse({
        totalContent: Number(allCounts[0]?.value ?? 0),
        publishedContent: Number(publishedCounts[0]?.value ?? 0),
        draftContent: Number(draftCounts[0]?.value ?? 0),
        categoryCount: categories.length,
        recentActivityCount: Number(activities[0]?.value ?? 0),
      }),
    );
  },
);

router.get(
  "/admin/activity",
  requirePermission("audit:read"),
  async (req, res): Promise<void> => {
    const parsed = ListAdminActivityQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { limit = 30 } = parsed.data;
    const entries = await db
      .select()
      .from(auditEntries)
      .orderBy(desc(auditEntries.createdAt))
      .limit(limit);
    res.json(ListAdminActivityResponse.parse(entries));
  },
);

router.get(
  "/admin/content",
  requirePermission("content:read"),
  async (req, res): Promise<void> => {
    const parsed = ListAdminContentQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { category, search, status, limit = 50, offset = 0 } = parsed.data;
    const filters = [];
    if (category) filters.push(eq(contentItems.category, category));
    if (status) filters.push(eq(contentItems.status, status));
    if (search) {
      filters.push(
        or(
          ilike(contentItems.title, `%${search}%`),
          ilike(contentItems.titleAr, `%${search}%`),
          ilike(contentItems.description, `%${search}%`),
          ilike(contentItems.descriptionAr, `%${search}%`),
        )!,
      );
    }
    const query = db
      .select()
      .from(contentItems)
      .orderBy(desc(contentItems.featured), asc(contentItems.sortOrder), desc(contentItems.createdAt))
      .limit(limit)
      .offset(offset);
    const records = filters.length ? await query.where(and(...filters)) : await query;
    res.json(ListAdminContentResponse.parse(records));
  },
);

router.post(
  "/admin/content",
  requirePermission("content:write"),
  async (req, res): Promise<void> => {
    const parsed = CreateContentItemBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const data = parsed.data;
    if (!isSafeContentPayload(data)) {
      res.status(400).json({ error: "Content links must use HTTPS or a safe same-site path" });
      return;
    }
    if (data.status === "published" && req.appIdentity?.role !== "OWNER" &&
      !req.appIdentity?.permissions.includes("content:publish")) {
      res.status(403).json({ error: "Publishing requires content:publish permission" });
      return;
    }
    const [created] = await db
      .insert(contentItems)
      .values({
        ...data,
        actions: data.actions as ContentAction[],
        media: data.media as MediaReference[],
        metadata: data.metadata as Record<string, unknown>,
      })
      .returning();
    if (!created) {
      res.status(500).json({ error: "Content could not be created" });
      return;
    }
    if (created.status === "published") {
      try {
        await changeMediaVisibility(created.media, req.appIdentity!.userId, "public");
      } catch (error) {
        await db
          .update(contentItems)
          .set({ status: "draft", updatedAt: new Date() })
          .where(eq(contentItems.id, created.id));
        req.log.error({ err: error, itemId: created.id }, "Unable to publish attached media");
        res.status(503).json({ error: "Media access could not be safely published; item saved as draft" });
        return;
      }
    }
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "content.create", created.title);
    res.status(201).json(CreateContentItemResponse.parse(created));
  },
);

router.patch(
  "/admin/content/:id",
  requirePermission("content:write"),
  async (req, res): Promise<void> => {
    const params = UpdateContentItemParams.safeParse(req.params);
    const parsed = UpdateContentItemBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({
        error: params.success ? (parsed.error?.message ?? "Invalid content body") : (params.error?.message ?? "Invalid content id"),
      });
      return;
    }
    const [existing] = await db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, params.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Content item not found" });
      return;
    }
    const nextStatus = parsed.data.status ?? existing.status;
    const changesPublication =
      nextStatus !== existing.status ||
      (existing.status === "published" &&
        parsed.data.media !== undefined &&
        (parsed.data.media.length !== existing.media.length ||
          parsed.data.media.some(
            (entry, index) => entry.url !== existing.media[index]?.url,
          )));
    if (
      changesPublication &&
      req.appIdentity?.role !== "OWNER" &&
      !req.appIdentity?.permissions.includes("content:publish")
    ) {
      res.status(403).json({ error: "Publishing requires content:publish permission" });
      return;
    }
    if (!isSafeContentPayload(parsed.data)) {
      res.status(400).json({ error: "Content links must use HTTPS or a safe same-site path" });
      return;
    }
    const nextMedia = (parsed.data.media ?? existing.media) as MediaReference[];
    try {
      await changeMediaVisibility(
        existing.media.filter((oldMedia) => !nextMedia.some((entry) => entry.url === oldMedia.url)),
        req.appIdentity!.userId,
        "private",
      );
      if (nextStatus === "published") {
        await changeMediaVisibility(nextMedia, req.appIdentity!.userId, "public");
      } else {
        await changeMediaVisibility(nextMedia, req.appIdentity!.userId, "private");
      }
    } catch (error) {
      req.log.error({ err: error, itemId: existing.id }, "Unable to update media access");
      res.status(503).json({ error: "Media access could not be updated safely" });
      return;
    }
    const [updated] = await db
      .update(contentItems)
      .set({
        ...parsed.data,
        actions: parsed.data.actions as ContentAction[] | undefined,
        media: parsed.data.media as MediaReference[] | undefined,
        metadata: parsed.data.metadata as Record<string, unknown> | undefined,
        updatedAt: new Date(),
      })
      .where(eq(contentItems.id, params.data.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Content item not found" });
      return;
    }
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "content.update", updated.title);
    res.json(UpdateContentItemResponse.parse(updated));
  },
);

router.delete(
  "/admin/content/:id",
  requirePermission("content:write"),
  async (req, res): Promise<void> => {
    const params = DeleteContentItemParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, params.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Content item not found" });
      return;
    }
    if (
      existing.status === "published" &&
      req.appIdentity?.role !== "OWNER" &&
      !req.appIdentity?.permissions.includes("content:publish")
    ) {
      res.status(403).json({ error: "Deleting published content requires content:publish permission" });
      return;
    }
    try {
      await changeMediaVisibility(existing.media, req.appIdentity!.userId, "private");
    } catch (error) {
      req.log.error({ err: error, itemId: existing.id }, "Unable to protect attached media");
      res.status(503).json({ error: "Media access could not be protected; item was not deleted" });
      return;
    }
    await db.delete(contentItems).where(eq(contentItems.id, params.data.id));
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "content.delete", existing.title);
    res.sendStatus(204);
  },
);

router.patch(
  "/admin/content/:id/publish",
  requirePermission("content:publish"),
  async (req, res): Promise<void> => {
    const params = SetContentItemPublishedParams.safeParse(req.params);
    const parsed = SetContentItemPublishedBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({
        error: params.success ? (parsed.error?.message ?? "Invalid publish state") : (params.error?.message ?? "Invalid content id"),
      });
      return;
    }
    const [existing] = await db
      .select()
      .from(contentItems)
      .where(eq(contentItems.id, params.data.id))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Content item not found" });
      return;
    }
    try {
      await changeMediaVisibility(
        existing.media,
        req.appIdentity!.userId,
        parsed.data.published ? "public" : "private",
      );
    } catch (error) {
      req.log.error({ err: error, itemId: existing.id }, "Unable to change publication media visibility");
      res.status(503).json({ error: "Media access could not be updated safely" });
      return;
    }
    const status = parsed.data.published ? "published" : "draft";
    const [updated] = await db
      .update(contentItems)
      .set({ status, updatedAt: new Date() })
      .where(eq(contentItems.id, existing.id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Content item not found" });
      return;
    }
    await writeAudit(
      req.appIdentity!.userId,
      req.appIdentity!.email,
      parsed.data.published ? "content.publish" : "content.unpublish",
      updated.title,
    );
    res.json(SetContentItemPublishedResponse.parse(updated));
  },
);

router.get(
  "/admin/settings",
  requirePermission("settings:write"),
  async (_req, res): Promise<void> => {
    res.json(GetAdminSettingsResponse.parse(await readSiteSettings()));
  },
);

router.put(
  "/admin/settings",
  requirePermission("settings:write"),
  async (req, res): Promise<void> => {
    const parsed = UpdateAdminSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // The Android block is optional on write: an older or partial client must
    // not erase a published release, so the stored value is the fallback.
    const current = await readSiteSettings();
    const android = mergeAndroidRelease(parsed.data.android ?? current.android);
    if (!isApkDownload(android.apkUrl)) {
      res.status(400).json({ error: "The Android download must be an .apk file URL or a same-site path" });
      return;
    }
    if (android.checksumSha256 && !/^[0-9a-fA-F]{64}$/.test(android.checksumSha256)) {
      res.status(400).json({ error: "The SHA-256 checksum must be 64 hexadecimal characters" });
      return;
    }
    const value = await writeSiteRecord(SITE_SETTINGS_KEY, {
      ...parsed.data,
      android,
      theme: mergeSiteTheme(parsed.data.theme),
    });
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "settings.update", SITE_SETTINGS_KEY);
    res.json(UpdateAdminSettingsResponse.parse(value));
  },
);

router.get(
  "/admin/profile",
  requirePermission("settings:write"),
  async (_req, res): Promise<void> => {
    const profile = await readSiteRecord<DeveloperProfile>("developer-profile", DEFAULT_PROFILE);
    res.json(GetAdminProfileResponse.parse(profile));
  },
);

router.put(
  "/admin/profile",
  requirePermission("settings:write"),
  async (req, res): Promise<void> => {
    const parsed = UpdateAdminProfileBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (
      !isSafePublicUrl(parsed.data.portraitUrl) ||
      parsed.data.socials.some((social) => !isSafePublicUrl(social.url))
    ) {
      res.status(400).json({ error: "Profile links must use HTTPS or a safe same-site path" });
      return;
    }
    const profile = await writeSiteRecord("developer-profile", parsed.data);
    await writeAudit(req.appIdentity!.userId, req.appIdentity!.email, "profile.update", "developer-profile");
    res.json(UpdateAdminProfileResponse.parse(profile));
  },
);

export default router;
