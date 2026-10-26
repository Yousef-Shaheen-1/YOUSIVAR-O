import type { ReactNode } from "react";
import { Palette, RotateCcw, Type, Image as ImageIcon, Wand2 } from "lucide-react";
import type { SiteTheme, ThemeColors, ThemeIdentity, ThemeTypography } from "@workspace/api-client-react";
import {
  COLOR_FIELDS,
  FALLBACK_THEME,
  FONT_SUGGESTIONS,
  THEME_PRESETS,
  isFontFamilyName,
  isHexColor,
  isSafeAssetUrl,
} from "@/lib/theme";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#c7bfae]/60";

function Section({
  icon,
  label,
  title,
  detail,
  action,
  children,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  detail: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="admin-surface rounded-2xl p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[.04]">{icon}</span>
          <div>
            <p className="eyebrow text-zinc-500">{label}</p>
            <h2 className="mt-1 text-lg">{title}</h2>
            <p className="mt-1 max-w-xl text-xs leading-5 text-zinc-600">{detail}</p>
          </div>
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="eyebrow text-zinc-500">{children}</span>;
}

/**
 * Owner-only branding editor: palette, typography and identity. Every control
 * writes into the draft theme the settings form saves through the API, and the
 * preview panel renders the draft immediately.
 */
export function BrandingPanel({
  theme,
  onChange,
}: {
  theme: SiteTheme;
  onChange: (theme: SiteTheme) => void;
}) {
  const setColors = (patch: Partial<ThemeColors>) =>
    onChange({ ...theme, colors: { ...theme.colors, ...patch } });
  const setTypography = (patch: Partial<ThemeTypography>) =>
    onChange({ ...theme, typography: { ...theme.typography, ...patch } });
  const setIdentity = (patch: Partial<ThemeIdentity>) =>
    onChange({ ...theme, identity: { ...theme.identity, ...patch } });

  const colorError = (value: string) => (isHexColor(value) ? "" : "Use a #RRGGBB value");
  const urlError = (value: string) =>
    isSafeAssetUrl(value) ? "" : "Use https:// or a same-site /path";
  const fontError = (value: string) => (isFontFamilyName(value) ? "" : "Enter a font family name");

  const number = (raw: string, min: number, max: number, fallback: number) => {
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const labelRows: Array<{ key: keyof ThemeIdentity; label: string; ar?: boolean }> = [
    { key: "navWork", label: "Work link" },
    { key: "navWorkAr", label: "Work link", ar: true },
    { key: "navAbout", label: "About link" },
    { key: "navAboutAr", label: "About link", ar: true },
    { key: "privateConsole", label: "Console link" },
    { key: "privateConsoleAr", label: "Console link", ar: true },
    { key: "ctaWork", label: "Hero button" },
    { key: "ctaWorkAr", label: "Hero button", ar: true },
    { key: "sectionWorkTitle", label: "Work section title" },
    { key: "sectionWorkTitleAr", label: "Work section title", ar: true },
  ];

  const fontRows: Array<{ key: keyof ThemeTypography; label: string }> = [
    { key: "fontSans", label: "Body · English" },
    { key: "fontSerif", label: "Display · English" },
    { key: "fontMono", label: "Mono · English" },
    { key: "fontSansAr", label: "Body · Arabic" },
    { key: "fontSerifAr", label: "Display · Arabic" },
    { key: "fontMonoAr", label: "Mono · Arabic" },
  ];

  return (
    <div className="space-y-5">
      <Section
        icon={<Palette size={17} />}
        label="Visual identity"
        title="Palette"
        detail="Every surface, border and state colour. Values are applied to the public site and this console as CSS variables."
        action={
          <button
            type="button"
            onClick={() => setColors({ ...FALLBACK_THEME.colors })}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-300 hover:bg-white/10"
            data-testid="button-theme-reset-colors"
          >
            <RotateCcw size={13} />
            Reset palette
          </button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((preset) => {
            const active = Object.entries(preset.colors).every(
              ([key, value]) => theme.colors[key as keyof ThemeColors] === value,
            );
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setColors({ ...preset.colors })}
                aria-pressed={active}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-xs transition ${
                  active ? "border-[#c7bfae]/50 bg-[#c7bfae]/[.08] text-zinc-200" : "border-white/10 text-zinc-500 hover:bg-white/[.05]"
                }`}
                data-testid={`button-theme-preset-${preset.id}`}
              >
                <span className="flex overflow-hidden rounded-md border border-white/10">
                  {[preset.colors.background, preset.colors.surface, preset.colors.accent, preset.colors.text].map((swatch) => (
                    <span key={swatch} className="h-4 w-4" style={{ background: swatch }} />
                  ))}
                </span>
                <span>
                  <span className="block text-zinc-300">{preset.label}</span>
                  <span className="block text-[10px] text-zinc-600">{preset.note}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {COLOR_FIELDS.map((field) => {
            const value = theme.colors[field.key];
            const error = colorError(value);
            return (
              <div key={field.key} className="rounded-xl border border-white/10 bg-black/15 p-3">
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>{field.label}</FieldLabel>
                  <span className="text-[10px] text-zinc-600">{field.note}</span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="color"
                    value={isHexColor(value) ? value : FALLBACK_THEME.colors[field.key]}
                    onChange={(event) => setColors({ [field.key]: event.target.value.toUpperCase() } as Partial<ThemeColors>)}
                    aria-label={`${field.label} colour picker`}
                    className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                    data-testid={`input-theme-color-${field.key}`}
                  />
                  <input
                    value={value}
                    onChange={(event) => setColors({ [field.key]: event.target.value } as Partial<ThemeColors>)}
                    aria-label={`${field.label} hex value`}
                    aria-invalid={Boolean(error)}
                    className={`${inputClass} font-mono text-xs ${error ? "border-red-400/50" : ""}`}
                    data-testid={`input-theme-hex-${field.key}`}
                  />
                </div>
                {error && <p className="mt-2 text-[10px] text-red-300" role="alert">{field.label}: {error}</p>}
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        icon={<Type size={17} />}
        label="Typography"
        title="Type system"
        detail="Google Fonts family names are loaded at runtime. The Arabic families apply whenever the site renders RTL."
        action={
          <button
            type="button"
            onClick={() => setTypography({ ...FALLBACK_THEME.typography })}
            className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-300 hover:bg-white/10"
            data-testid="button-theme-reset-type"
          >
            <RotateCcw size={13} />
            Reset type
          </button>
        }
      >
        <datalist id="omega-font-families">
          {FONT_SUGGESTIONS.map((family) => <option key={family} value={family} />)}
        </datalist>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fontRows.map((row) => {
            const value = theme.typography[row.key] as string;
            const error = fontError(value);
            return (
              <label key={row.key} className="space-y-2">
                <FieldLabel>{row.label}</FieldLabel>
                <input
                  list="omega-font-families"
                  value={value}
                  onChange={(event) => setTypography({ [row.key]: event.target.value } as Partial<ThemeTypography>)}
                  aria-invalid={Boolean(error)}
                  className={`${inputClass} ${error ? "border-red-400/50" : ""}`}
                  data-testid={`input-theme-${row.key}`}
                />
                {error && <span className="block text-[10px] text-red-300" role="alert">{error}</span>}
              </label>
            );
          })}
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-2">
            <FieldLabel>Base size (px)</FieldLabel>
            <input
              type="number" min={14} max={19} step={0.5}
              value={theme.typography.baseFontSize}
              onChange={(event) => setTypography({ baseFontSize: number(event.target.value, 14, 19, theme.typography.baseFontSize) })}
              className={inputClass}
              data-testid="input-theme-baseFontSize"
            />
          </label>
          <label className="space-y-2">
            <FieldLabel>Body line height</FieldLabel>
            <input
              type="number" min={1.2} max={2.2} step={0.05}
              value={theme.typography.bodyLineHeight}
              onChange={(event) => setTypography({ bodyLineHeight: number(event.target.value, 1.2, 2.2, theme.typography.bodyLineHeight) })}
              className={inputClass}
              data-testid="input-theme-bodyLineHeight"
            />
          </label>
          <label className="space-y-2">
            <FieldLabel>Body letter spacing (em)</FieldLabel>
            <input
              type="number" min={-0.05} max={0.2} step={0.005}
              value={theme.typography.bodyLetterSpacing}
              onChange={(event) => setTypography({ bodyLetterSpacing: number(event.target.value, -0.05, 0.2, theme.typography.bodyLetterSpacing) })}
              className={inputClass}
              data-testid="input-theme-bodyLetterSpacing"
            />
          </label>
          <label className="space-y-2">
            <FieldLabel>Body weight</FieldLabel>
            <input
              type="number" min={300} max={700} step={100}
              value={theme.typography.bodyWeight}
              onChange={(event) => setTypography({ bodyWeight: Math.round(number(event.target.value, 300, 700, theme.typography.bodyWeight)) })}
              className={inputClass}
              data-testid="input-theme-bodyWeight"
            />
          </label>
          <label className="space-y-2">
            <FieldLabel>Heading weight</FieldLabel>
            <input
              type="number" min={300} max={800} step={100}
              value={theme.typography.headingWeight}
              onChange={(event) => setTypography({ headingWeight: Math.round(number(event.target.value, 300, 800, theme.typography.headingWeight)) })}
              className={inputClass}
              data-testid="input-theme-headingWeight"
            />
          </label>
        </div>
      </Section>

      <Section
        icon={<ImageIcon size={17} />}
        label="Identity"
        title="Marks and wording"
        detail="Replace the typographic mark with a logo, set the favicon, and rename the public sections and buttons."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-2">
            <FieldLabel>Typographic mark</FieldLabel>
            <input
              value={theme.identity.logoMark}
              maxLength={8}
              onChange={(event) => setIdentity({ logoMark: event.target.value })}
              className={inputClass}
              data-testid="input-theme-logoMark"
            />
          </label>
          <label className="space-y-2 sm:col-span-2">
            <FieldLabel>Logo URL · https or /path</FieldLabel>
            <input
              value={theme.identity.logoUrl}
              onChange={(event) => setIdentity({ logoUrl: event.target.value })}
              placeholder="Leave empty to keep the typographic mark"
              aria-invalid={Boolean(urlError(theme.identity.logoUrl))}
              className={`${inputClass} ${urlError(theme.identity.logoUrl) ? "border-red-400/50" : ""}`}
              data-testid="input-theme-logoUrl"
            />
            {urlError(theme.identity.logoUrl) && <span className="block text-[10px] text-red-300" role="alert">{urlError(theme.identity.logoUrl)}</span>}
          </label>
          <label className="space-y-2 sm:col-span-2">
            <FieldLabel>Favicon URL · https or /path</FieldLabel>
            <input
              value={theme.identity.faviconUrl}
              onChange={(event) => setIdentity({ faviconUrl: event.target.value })}
              placeholder="Leave empty to keep the bundled icon"
              aria-invalid={Boolean(urlError(theme.identity.faviconUrl))}
              className={`${inputClass} ${urlError(theme.identity.faviconUrl) ? "border-red-400/50" : ""}`}
              data-testid="input-theme-faviconUrl"
            />
            {urlError(theme.identity.faviconUrl) && <span className="block text-[10px] text-red-300" role="alert">{urlError(theme.identity.faviconUrl)}</span>}
          </label>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/15 p-3">
            {theme.identity.logoUrl && isSafeAssetUrl(theme.identity.logoUrl) ? (
              <img src={theme.identity.logoUrl} alt="Logo preview" className="h-10 w-10 rounded-lg object-contain" data-testid="preview-theme-logo" />
            ) : (
              <span className="display grid h-10 w-10 place-items-center rounded-lg border border-white/10 text-lg text-zinc-200" data-testid="preview-theme-logo-mark">
                {theme.identity.logoMark || "Ω"}
              </span>
            )}
            <span className="text-[10px] leading-4 text-zinc-600">Asset preview</span>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {labelRows.map((row) => (
            <label key={row.key} className="space-y-2">
              <FieldLabel>{row.label} · {row.ar ? "Arabic" : "English"}</FieldLabel>
              <input
                value={theme.identity[row.key]}
                dir={row.ar ? "rtl" : "ltr"}
                onChange={(event) => setIdentity({ [row.key]: event.target.value } as Partial<ThemeIdentity>)}
                className={inputClass}
                data-testid={`input-theme-${row.key}`}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section
        icon={<Wand2 size={17} />}
        label="Before you save"
        title="Live preview"
        detail="This panel renders the draft palette and type immediately. Nothing reaches the site until you save."
      >
        <div
          className="overflow-hidden rounded-2xl border p-6"
          style={{
            background: theme.colors.background,
            borderColor: theme.colors.border,
            color: theme.colors.text,
            fontFamily: `'${theme.typography.fontSans}', sans-serif`,
            fontSize: `${theme.typography.baseFontSize}px`,
            lineHeight: theme.typography.bodyLineHeight,
            letterSpacing: `${theme.typography.bodyLetterSpacing}em`,
            fontWeight: theme.typography.bodyWeight,
          }}
          data-testid="preview-branding"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="inline-flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-xl border" style={{ borderColor: theme.colors.border, background: theme.colors.surface }}>
                {theme.identity.logoMark || "Ω"}
              </span>
              <span style={{ color: theme.colors.mutedText, letterSpacing: ".17em", textTransform: "uppercase", fontSize: "10px" }}>
                {theme.identity.navWork} · {theme.identity.navAbout}
              </span>
            </span>
            <span
              className="rounded-full px-4 py-2 text-xs"
              style={{ background: theme.colors.primary, color: theme.colors.background }}
            >
              {theme.identity.ctaWork}
            </span>
          </div>
          <p
            className="mt-6 text-3xl"
            style={{ fontFamily: `'${theme.typography.fontSerif}', serif`, fontWeight: theme.typography.headingWeight }}
          >
            {theme.identity.sectionWorkTitle}
          </p>
          <p className="mt-3 text-sm" style={{ color: theme.colors.mutedText }}>
            Supporting copy in the muted tone, over the surface colour below.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <span className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: theme.colors.border, background: theme.colors.surface }}>
              Surface
            </span>
            <span className="rounded-xl border px-4 py-3 text-xs" style={{ borderColor: theme.colors.border, background: theme.colors.surfaceAlt }}>
              Surface alt
            </span>
            <span className="rounded-xl px-4 py-3 text-xs" style={{ background: theme.colors.accent, color: theme.colors.background }}>
              Accent
            </span>
            <span className="rounded-xl px-4 py-3 text-xs" style={{ background: `linear-gradient(135deg, ${theme.colors.gradientFrom}, ${theme.colors.gradientTo})`, color: theme.colors.highlight }}>
              Gradient
            </span>
          </div>
        </div>
      </Section>
    </div>
  );
}

/** Palette values that a draft may hold, exported for the settings form. */
export const FALLBACK_COLORS = FALLBACK_THEME.colors;
