/**
 * Optional startup audio.
 *
 * The owner chooses a track and how it may play; the browser decides whether it
 * actually does. Nothing here autoplays — `enabled` plus a real URL is only the
 * owner's permission, and the client still has to pass the browser's autoplay
 * policy, the visitor's own mute choice and the reduced-motion preference.
 */

export type StartupAudio = {
  enabled: boolean;
  autoplay: boolean;
  muteByDefault: boolean;
  volume: number;
  title: string;
  artist: string;
  url: string;
  contentType: string;
  sizeBytes: number;
  updatedAt: string | null;
};

/** Shipped state: nothing uploaded, nothing plays. */
export const DEFAULT_STARTUP_AUDIO: StartupAudio = {
  enabled: false,
  autoplay: false,
  muteByDefault: true,
  volume: 0.6,
  title: "",
  artist: "",
  url: "",
  contentType: "",
  sizeBytes: 0,
  updatedAt: null,
};

/** 12 MiB — comfortably above a full-length track, far below a media library. */
export const AUDIO_MAX_BYTES = 12 * 1024 * 1024;

export const AUDIO_EXTENSIONS = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".oga",
  ".opus",
  ".wav",
  ".flac",
] as const;

export const AUDIO_CONTENT_TYPES = [
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/webm",
] as const;

function pathOf(value: string): string {
  try {
    return new URL(value, "https://yousivar.invalid").pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Same-site path (no protocol-relative form) or an https URL. */
export function isSafeAudioUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function looksLikeAudioUrl(value: string): boolean {
  const path = pathOf(value);
  return AUDIO_EXTENSIONS.some((extension) => path.endsWith(extension));
}

/**
 * The first reason the stored value cannot be published, or null when it can.
 * An empty URL is valid: it means "no track", which the site renders as nothing.
 */
export function audioValidationError(audio: Pick<StartupAudio, "url" | "contentType" | "sizeBytes">): string | null {
  if (!audio.url) return null;
  if (!isSafeAudioUrl(audio.url)) {
    return "The audio source must be an https URL or a same-site path";
  }
  if (!looksLikeAudioUrl(audio.url)) {
    return `The audio source must end in one of ${AUDIO_EXTENSIONS.join(", ")}`;
  }
  if (audio.contentType && !(AUDIO_CONTENT_TYPES as readonly string[]).includes(audio.contentType)) {
    return "The declared content type is not an accepted audio format";
  }
  if (audio.sizeBytes > AUDIO_MAX_BYTES) {
    return `Audio files are limited to ${Math.round(AUDIO_MAX_BYTES / (1024 * 1024))} MB`;
  }
  return null;
}

/** A stored value completed with defaults, for records written before it existed. */
export function mergeStartupAudio(value: Partial<StartupAudio> | null | undefined): StartupAudio {
  if (!value) return DEFAULT_STARTUP_AUDIO;
  const volume = typeof value.volume === "number" && Number.isFinite(value.volume)
    ? Math.min(1, Math.max(0, value.volume))
    : DEFAULT_STARTUP_AUDIO.volume;
  return {
    ...DEFAULT_STARTUP_AUDIO,
    ...value,
    volume,
    url: typeof value.url === "string" ? value.url : "",
  };
}
