import type { AndroidRelease } from '@workspace/api-client-react';

/**
 * Where a packaged application is looked for. The Android build can bundle a
 * signed APK under this path (see APK_RELEASE.md); the owner can also point the
 * release at any hosted .apk URL from the console.
 */
export const BUNDLED_APK_PATH = '/downloads/yousivar-omega-android.apk';

/** Only an https URL or a same-site path, and it must resolve to an .apk file. */
export function isApkUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.startsWith('//') || url.includes('\\')) return false;
  if (url.startsWith('/')) return /\.apk$/i.test(url.split('?')[0] ?? url);
  try {
    return new URL(url).protocol === 'https:' && /\.apk$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * A release is offered for download only when the owner enabled it AND the
 * stored link is a real APK. Anything else — an empty value, a source archive
 * or an HTML page — keeps the public download block off the page.
 */
export function isReleaseDownloadable(release: AndroidRelease | null | undefined): boolean {
  return Boolean(release && release.downloadEnabled && isApkUrl(release.apkUrl));
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** A release date stored as an ISO date, shown in the visitor's own format. */
export function formatReleaseDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

/** Checksums are long and are read a word at a time, so group them. */
export function formatChecksum(value: string): string {
  return value ? value.replace(/(.{8})(?=.)/g, '$1 ') : '';
}
