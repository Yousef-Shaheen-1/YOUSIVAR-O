import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type ContentAction = {
  label: string;
  labelAr?: string | null;
  url: string;
  kind?: "primary" | "secondary";
};

export type MediaReference = {
  url: string;
  kind: "image" | "gif" | "video" | "audio" | "icon";
  alt?: string | null;
};

export const contentItems = pgTable("yousivar_content_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  description: text("description").notNull().default(""),
  descriptionAr: text("description_ar"),
  url: text("url"),
  tags: text("tags")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  actions: jsonb("actions").$type<ContentAction[]>().notNull().default([]),
  media: jsonb("media").$type<MediaReference[]>().notNull().default([]),
  status: text("status").notNull().default("draft"),
  featured: boolean("featured").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const siteRecords = pgTable("yousivar_site_records", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const auditEntries = pgTable("yousivar_audit_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  actor: text("actor").notNull(),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const applicationUsers = pgTable("yousivar_application_users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  permissions: text("permissions")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const mediaAssets = pgTable("yousivar_media_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  name: text("name").notNull(),
  objectPath: text("object_path").notNull().unique(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Owner access (the Ω flow). Challenges hold only a hashed one-time code, never
 * the code itself, and are single-use: a challenge is consumed by the first
 * successful verification and superseded when a new code is requested.
 */
export const ownerChallenges = pgTable("yousivar_owner_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  username: text("username"),
  codeHash: text("code_hash"),
  codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  sends: integer("sends").notNull().default(0),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Owner sessions. Only a SHA-256 hash of the session token is stored, so a
 * database read cannot be replayed as a session.
 */
export const ownerSessions = pgTable("yousivar_owner_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  username: text("username").notNull(),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type OwnerChallenge = typeof ownerChallenges.$inferSelect;
export type OwnerSession = typeof ownerSessions.$inferSelect;

export type ContentItem = typeof contentItems.$inferSelect;
export type NewContentItem = typeof contentItems.$inferInsert;
export type SiteRecord = typeof siteRecords.$inferSelect;
export type AuditEntry = typeof auditEntries.$inferSelect;
export type ApplicationUser = typeof applicationUsers.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
