#!/usr/bin/env node
/**
 * Builds the YOUSIVAR–Ω Android APK, validates the artifact and writes it,
 * together with its SHA-256 checksum, into `dist/<mode>/`.
 *
 *   node scripts/build-android.mjs debug     # installable debug build
 *   node scripts/build-android.mjs release   # release build, signed when
 *                                            # signing credentials are present
 *
 * It is deliberately dependency-free and reports only what it actually
 * verified: an APK that does not exist, is not a ZIP, is missing its manifest
 * or has no dex payload fails the build instead of producing a checksum for
 * something broken. A release build refuses to be called successful while it is
 * unsigned, because an unsigned release cannot be installed.
 *
 * Set YOUSIVAR_APP_URL to point the shell at the deployed site (recommended);
 * without it the build ships the bundled "no application URL configured"
 * screen. See ANDROID_BUILD.md.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = join(projectRoot, 'android');
const mode = process.argv[2];

if (mode !== 'debug' && mode !== 'release') {
  console.error('Usage: node scripts/build-android.mjs <debug|release>');
  process.exit(1);
}

const log = (message) => console.log(`[android:${mode}] ${message}`);

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(' ')}`);
  return execFileSync(command, args, {
    cwd: options.cwd ?? nativeDir,
    stdio: 'inherit',
    env: process.env,
  });
}

function capture(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
}

/** Minimal ZIP reader: lists entry names without shelling out to unzip. */
function listZipEntries(file) {
  const buffer = readFileSync(file);
  const endOfCentralDirectory = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= 0 && offset >= buffer.length - 66_000; offset -= 1) {
    if (buffer.readUInt32LE(offset) === endOfCentralDirectory) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) return null;

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let pointer = buffer.readUInt32LE(eocd + 16);
  const names = [];
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) return null;
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    names.push(buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength));
    pointer += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

function findApksigner() {
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME;
  if (!sdkRoot) return null;
  const buildToolsDir = join(sdkRoot, 'build-tools');
  if (!existsSync(buildToolsDir)) return null;
  const versions = readdirSync(buildToolsDir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  for (const version of versions) {
    const candidate = join(buildToolsDir, version, 'apksigner');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// 1: sync the web assets and plugin configuration into the native project.
// The Capacitor CLI reads capacitor.config.ts from the wrapper root, so it runs
// there; Gradle runs inside the native project below.
run('npx', ['cap', 'sync', 'android'], { cwd: projectRoot });

// 2: build.
const gradleTask = mode === 'debug' ? 'assembleDebug' : 'assembleRelease';
run('./gradlew', [gradleTask, '--no-daemon', '--console=plain']);

// 3: locate the artifact. Gradle names an unsigned release
// `app-release-unsigned.apk`, which is not distributable — catch it here rather
// than publishing a file nobody can install.
const outputsDir = join(nativeDir, 'app', 'build', 'outputs', 'apk', mode);
const produced = existsSync(outputsDir) ? readdirSync(outputsDir).filter((name) => name.endsWith('.apk')) : [];
const apkName = produced.includes(`app-${mode}.apk`)
  ? `app-${mode}.apk`
  : produced.find((name) => name.startsWith(`app-${mode}`));
if (!apkName) {
  console.error(`[android:${mode}] FAILED: no APK was produced in ${outputsDir}`);
  if (produced.length) console.error(`[android:${mode}] found instead: ${produced.join(', ')}`);
  process.exit(1);
}
const apkPath = join(outputsDir, apkName);

if (mode === 'release' && /-unsigned/.test(apkName) && process.env.ALLOW_UNSIGNED_RELEASE !== '1') {
  console.error('[android:release] FAILED: Gradle produced an unsigned APK, which cannot be installed on a device.');
  console.error('[android:release] Configure the signing credentials (see APK_RELEASE.md) or set ALLOW_UNSIGNED_RELEASE=1 for a throwaway build.');
  process.exit(1);
}

// 4: validate that this really is a packaged Android application.
const size = statSync(apkPath).size;
if (size < 512 * 1024) {
  console.error(`[android:${mode}] FAILED: ${apkPath} is only ${size} bytes, which is not a packaged application`);
  process.exit(1);
}
const entries = listZipEntries(apkPath);
if (!entries || entries.length === 0) {
  console.error(`[android:${mode}] FAILED: ${apkPath} is not a readable ZIP/APK archive`);
  process.exit(1);
}
for (const required of ['AndroidManifest.xml', 'classes.dex']) {
  if (!entries.includes(required)) {
    console.error(`[android:${mode}] FAILED: ${required} is missing from the APK`);
    process.exit(1);
  }
}
log(`APK structure verified (${entries.length} entries, manifest and dex present)`);

// 5: signature state — a release must be signed to be installable.
const apksigner = findApksigner();
let signature = 'unknown';
if (apksigner) {
  try {
    const report = capture(apksigner, ['verify', '--print-certs', apkPath], nativeDir);
    signature = /Android Debug/.test(report)
      ? 'debug keystore'
      : `signed (${(report.match(/certificate DN: (.+)/)?.[1] ?? 'unknown signer').trim()})`;
    log(`Signature: ${signature}`);
  } catch (error) {
    signature = 'unsigned';
    log('Signature: unsigned (apksigner reported no valid signature)');
    if (mode === 'release' && process.env.ALLOW_UNSIGNED_RELEASE !== '1') {
      console.error('[android:release] FAILED: this release APK is unsigned and cannot be installed on a device.');
      console.error('[android:release] Provide the signing secrets (see APK_RELEASE.md) or set ALLOW_UNSIGNED_RELEASE=1 for a throwaway build.');
      process.exit(1);
    }
  }
} else {
  log('apksigner not found (ANDROID_SDK_ROOT/build-tools is missing) — signature not verified');
  if (mode === 'release') {
    console.error('[android:release] FAILED: apksigner is required to validate a release build.');
    process.exit(1);
  }
}

// 6: publish the artifact and its checksum.
const outputDir = join(projectRoot, 'dist', mode);
mkdirSync(outputDir, { recursive: true });
const version = /versionName\s+"([^"]+)"/.exec(readFileSync(join(nativeDir, 'app', 'build.gradle'), 'utf8'))?.[1] ?? '0.0.0';
const outputName = `yousivar-omega-${version}-${mode}.apk`;
const outputPath = join(outputDir, outputName);
copyFileSync(apkPath, outputPath);
const checksum = createHash('sha256').update(readFileSync(outputPath)).digest('hex');
writeFileSync(`${outputPath}.sha256`, `${checksum}  ${outputName}\n`);

const summary = {
  mode,
  versionName: version,
  sizeBytes: statSync(outputPath).size,
  sha256: checksum,
  signature,
  builtAt: new Date().toISOString(),
  appUrl: (process.env.YOUSIVAR_APP_URL ?? '').trim() || null,
  packageId: /applicationId\s+"([^"]+)"/.exec(readFileSync(join(nativeDir, 'app', 'build.gradle'), 'utf8'))?.[1] ?? null,
};
writeFileSync(join(outputDir, 'build.json'), `${JSON.stringify(summary, null, 2)}\n`);

log(`artifact: ${outputPath}`);
log(`size: ${summary.sizeBytes} bytes`);
log(`sha256: ${checksum}`);
log(`package: ${summary.packageId} · signature: ${signature}`);
if (!summary.appUrl) {
  log('WARNING: YOUSIVAR_APP_URL was not set, so this build ships the bundled offline screen instead of loading the live site.');
}
