import { useState } from 'react';
import { Check, Copy, Download, Github, ShieldCheck, Smartphone } from 'lucide-react';
import type { AndroidRelease } from '@workspace/api-client-react';
import { formatBytes, formatChecksum, formatReleaseDate, isReleaseDownloadable } from '@/lib/android-release';

const STRINGS = {
  en: {
    eyebrow: 'Native application',
    title: (name: string) => `${name} for Android`,
    intro: 'The same catalog, the same owner console and the same backend as this website, packaged as an installable Android application.',
    webNote: 'The web version stays available on any browser and never depends on the Android build.',
    download: 'Download Android APK',
    version: 'Version', size: 'File size', released: 'Released', requires: 'Requires', checksum: 'SHA-256 checksum',
    notes: 'Release notes', install: 'Installation instructions',
    steps: ['Open the downloaded file on your Android device.', 'Allow installation from this source when Android asks.', 'Confirm the install and open the application.', 'Optional: compare the SHA-256 checksum above with the file you downloaded.'],
    debug: 'Debug build · for internal testing',
    signed: 'Signed release build',
    copy: 'Copy', copied: 'Copied',
    pendingTitle: 'Android release is being prepared',
    pendingBody: 'The Android project and its build pipeline live in this repository, but no APK artifact has been published yet, so no download is offered. A download button appears here the moment a real, validated APK exists.',
    pwaTitle: 'Install the website instead',
    pwaBody: 'Your browser can install this site to your home screen. That is a browser installation, not an APK — it always tracks the latest content and needs no update.',
  },
  ar: {
    eyebrow: 'تطبيق أصلي',
    title: (name: string) => `${name} لأندرويد`,
    intro: 'نفس الفهرس ونفس لوحة المالك ونفس الواجهة الخلفية لهذا الموقع، داخل تطبيق أندرويد قابل للتثبيت.',
    webNote: 'تبقى نسخة الويب متاحة على أي متصفح ولا تعتمد على تطبيق أندرويد.',
    download: 'تنزيل تطبيق أندرويد',
    version: 'الإصدار', size: 'حجم الملف', released: 'تاريخ الإصدار', requires: 'يتطلب', checksum: 'بصمة SHA-256',
    notes: 'ملاحظات الإصدار', install: 'خطوات التثبيت',
    steps: ['افتح الملف الذي نزّلته على جهاز أندرويد.', 'اسمح بالتثبيت من هذا المصدر عندما يطلب أندرويد ذلك.', 'أكّد التثبيت ثم افتح التطبيق.', 'اختياري: قارن بصمة SHA-256 أعلاه مع الملف الذي نزّلته.'],
    debug: 'إصدار تجريبي · للاختبار الداخلي',
    signed: 'إصدار موقّع للنشر',
    copy: 'نسخ', copied: 'تم النسخ',
    pendingTitle: 'إصدار أندرويد قيد التجهيز',
    pendingBody: 'مشروع أندرويد وخط الإصدار موجودان داخل هذا المستودع، لكن لم يتم نشر ملف APK بعد، لذلك لا يظهر زر تنزيل. سيظهر هنا فور توفّر ملف APK حقيقي مُتحقّق منه.',
    pwaTitle: 'ثبّت الموقع بدلاً من ذلك',
    pwaBody: 'يمكن لمتصفحك تثبيت هذا الموقع على الشاشة الرئيسية. هذا تثبيت من المتصفح وليس ملف APK — يتبع أحدث محتوى دائماً ولا يحتاج تحديثاً.',
  },
};

function Spec({ label, value }: { label: string; value: string }) {
  return <div className="flex items-baseline justify-between gap-4 border-b border-[var(--omega-border)] py-3 last:border-0"><span className="eyebrow text-[var(--omega-muted-faint)]">{label}</span><span className="text-end text-sm text-zinc-200">{value}</span></div>;
}

/**
 * The public Android download block. It renders a download button only for a
 * release the API describes as downloadable (enabled AND pointing at a real
 * .apk); otherwise it states plainly that no artifact exists yet.
 */
export function AndroidDownload({ release, rtl, projectName }: { release: AndroidRelease | undefined; rtl: boolean; projectName: string }) {
  const [copied, setCopied] = useState(false);
  const text = rtl ? STRINGS.ar : STRINGS.en;
  const downloadable = isReleaseDownloadable(release);
  const notes = (rtl ? release?.releaseNotesAr || release?.releaseNotes : release?.releaseNotes) || '';

  const copyChecksum = async () => {
    if (!release?.checksumSha256) return;
    try {
      await navigator.clipboard.writeText(release.checksumSha256);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard access can be refused; the value is on screen anyway */ }
  };

  return <section id="android" className="mx-auto max-w-[1440px] px-5 py-24 sm:px-10 sm:py-32" dir={rtl ? 'rtl' : 'ltr'}>
    <div className="mb-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
      <div>
        <p className="eyebrow text-[var(--omega-secondary)]">{text.eyebrow}</p>
        <h2 className="display mt-3 text-5xl tracking-tight sm:text-7xl">{text.title(projectName)}</h2>
      </div>
      <p className="max-w-md text-sm leading-7 text-[var(--omega-muted-soft)]">{text.intro}</p>
    </div>
    <div className="grid gap-5 lg:grid-cols-[1fr_.85fr]">
      <div className="rounded-[1.6rem] border border-[var(--omega-border)] bg-[var(--omega-surface)] p-6 sm:p-8">
        <span className="grid h-11 w-11 place-items-center rounded-2xl border border-[var(--omega-border)] bg-white/[.05]"><Smartphone size={18}/></span>
        {downloadable && release ? <>
          <p className="eyebrow mt-8 text-[var(--omega-secondary)]">{release.debugBuild ? text.debug : text.signed}</p>
          <h3 className="display mt-2 text-4xl">{projectName} {release.versionName}</h3>
          <div className="mt-6"><Spec label={text.version} value={release.versionName}/><Spec label={text.size} value={formatBytes(release.apkSizeBytes)}/><Spec label={text.released} value={formatReleaseDate(release.releasedAt)}/><Spec label={text.requires} value={release.minAndroid || '—'}/></div>
          {notes && <div className="mt-6"><p className="eyebrow text-[var(--omega-muted-faint)]">{text.notes}</p><p className="mt-3 whitespace-pre-line text-sm leading-7 text-[var(--omega-muted)]" data-testid="apk-release-notes">{notes}</p></div>}
          {release.checksumSha256 && <div className="mt-6 rounded-xl border border-[var(--omega-border)] bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3"><p className="eyebrow text-[var(--omega-muted-faint)]">{text.checksum}</p><button type="button" onClick={() => void copyChecksum()} className="focus-ring inline-flex items-center gap-2 rounded-full border border-[var(--omega-border)] px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-white/10" data-testid="button-copy-checksum">{copied ? <><Check size={12}/>{text.copied}</> : <><Copy size={12}/>{text.copy}</>}</button></div>
            <code className="mt-3 block break-all font-mono text-[11px] leading-5 text-[var(--omega-muted)]" data-testid="apk-checksum">{formatChecksum(release.checksumSha256)}</code>
          </div>}
        </> : <>
          <p className="eyebrow mt-8 text-[var(--omega-secondary)]">{text.eyebrow}</p>
          <h3 className="display mt-2 text-4xl" data-testid="apk-pending-title">{text.pendingTitle}</h3>
          <p className="mt-4 max-w-xl text-sm leading-7 text-[var(--omega-muted)]" data-testid="apk-pending-body">{text.pendingBody}</p>
        </>}
        <p className="mt-6 text-xs leading-6 text-[var(--omega-muted-faint)]">{text.webNote}</p>
      </div>
      <div className="flex flex-col gap-5">
        {downloadable && release ? <div className="rounded-[1.6rem] border border-[var(--omega-border)] bg-[linear-gradient(135deg,rgba(255,255,255,.06),rgba(255,255,255,.01))] p-6 sm:p-8">
          <a href={release.apkUrl} download rel="noreferrer" className="focus-ring inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-full bg-[var(--omega-primary)] px-6 text-sm font-medium text-[var(--omega-background)] transition hover:bg-[var(--omega-primary-hover)]" data-testid="link-download-apk"><Download size={16}/>{text.download}</a>
          <ol className="mt-7 space-y-3">{text.steps.map((step, index) => <li key={step} className="flex gap-3 text-sm leading-6 text-[var(--omega-muted)]"><span className="eyebrow mt-0.5 text-[var(--omega-muted-faint)]">0{index + 1}</span><span>{step}</span></li>)}</ol>
          <p className="eyebrow mt-7 flex items-center gap-2 text-[var(--omega-muted-faint)]"><ShieldCheck size={13}/>{text.install}</p>
        </div> : <div className="rounded-[1.6rem] border border-[var(--omega-border)] bg-[var(--omega-surface)] p-6 sm:p-8">
          <p className="eyebrow text-[var(--omega-secondary)]">{rtl ? 'خيارات الاستخدام' : 'Ways to use it'}</p>
          <h3 className="mt-3 text-lg text-zinc-200">{text.pwaTitle}</h3>
          <p className="mt-3 text-sm leading-7 text-[var(--omega-muted)]">{text.pwaBody}</p>
          <a href="#work" className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--omega-border)] px-5 py-2.5 text-xs text-zinc-200 hover:bg-white/10" data-testid="link-web-fallback">{rtl ? 'تابع في المتصفح' : 'Continue in the browser'}</a>
          <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-[var(--omega-muted-faint)]"><Github size={12} className="mt-0.5 shrink-0"/>{rtl ? 'خط بناء الإصدار موثّق في المستودع (ANDROID_BUILD.md و APK_RELEASE.md).' : 'The build pipeline is documented in the repository (ANDROID_BUILD.md, APK_RELEASE.md).'}</p>
        </div>}
      </div>
    </div>
  </section>;
}
