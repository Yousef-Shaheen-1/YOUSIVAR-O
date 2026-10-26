# Android build — YOUSIVAR–Ω

How the installable Android application is built, what it actually contains, and
how to reproduce the build. Release process and signing: [`APK_RELEASE.md`](APK_RELEASE.md).
Hosting and deployment: [`DEPLOYMENT.md`](DEPLOYMENT.md).

## What the Android application is

The Android application is a **Capacitor shell around the deployed web
application**. One codebase, one backend, one database, one owner console — the
shell does not carry a second copy of the catalog or of the business logic.

| | |
| --- | --- |
| Framework | Capacitor 8 (`@capacitor/android`) on the existing React/Vite web app |
| Wrapper project | [`android/`](android) |
| Native Gradle project | [`android/android/`](android/android) — Capacitor's own layout |
| Application ID | `com.yousivar.omega` |
| Application name | `YOUSIVAR–Ω` |
| Version | `android/android/app/build.gradle` → `versionName` / `versionCode` |
| Minimum Android | API 24 (Android 7.0) — `android/android/variables.gradle` |
| Target / compile SDK | API 36 (Android 16) — the level Google Play requires for new apps |
| Permissions | `INTERNET` only |
| Signing | `android/android/app/build.gradle`, credentials from the environment or `android/key.properties` (git-ignored) |

### Why a shell instead of a bundled copy

`YOUSIVAR_APP_URL` decides how the shell behaves:

- **Set (recommended)** — the WebView loads that origin. Visitors see the live
  catalog, owner sign-in works exactly as in a browser, and publishing a project
  or tool never requires a new APK. Sessions and cookies keep working because the
  app and the API stay on one origin.
- **Unset** — the shell shows the bundled screen in [`android/www/`](android/www),
  which states that no application URL was configured. It is deliberately *not* a
  snapshot of the site: a packaged catalog would go stale and its relative
  `/api/...` calls would have no server to reach.

`server.errorPath` points at that same screen, so a lost connection shows a retry
screen rather than a blank WebView.

**Only changes to packaged code need a new build** — the icon, the app name, the
permissions, the shell's own screens, or a Capacitor upgrade. Content, branding
and theme changes ship through the API and appear in the app immediately.

### What the shell does natively

- Obsidian status and navigation bars, splash screen and adaptive launcher icon
  in the project's palette (`app/src/main/res/values/colors.xml`, `styles.xml`,
  `mipmap-*`, `drawable*/splash.png`).
- **External links** open in the system browser — Capacitor's own
  `BridgeWebViewClient` sends any URL whose host or scheme differs from the loaded
  application to an `ACTION_VIEW` intent, so page content never receives native
  privileges. Same-origin navigation stays inside the WebView.
- **Back button** — `MainActivity.onBackPressed()` walks the WebView history
  first, and only sends the task to the background from the application's own
  root, so a mis-tap never discards the session.
- **Keyboard** — `android:windowSoftInputMode="adjustResize"`.
- **Arabic RTL / English LTR**, light-on-dark contrast and system-bar insets come
  from the web application: `viewport-fit=cover` plus `env(safe-area-inset-*)`
  padding in the web stylesheets.

## Prerequisites

- JDK 21
- Android SDK with `platforms;android-36`, `build-tools;36.0.0`, `platform-tools`
  (Gradle downloads the rest)
- Node.js 22
- The Capacitor wrapper dependencies: `cd android && npm install`

Android Studio is not required. `ANDROID_SDK_ROOT` (or `ANDROID_HOME`) must point
at the SDK, or `android/android/local.properties` must contain `sdk.dir=…`
(that file is git-ignored).

## Building

```sh
cd android
npm install

# Debug APK — installable on any device, signed with the debug keystore.
# YOUSIVAR_APP_URL is optional here; without it the build ships the bundled
# "no application URL configured" screen, which is useful for shell checks only.
YOUSIVAR_APP_URL=https://your-deployed-site.example npm run build:debug

# Release APK — signed only when signing credentials are present.
export ANDROID_KEYSTORE_FILE=/absolute/path/release.keystore
export ANDROID_KEYSTORE_PASSWORD=… ANDROID_KEY_ALIAS=… ANDROID_KEY_PASSWORD=…
YOUSIVAR_APP_URL=https://your-deployed-site.example npm run build:release

npm run doctor   # Capacitor's own environment diagnosis
```

`scripts/build-android.mjs` runs `cap sync`, runs Gradle, then **validates the
artifact before publishing it**: the APK must exist, be a readable ZIP, contain
`AndroidManifest.xml` and `classes.dex`, and — for a release — carry a signature.
It writes `android/dist/<mode>/yousivar-omega-<version>-<mode>.apk`,
`…​.apk.sha256` and `build.json` (version, size, checksum, signer, app URL,
package id). An unsigned release build **fails** instead of producing a file that
cannot be installed; `ALLOW_UNSIGNED_RELEASE=1` is available for throwaway checks.

### Building without a local Android SDK (Docker)

The whole toolchain runs in one container; nothing is installed on the host:

```sh
docker run -d --name omega-android -v "$PWD":/work -w /work eclipse-temurin:21-jdk sleep infinity
docker exec omega-android sh -c '
  apt-get update -qq && apt-get install -y -qq unzip curl xz-utils
  curl -sSL -o /tmp/node.tar.gz https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.gz
  tar -xzf /tmp/node.tar.gz -C /opt
  ln -sf /opt/node-v22.23.4-linux-x64/bin/node /usr/local/bin/node
  ln -sf /opt/node-v22.23.4-linux-x64/bin/npm /usr/local/bin/npm
  ln -sf /opt/node-v22.23.4-linux-x64/bin/npx /usr/local/bin/npx
  mkdir -p /opt/android-sdk/cmdline-tools
  curl -sSL -o /tmp/tools.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
  unzip -q /tmp/tools.zip -d /opt/android-sdk/cmdline-tools
  mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/latest
  yes | /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/opt/android-sdk --licenses
  /opt/android-sdk/cmdline-tools/latest/bin/sdkmanager --sdk_root=/opt/android-sdk \
    "platform-tools" "platforms;android-36" "build-tools;36.0.0"
'
echo 'sdk.dir=/opt/android-sdk' > android/android/local.properties
docker exec -w /work/android -e ANDROID_SDK_ROOT=/opt/android-sdk -e JAVA_HOME=/opt/java/openjdk \
  omega-android sh -c 'npm install && npm run build:debug'
```

The APK lands in `android/dist/debug/`. Remove the container with
`docker rm -f omega-android`.

## Tests

```sh
cd android/android
./gradlew testDebugUnitTest            # JVM, no device needed
./gradlew connectedDebugAndroidTest    # requires a device or emulator
```

`app/src/test/java/com/yousivar/omega/ReleaseIdentityTest.java` asserts the
identity the package is built with — application id, semantic `versionName`, a
positive `versionCode`, and the variant under test — so a mistaken version bump or
package rename fails a test instead of shipping.
`app/src/androidTest/java/com/yousivar/omega/PackageIdentityInstrumentedTest.java`
checks the same identity on a running device.

## Continuous integration

[`.github/workflows/android-apk.yml`](.github/workflows/android-apk.yml) builds and
validates both variants, uploads them as workflow artifacts, and publishes a
signed release asset on a `v*` tag. Details and secret names:
[`APK_RELEASE.md`](APK_RELEASE.md).

## Updating the version

1. `android/android/app/build.gradle`: raise `versionName` (user-visible, e.g.
   `1.1.0`) and **increment** `versionCode` — Android refuses an update whose
   version code does not increase.
2. Tag the release `v1.1.0`; the workflow fails if the tag and `versionName`
   disagree.
3. After the APK is published, update the numbers in the console's **Android
   release** page so the website offers the new build.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `SDK location not found` | `ANDROID_SDK_ROOT` is unset and `android/android/local.properties` is missing. |
| `Unsupported class file major version` / Gradle Java error | JDK is not 21. |
| `Gradle build failed … compileSdkVersion` | The SDK platform for the configured compile SDK is not installed. |
| Build succeeds but `FAILED: Gradle produced an unsigned APK` | Signing credentials are absent — see `APK_RELEASE.md`. |
| App opens on "could not reach the site" | The build had no `YOUSIVAR_APP_URL`, or the origin is unreachable/insecure (http is refused). |
| App shows a blank screen | The deployed site failed to load inside the WebView; check the origin in a browser, then `chrome://inspect` with `CAPACITOR_DEBUG=1`. |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | The installed build was signed with a different key. Uninstall it, or sign every release with the same keystore. |
| `App not installed` on device | The APK is unsigned, or the device blocks installs from unknown sources. |

## Not verified here

No Android device or emulator was available in this environment, so the
application was **not** installed or launched on a device, and no on-device check
(rendering, back button, external links, RTL inside the WebView) was performed.
Automated device tests (`android/android/app/src/androidTest`) exist as the
Capacitor template ships them and were not run. What *was* done is documented in
`APK_RELEASE.md`.
