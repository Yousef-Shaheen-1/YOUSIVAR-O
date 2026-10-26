/**
 * Editable visual identity (palette, typography, wording).
 *
 * The theme is stored with the rest of the site settings and is consumed by the
 * browser as CSS variables, so an owner edit reaches the public site and the
 * console without a rebuild. Defaults reproduce the shipped look exactly: an
 * untouched workspace renders identically to before this setting existed.
 */

export type ThemeColors = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  highlight: string;
  mutedText: string;
  mutedSoft: string;
  mutedFaint: string;
  accent: string;
  primary: string;
  primaryHover: string;
  secondary: string;
  focusRing: string;
  glass: string;
  gradientFrom: string;
  gradientTo: string;
};

export type ThemeTypography = {
  fontSans: string;
  fontSerif: string;
  fontMono: string;
  fontSansAr: string;
  fontSerifAr: string;
  fontMonoAr: string;
  baseFontSize: number;
  bodyLineHeight: number;
  bodyLetterSpacing: number;
  bodyWeight: number;
  headingWeight: number;
};

export type ThemeIdentity = {
  logoMark: string;
  logoUrl: string;
  faviconUrl: string;
  navWork: string;
  navWorkAr: string;
  navAbout: string;
  navAboutAr: string;
  privateConsole: string;
  privateConsoleAr: string;
  ctaWork: string;
  ctaWorkAr: string;
  sectionWorkTitle: string;
  sectionWorkTitleAr: string;
};

export type SiteTheme = {
  colors: ThemeColors;
  typography: ThemeTypography;
  identity: ThemeIdentity;
};

export const DEFAULT_THEME: SiteTheme = {
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

type PartialTheme = {
  colors?: Partial<ThemeColors> | null;
  typography?: Partial<ThemeTypography> | null;
  identity?: Partial<ThemeIdentity> | null;
};

/**
 * Fills in anything a stored theme is missing. Settings records written before
 * the theme existed, or a palette that gained a colour later, keep working.
 */
export function mergeSiteTheme(stored: PartialTheme | null | undefined): SiteTheme {
  return {
    colors: { ...DEFAULT_THEME.colors, ...(stored?.colors ?? {}) },
    typography: { ...DEFAULT_THEME.typography, ...(stored?.typography ?? {}) },
    identity: { ...DEFAULT_THEME.identity, ...(stored?.identity ?? {}) },
  };
}
