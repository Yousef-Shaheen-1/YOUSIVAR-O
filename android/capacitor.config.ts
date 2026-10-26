import type { CapacitorConfig } from '@capacitor/cli';

/**
 * YOUSIVAR–Ω Android shell.
 *
 * The application itself is the deployed web site, which keeps the website and
 * the Android build on one source of truth: the same backend, the same owner
 * console and the same catalog, with no second copy of the business logic.
 *
 * `YOUSIVAR_APP_URL` decides how the shell loads it:
 *
 *  - set  → the WebView loads that origin (recommended). Content, sessions and
 *           owner access behave exactly as in a browser, and publishing new
 *           projects or tools never requires a new APK.
 *  - unset → the shell ships the bundled `www/` screen, which reports that no
 *           application URL was configured. It never shows a stale copy of the
 *           catalog.
 *
 * `server.errorPath` makes the same bundled screen the fallback when the remote
 * site cannot be reached, so a lost connection shows a retry screen instead of
 * a blank WebView.
 */
const appUrl = (process.env.YOUSIVAR_APP_URL ?? '').trim();

const config: CapacitorConfig = {
  appId: 'com.yousivar.omega',
  appName: 'YOUSIVAR–Ω',
  webDir: 'www',
  android: {
    // The palette is obsidian; a white flash between activities would break it.
    backgroundColor: '#101214',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: process.env.CAPACITOR_DEBUG === '1',
  },
  // Only an https origin is accepted: the manifest keeps Android's cleartext
  // default (traffic to http:// is refused), which is what a production site
  // with secure owner sessions needs.
  ...(appUrl
    ? {
        server: {
          url: appUrl,
          androidScheme: 'https',
          errorPath: 'index.html',
        },
      }
    : {}),
};

export default config;
