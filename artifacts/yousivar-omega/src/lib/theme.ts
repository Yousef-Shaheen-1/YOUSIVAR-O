/**
 * Browser side of the editable visual identity.
 *
 * The API stores the theme; this module turns it into CSS variables that the
 * public site and the console already consume, injects the configured Google
 * Fonts, and keeps the favicon in sync. The fallback below mirrors
 * `artifacts/api-server/src/lib/theme.ts` so the first paint (before
 * `/api/site` answers) never flashes a different palette.
 */
import type { SiteTheme, ThemeColors, ThemeIdentity, ThemeTypography } from "@workspace/api-client-react";

export const FALLBACK_THEME: SiteTheme = {
  colors: {
    background: "#101214",
    surface: "#191B1D",
    surfaceAlt: "#17191B",
    border: "#2B2E30",
    text: "#E9E7E0",
    highlight: "#FFFFFF",
    mutedText: "#A1A2A1",
    mutedSoft: "#71717A",
    mutedFaint: "#52525B",
    accent: "#C7BFAE",
    primary: "#C6BEAC",
    primaryHover: "#DED7C6",
    secondary: "#BDB5A2",
    focusRing: "#C9C0AA",
    glass: "#FFFFFF",
    gradientFrom: "#434546",
    gradientTo: "#131517",
  },
  typography: {
    fontSans: "DM Sans",
    fontSerif: "Instrument Serif",
    fontMono: "Space Mono",
    fontSansAr: "DM Sans",
    fontSerifAr: "Instrument Serif",
    fontMonoAr: "Space Mono",
    baseFontSize: 16,
    bodyLineHeight: 1.75,
    bodyLetterSpacing: 0,
    bodyWeight: 400,
    headingWeight: 400,
  },
  identity: {
    logoMark: "Ω",
    logoUrl: "",
    faviconUrl: "",
    navWork: "Work",
    navWorkAr: "الأعمال",
    navAbout: "About",
    navAboutAr: "نبذة",
    privateConsole: "Private console",
    privateConsoleAr: "لوحة خاصة",
    ctaWork: "Explore selected work",
    ctaWorkAr: "استكشف الأعمال",
    sectionWorkTitle: "Selected work",
    sectionWorkTitleAr: "أعمال مختارة",
  },
};

type StoredTheme = {
  colors?: Partial<ThemeColors> | null;
  typography?: Partial<ThemeTypography> | null;
  identity?: Partial<ThemeIdentity> | null;
} | null | undefined;

export function resolveTheme(theme: StoredTheme): SiteTheme {
  return {
    colors: { ...FALLBACK_THEME.colors, ...(theme?.colors ?? {}) },
    typography: { ...FALLBACK_THEME.typography, ...(theme?.typography ?? {}) },
    identity: { ...FALLBACK_THEME.identity, ...(theme?.identity ?? {}) },
  };
}

export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value.trim());
}

/** Google Fonts family names may only contain letters, digits, spaces and hyphens. */
export function isFontFamilyName(value: string): boolean {
  return value.trim().length > 0 && /^[A-Za-z0-9][A-Za-z0-9 '-]{0,79}$/.test(value.trim());
}

/**
 * Safe destinations for owner-supplied asset URLs: HTTPS or a same-site path.
 * Anything else (http:, javascript:, data:, protocol-relative) is refused.
 */
export function isSafeAssetUrl(value: string): boolean {
  const candidate = value.trim();
  if (!candidate) return true;
  if (candidate.startsWith("/") && !candidate.startsWith("//") && !candidate.includes("\\")) return true;
  try {
    return new URL(candidate).protocol === "https:";
  } catch {
    return false;
  }
}

const cssFontStack = (family: string, fallback: string) =>
  isFontFamilyName(family) ? `'${family.trim()}', ${fallback}` : fallback;

export function themeVariables(theme: SiteTheme): Record<string, string> {
  const { colors, typography } = theme;
  return {
    "--omega-background": colors.background,
    "--omega-surface": colors.surface,
    "--omega-surface-alt": colors.surfaceAlt,
    "--omega-border": colors.border,
    "--omega-text": colors.text,
    "--omega-highlight": colors.highlight,
    "--omega-muted": colors.mutedText,
    "--omega-muted-soft": colors.mutedSoft,
    "--omega-muted-faint": colors.mutedFaint,
    "--omega-accent": colors.accent,
    "--omega-primary": colors.primary,
    "--omega-primary-hover": colors.primaryHover,
    "--omega-secondary": colors.secondary,
    "--omega-focus": colors.focusRing,
    "--omega-glass": colors.glass,
    "--omega-gradient-from": colors.gradientFrom,
    "--omega-gradient-to": colors.gradientTo,
    "--app-font-sans": cssFontStack(typography.fontSans, "sans-serif"),
    "--app-font-serif": cssFontStack(typography.fontSerif, "serif"),
    "--app-font-mono": cssFontStack(typography.fontMono, "monospace"),
    "--app-font-sans-ar": cssFontStack(typography.fontSansAr, "sans-serif"),
    "--app-font-serif-ar": cssFontStack(typography.fontSerifAr, "serif"),
    "--app-font-mono-ar": cssFontStack(typography.fontMonoAr, "monospace"),
    "--omega-base-size": `${typography.baseFontSize}px`,
    "--omega-body-line-height": String(typography.bodyLineHeight),
    "--omega-body-tracking": `${typography.bodyLetterSpacing}em`,
    "--omega-body-weight": String(typography.bodyWeight),
    "--omega-heading-weight": String(typography.headingWeight),
  };
}

export function themeCssText(theme: SiteTheme): string {
  return Object.entries(themeVariables(theme))
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
}

export function themeFontFamilies(theme: SiteTheme): string[] {
  return Array.from(
    new Set(
      [theme.typography.fontSans, theme.typography.fontSerif, theme.typography.fontMono,
        theme.typography.fontSansAr, theme.typography.fontSerifAr, theme.typography.fontMonoAr]
        .map((family) => family.trim())
        .filter(isFontFamilyName),
    ),
  );
}

export const FONT_SUGGESTIONS = [
  "DM Sans", "Instrument Serif", "Space Mono", "Inter", "Manrope", "Sora", "Outfit",
  "Playfair Display", "Cormorant Garamond", "IBM Plex Sans", "IBM Plex Mono",
  "Noto Kufi Arabic", "Noto Naskh Arabic", "Cairo", "Tajawal", "Amiri", "Almarai",
];

export const COLOR_FIELDS: Array<{ key: keyof ThemeColors; label: string; note: string }> = [
  { key: "background", label: "Background", note: "Page canvas" },
  { key: "surface", label: "Surface", note: "Cards and panels" },
  { key: "surfaceAlt", label: "Surface alt", note: "Secondary bands" },
  { key: "border", label: "Border", note: "Dividers and outlines" },
  { key: "text", label: "Text", note: "Primary copy" },
  { key: "highlight", label: "Highlight", note: "Hover and emphasis" },
  { key: "mutedText", label: "Muted text", note: "Supporting copy" },
  { key: "mutedSoft", label: "Muted soft", note: "Captions" },
  { key: "mutedFaint", label: "Muted faint", note: "Footnotes" },
  { key: "accent", label: "Accent", note: "Marks and eyebrows" },
  { key: "primary", label: "Primary", note: "Primary buttons" },
  { key: "primaryHover", label: "Primary hover", note: "Button hover state" },
  { key: "secondary", label: "Secondary", note: "Secondary actions" },
  { key: "focusRing", label: "Focus ring", note: "Keyboard focus" },
  { key: "glass", label: "Glass", note: "Glass and metallic tint" },
  { key: "gradientFrom", label: "Gradient start", note: "Orb highlight" },
  { key: "gradientTo", label: "Gradient end", note: "Orb shadow" },
];

export const THEME_PRESETS: Array<{ id: string; label: string; note: string; colors: ThemeColors }> = [
  {
    id: "atelier",
    label: "Atelier warm",
    note: "The shipped look",
    colors: FALLBACK_THEME.colors,
  },
  {
    id: "neutral",
    label: "Omega neutral",
    note: "The #0A0A0A … #FFFFFF palette",
    colors: {
      background: "#0A0A0A",
      surface: "#121212",
      surfaceAlt: "#191919",
      border: "#4A4A4A",
      text: "#D9D9D9",
      highlight: "#FFFFFF",
      mutedText: "#A6A6A6",
      mutedSoft: "#777777",
      mutedFaint: "#4A4A4A",
      accent: "#A6A6A6",
      primary: "#D9D9D9",
      primaryHover: "#FFFFFF",
      secondary: "#777777",
      focusRing: "#A6A6A6",
      glass: "#FFFFFF",
      gradientFrom: "#262626",
      gradientTo: "#0A0A0A",
    },
  },
  {
    id: "ink",
    label: "Midnight ink",
    note: "Blue-black with a cold accent",
    colors: {
      background: "#070A0F",
      surface: "#0D131C",
      surfaceAlt: "#0A0F17",
      border: "#1E2A38",
      text: "#E3EAF3",
      highlight: "#FFFFFF",
      mutedText: "#93A3B5",
      mutedSoft: "#67788C",
      mutedFaint: "#46566A",
      accent: "#7FB2D9",
      primary: "#9CC7E6",
      primaryHover: "#C2DFF3",
      secondary: "#6E93B3",
      focusRing: "#7FB2D9",
      glass: "#CFE4F5",
      gradientFrom: "#1B2C3F",
      gradientTo: "#070A0F",
    },
  },
];
