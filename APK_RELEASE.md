# APK release — YOUSIVAR–Ω

How an Android package is produced, signed, published to the website, verified
and rolled back. Building and prerequisites: [`ANDROID_BUILD.md`](ANDROID_BUILD.md).

## The state of the Android release today

A **real APK is built and offered on the website** — it is not a placeholder or a
link to anything else:

| | |
| --- | --- |
| Artifact | [`artifacts/yousivar-omega/public/downloads/yousivar-omega-android.apk`](artifacts/yousivar-omega/public/downloads/yousivar-omega-android.apk) |
| Download URL | `/downloads/yousivar-omega-android.apk` (same site as the web application) |
| Build | **debug** — signed with the Android debug keystore, for internal testing and direct installation |
| Version | 1.0.0 (versionCode 1), `com.yousivar.omega` |
| Size | 4 482 022 bytes |
| SHA-256 | `6ca93a63351ec48356943f2a3536e6882dc90bd9b2694c422f46ec9370c42a73` |
| Minimum Android | 7.0 (API 24); targets API 36 |
| Produced by | `cd android && npm run build:debug` (see `ANDROID_BUILD.md`) |

What that proves: the toolchain builds an installable package, the artifact
contains `AndroidManifest.xml` + `classes.dex` + the launcher resources, the
package/version/permissions are the intended ones, the file is served by the
website with the installer content type, and its checksum matches the one shown
to visitors. Re-running the build reproduces the same package **contents** — every
APK entry identical, down to the CRC — but Gradle does not keep the archive's
member order stable between runs, so a fresh build can hash differently. Read the
checksum from the `build.json` of the build you actually publish, and use the
value of the file you publish: that is what visitors compare against.

What it does **not** prove: the application was never installed or launched —
no Android device or emulator exists in this environment. Nothing here is a
Play Store release, and a debug-signed build is not suitable as a public
distribution build (see *Producing a proper release release* below).

The website's download block is driven by the stored release record
(console → **Android release**). It renders a download button **only** when
`downloadEnabled` is on *and* `apkUrl` points at a real `.apk`; the API rejects
any other value, so a source archive or an HTML page can never be offered as an
application.

## Producing a proper release APK

### 1. Create the signing key (once)

```sh
keytool -genkeypair -v \
  -keystore release.keystore -alias omega \
  -keyalg RSA -keysize 4096 -validity 10000
```

- Store the keystore and its passwords in a password manager **and** a backup
  outside the repository. Losing it means you can never update an installed
  application: Android only accepts an update signed by the same key.
- Never commit the keystore, never put it in a documentation file, never send it
  through chat, and never bundle it in the app.

### 2. Put it in protected CI secrets

Encode the keystore and add four repository (or environment) secrets:

```sh
base64 -w0 release.keystore > release.keystore.b64   # then paste the file's contents
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | base64 of `release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `omega` (or your alias) |
| `ANDROID_KEY_PASSWORD` | key password |

Add them under **Settings → Secrets and variables → Actions** (repository or, for
stronger control, an `android-release` environment with required reviewers, so a
release cannot be signed without an approval). The workflow only ever reads them;
it never echoes them, and it fails with an explicit message when one is missing.
Optionally set a repository **variable** `YOUSIVAR_APP_URL` to the deployed site
so every build points at production without passing an input.

### 3. Tag the release

```sh
# android/android/app/build.gradle: versionName "1.1.0", versionCode 2
git tag v1.1.0 && git push origin v1.1.0
```

`versionCode` must increase for every release. The workflow refuses to publish
when the tag and `versionName` disagree.

### 4. Collect the artifact

- **Workflow artifact:** run **Actions → Android APK** (also triggered by the
  tag); the run's summary lists the build record and the *Artifacts* section
  offers `yousivar-omega-apk-debug` and `yousivar-omega-apk-release`. Artifacts
  require a GitHub sign-in and expire (30 days for debug, 90 for release).
- **GitHub Release:** on a `v*` tag the signed APK, its `.sha256` file and
  `build.json` are attached to the Release, giving a stable public URL such as
  `https://github.com/<owner>/<repo>/releases/download/v1.1.0/yousivar-omega-1.1.0-release.apk`
  — that is the URL to paste into the console.

## Publishing it on the website

1. Sign in to the owner console (the Ω flow) and open **Android release**.
2. Fill in: APK URL (must end in `.apk`), file size in bytes, SHA-256 checksum,
   release date, minimum Android version, release notes (English and Arabic).
   The build record produced by the pipeline prints size and checksum; use those
   values verbatim.
3. Switch **Offer the download publicly** on (leave *debug build* off for a signed
   release) and save.
4. Open the public site: the Android section shows the version, size, date,
   minimum Android, notes, checksum with a copy button, and the installation
   steps, and the button downloads the exact file you published.

Verifying from a shell:

```sh
curl -sI https://your-site.example/downloads/yousivar-omega-android.apk   # 200 + correct length
curl -s  https://your-site.example/downloads/yousivar-omega-android.apk -o a.apk
sha256sum a.apk                       # must equal the checksum on the page
```

## Rollback

- **Immediate:** turn **Offer the download publicly** off and save. The public
  section stops offering the file on the next request — no cache purge, no
  rebuild, no APK change.
- **Restore the previous build:** paste the previous release's URL, size and
  checksum back in and switch the switch on again.
- **A bad *binary* cannot be patched.** Installed applications keep working
  until their owner updates them; publish a new `versionCode` with the fix. Never
  re-use a version code, and never re-upload a different file under the same
  version name — the checksum on the page is the contract visitors compare
  against.
- **A bad shell release** (icon, permissions, Capacitor upgrade): revert the
  merge that introduced it, rebuild from the previous tag, and republish the
  resulting artifact URL.

## Stable hosting options

| Option | Notes |
| --- | --- |
| GitHub Release asset (recommended) | Public, versioned, immutable URL; produced by the workflow. |
| Object storage / CDN | Works with any host; keep the `.apk` extension and serve `application/vnd.android.package-archive`. |
| Committed in the repository | What ships today for the current debug build: `/downloads/yousivar-omega-android.apk`. Simple and always available, at the cost of a ~4 MB binary per rebuild. |

Whatever the host: the URL must end in `.apk` (the API enforces it), it must be
https, and it must be reachable without a session — a visitor downloads the file
from their browser on the site.

## Manual steps and external services still required

1. **Signing secrets** — the four secrets above. Until they exist, tagged builds
   fail by design and only the debug APK is available.
2. **A deployed web origin** — the shell needs `YOUSIVAR_APP_URL` pointing at the
   deployed site (see `DEPLOYMENT.md`). Without it, a build shows the bundled
   "no application URL configured" screen — so a tagged (release) build **fails**
   before it can publish such a placeholder, while a debug build builds it and
   warns.
3. **A host for the release APK** — GitHub Releases needs nothing extra; any other
   host must be reachable publicly.
4. **Play Store distribution** (optional, not attempted here) — a Play Console
   account, an `.aab` upload, store listing assets and a privacy policy, plus an
   **upload key** (Play App Signing handles the distribution key). The pipeline
   can be extended to `bundleRelease`; that is a distribution decision, not a
   technical prerequisite for the APK download on the website.
