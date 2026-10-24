import { eq } from "drizzle-orm";
import { db, siteRecords, type MediaReference } from "@workspace/db";
import {
  ObjectStorageService,
  type ObjectStorageService as StorageService,
} from "./objectStorage";

export type SiteSettings = {
  projectName: string;
  projectNameAr: string;
  tagline: string;
  taglineAr: string;
  defaultLocale: "en" | "ar";
  accentColor: string;
  reducedMotion: boolean;
};

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

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  projectName: "YOUSIVAR–Ω",
  projectNameAr: "𝐘𝐎𝐔𝐒𝐈𝐕𝐀𝐑–Ω",
  tagline: "Absolute discretion. Digital silence. Unseen authority.",
  taglineAr: "التكتم المطلق، الموت الرقمي، والسلطة التي لا تُرى",
  defaultLocale: "ar",
  accentColor: "#A6A6A6",
  reducedMotion: false,
};

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
  storage: StorageService = new ObjectStorageService(),
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
