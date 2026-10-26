import { useEffect, useMemo } from "react";
import { useGetPublicSite } from "@workspace/api-client-react";
import { isSafeAssetUrl, resolveTheme, themeCssText, themeFontFamilies } from "@/lib/theme";

const BASE_FONT_FAMILIES = ["DM Sans", "Instrument Serif", "Space Mono"];

/**
 * Applies the owner-managed visual identity to the running document: palette and
 * type variables, the configured Google Fonts, the favicon and the motion
 * preference. Mounted once, so an owner edit reaches every route.
 */
/** The saved theme, resolved against the shipped defaults. */
export function useSiteTheme() {
  const site = useGetPublicSite();
  return useMemo(() => resolveTheme(site.data?.settings?.theme), [site.data?.settings?.theme]);
}

export function ThemeRuntime() {
  const site = useGetPublicSite();
  const theme = useSiteTheme();
  const reducedMotion = site.data?.settings?.reducedMotion ?? false;

  useEffect(() => {
    const id = "omega-theme-fonts";
    const existing = document.getElementById(id);
    const families = themeFontFamilies(theme).filter((family) => !BASE_FONT_FAMILIES.includes(family));
    if (families.length === 0) {
      existing?.remove();
      return;
    }
    const href = `https://fonts.googleapis.com/css2?${families
      .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@300;400;500;600;700`)
      .join("&")}&display=swap`;
    const link = (existing as HTMLLinkElement | null) ?? document.createElement("link");
    if (!existing) {
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, [theme]);

  useEffect(() => {
    const href = theme.identity.faviconUrl.trim();
    if (!href || !isSafeAssetUrl(href)) return;
    const existing = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const link = existing ?? document.createElement("link");
    if (!existing) {
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [theme.identity.faviconUrl]);

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? "true" : "false";
  }, [reducedMotion]);

  return (
    <style
      id="omega-theme"
      // eslint-disable-next-line react/no-danger -- a stylesheet, not markup
      dangerouslySetInnerHTML={{
        __html: `:root{${themeCssText(theme)}}`,
      }}
    />
  );
}
