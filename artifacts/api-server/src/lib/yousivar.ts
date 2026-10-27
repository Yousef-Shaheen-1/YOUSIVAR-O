import { eq } from "drizzle-orm";
import { db, siteRecords, type MediaReference } from "@workspace/db";
import { createObjectStorageService } from "./cloudflare/objectStorageFactory";
import type { ObjectStorageBackend as StorageService } from "./cloudflare/objectStorageBackend";
import { DEFAULT_THEME, mergeSiteTheme, type SiteTheme } from "./theme";

/**
 * The published Android release, described by the owner. `apkUrl` stays empty
 * until a real APK artifact exists, so the public download block can never
 * point at something that is not an APK file.
 */
export type AndroidRelease = {
  versionName: string;
  versionCode: number;
  releasedAt: string | null;
  downloadEnabled: boolean;
  apkUrl: string;
  apkSizeBytes: number;
  checksumSha256: string;
  minAndroid: string;
  releaseNotes: string;
  releaseNotesAr: string;
  debugBuild: boolean;
};

export type SiteSettings = {
  projectName: string;
  projectNameAr: string;
  tagline: string;
  taglineAr: string;
  defaultLocale: "en" | "ar";
  accentColor: string;
  reducedMotion: boolean;
  theme: SiteTheme;
  android: AndroidRelease;
};

export const SITE_SETTINGS_KEY = "site-settings";

export type DeveloperProfile = {
  name: string;
  nameAr: string;
  biography: string;
  biographyAr: string;
  portraitUrl: string | null;
  skills: string[];
  socials: Array<{ label: string; url: string; visible: boolean }>;
};

export type AssistantSettings = {
  name: string;
  nameAr: string;
  welcomeMessage: string;
  welcomeMessageAr: string;
  instructions: string;
  provider: "openai" | "gemini" | "groq" | "ollama";
  model: string;
  enabled: boolean;
  visible: boolean;
};

export type AiProviderSettings = {
  model: string;
  endpoint: string | null;
  enabled: boolean;
};

/**
 * The release a workspace starts with: the debug APK built from this repository
 * and committed with the site. An owner who has not published anything can set
 * `downloadEnabled` to false (or clear `apkUrl`), which is exactly how the
 * public page tells "no artifact yet" apart from a downloadable release.
 */
export const DEFAULT_ANDROID_RELEASE: AndroidRelease = {
  versionName: "1.0.0",
  versionCode: 1,
  releasedAt: "2026-10-26",
  downloadEnabled: true,
  // A real, packaged APK committed with the site (see APK_RELEASE.md). The
  // block only ever renders a download button while this points at an .apk.
  apkUrl: "/downloads/yousivar-omega-android.apk",
  apkSizeBytes: 4482022,
  checksumSha256:
    "6ca93a63351ec48356943f2a3536e6882dc90bd9b2694c422f46ec9370c42a73",
  minAndroid: "Android 7.0 (API 24)",
  releaseNotes:
    "First public build of the YOUSIVAR–Ω Android application: the full project and tools catalog, the owner console, Arabic and English layouts, and offline handling when the network drops.",
  releaseNotesAr:
    "أول إصدار عام لتطبيق YOUSIVAR–Ω على أندرويد: فهرس المشاريع والأدوات كاملاً، لوحة المالك، واجهة عربية وإنجليزية، ومعالجة انقطاع الشبكة.",
  debugBuild: true,
};

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  projectName: "YOUSIVAR–Ω",
  projectNameAr: "𝐘𝐎𝐔𝐒𝐈𝐕𝐀𝐑–Ω",
  tagline: "Absolute discretion. Digital silence. Unseen authority.",
  taglineAr: "التكتم المطلق، الموت الرقمي، والسلطة التي لا تُرى",
  defaultLocale: "ar",
  accentColor: "#A6A6A6",
  reducedMotion: false,
  theme: DEFAULT_THEME,
  android: DEFAULT_ANDROID_RELEASE,
};

/** A stored release completed with defaults; a settings write can omit it. */
export function mergeAndroidRelease(
  value: Partial<AndroidRelease> | null | undefined,
): AndroidRelease {
  if (!value) return DEFAULT_ANDROID_RELEASE;
  return {
    ...DEFAULT_ANDROID_RELEASE,
    ...value,
    apkUrl: typeof value.apkUrl === "string" ? value.apkUrl : "",
    checksumSha256:
      typeof value.checksumSha256 === "string" ? value.checksumSha256 : "",
  };
}

/**
 * The stored settings with every optional piece filled in. Settings records
 * written before a field existed (the theme, for instance) are completed here
 * rather than rejected by validation.
 */
export async function readSiteSettings(): Promise<SiteSettings> {
  const stored = await readSiteRecord<Partial<SiteSettings>>(SITE_SETTINGS_KEY, {});
  return {
    ...DEFAULT_SITE_SETTINGS,
    ...stored,
    theme: mergeSiteTheme(stored?.theme),
    android: mergeAndroidRelease(stored?.android),
  };
}

export const DEFAULT_PROFILE: DeveloperProfile = {
  name: "",
  nameAr: "",
  biography: "",
  biographyAr: "",
  portraitUrl: null,
  skills: [],
  socials: [],
};

export const DEFAULT_ASSISTANT_SETTINGS: AssistantSettings = {
  name: "Omega",
  nameAr: "أوميغا",
  welcomeMessage: "How can I help you?",
  welcomeMessageAr: "كيف يمكنني مساعدتك؟",
  instructions: "",
  provider: "openai",
  model: "gpt-4.1-mini",
  enabled: false,
  visible: false,
};

export const DEFAULT_AI_PROVIDERS: Record<string, AiProviderSettings> = {
  openai: { model: "gpt-4.1-mini", endpoint: null, enabled: true },
  gemini: { model: "gemini-2.5-flash", endpoint: null, enabled: false },
  groq: { model: "llama-3.3-70b-versatile", endpoint: null, enabled: false },
  ollama: { model: "llama3.2", endpoint: null, enabled: false },
};

export async function readSiteRecord<T>(key: string, fallback: T): Promise<T> {
  await db
    .insert(siteRecords)
    .values({ key, value: fallback })
    .onConflictDoNothing();

  const [record] = await db
    .select()
    .from(siteRecords)
    .where(eq(siteRecords.key, key))
    .limit(1);
  return (record?.value as T | undefined) ?? fallback;
}

export async function writeSiteRecord<T>(key: string, value: T): Promise<T> {
  const [record] = await db
    .insert(siteRecords)
    .values({ key, value })
    .onConflictDoUpdate({
      target: siteRecords.key,
      set: { value, updatedAt: new Date() },
    })
    .returning();
  return (record?.value as T | undefined) ?? value;
}

export async function writeAudit(
  actor: string,
  actorEmail: string,
  action: string,
  target: string,
): Promise<void> {
  const { auditEntries } = await import("@workspace/db");
  await db.insert(auditEntries).values({ actor, actorEmail, action, target });
}

export function uploadedObjectPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "https://yousivar.invalid");
    const marker = "/api/storage/objects/";
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    const objectName = parsed.pathname.slice(index + marker.length);
    if (!objectName || objectName.includes("..") || objectName.includes("\\")) {
      return null;
    }
    return `/objects/${objectName}`;
  } catch {
    return null;
  }
}

export async function setMediaVisibility(
  media: MediaReference[],
  ownerId: string,
  visibility: "public" | "private",
  storage: StorageService = createObjectStorageService(),
): Promise<void> {
  const paths = new Set(
    media
      .map((item) => uploadedObjectPathFromUrl(item.url))
      .filter((path): path is string => path !== null),
  );
  for (const path of paths) {
    await storage.trySetObjectEntityAclPolicy(path, { owner: ownerId, visibility });
  }
}
