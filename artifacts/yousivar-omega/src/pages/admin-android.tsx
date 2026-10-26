import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Smartphone } from 'lucide-react';
import {
  getGetAdminSettingsQueryKey, getGetPublicSiteQueryKey, useGetAdminSettings, useUpdateAdminSettings,
} from '@workspace/api-client-react';
import type { AndroidReleaseUpdate, SiteSettingsUpdate } from '@workspace/api-client-react';
import { Button, Field, Heading, PageLoader, QueryError, Saved, Toggle } from '@/components/admin-ui';
import { BUNDLED_APK_PATH, formatBytes, isApkUrl } from '@/lib/android-release';

const DEFAULT_ANDROID: AndroidReleaseUpdate = {
  versionName: '1.0.0',
  versionCode: 1,
  releasedAt: null,
  downloadEnabled: false,
  apkUrl: '',
  apkSizeBytes: 0,
  checksumSha256: '',
  minAndroid: 'Android 7.0 (API 24)',
  releaseNotes: '',
  releaseNotesAr: '',
  debugBuild: true,
};

/**
 * Publishing desk for the Android build. The public download block is driven
 * entirely by what is stored here: it stays off until an APK URL that really
 * ends in `.apk` is saved and downloading is switched on.
 */
export default function AdminAndroidPage() {
  const qc = useQueryClient();
  const settings = useGetAdminSettings({ query: { queryKey: getGetAdminSettingsQueryKey() } });
  const mutation = useUpdateAdminSettings();
  const [form, setForm] = useState<SiteSettingsUpdate | null>(null);
  const [release, setRelease] = useState<AndroidReleaseUpdate>(DEFAULT_ANDROID);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data && !form) {
      setForm({ ...settings.data, accentColor: settings.data.theme.colors.accent });
      setRelease({ ...DEFAULT_ANDROID, ...settings.data.android });
    }
  }, [settings.data, form]);

  if (settings.isLoading || !form) return <PageLoader/>;
  if (settings.isError) return <QueryError retry={() => settings.refetch()}/>;

  const set = (key: keyof AndroidReleaseUpdate, value: unknown) => setRelease(prev => ({ ...prev, [key]: value }));
  const urlReady = isApkUrl(release.apkUrl);

  const save = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setSaved(false);
    const android = { ...release, apkUrl: (release.apkUrl ?? '').trim() };
    mutation.mutate({ data: { ...form, android } }, {
      onSuccess: data => {
        qc.setQueryData(getGetAdminSettingsQueryKey(), data);
        qc.invalidateQueries({ queryKey: getGetPublicSiteQueryKey() });
        setSaved(true);
      },
      onError: err => setError(err.message),
    });
  };

  const useBundledApk = () => setRelease(prev => ({ ...prev, apkUrl: BUNDLED_APK_PATH, debugBuild: true }));

  return <>
    <Heading
      label="Native distribution"
      title="Android release"
      detail="The application identifier, icons, version and signing live in the android/ project. This page publishes whatever artifact that pipeline produced."
      action={<span className="eyebrow inline-flex items-center gap-2 text-[var(--omega-muted-soft)]"><Smartphone size={14}/>{urlReady && release.downloadEnabled ? 'Download block live' : 'Download block hidden'}</span>}
    />
    <form onSubmit={save} className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
      <section className="admin-surface rounded-2xl p-5 sm:p-8">
        <p className="eyebrow text-[var(--omega-muted-soft)]">Release metadata</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Version name" value={release.versionName ?? ''} onChange={v => set('versionName', v)} testId="input-apk-version"/>
          <Field label="Version code" type="number" value={String(release.versionCode ?? 1)} onChange={v => set('versionCode', Number.parseInt(v, 10) || 1)} testId="input-apk-version-code"/>
          <Field label="Release date · YYYY-MM-DD" value={(release.releasedAt ?? '').slice(0, 10)} onChange={v => set('releasedAt', v || null)} testId="input-apk-released"/>
          <Field label="Minimum Android version" value={release.minAndroid ?? ''} onChange={v => set('minAndroid', v)} testId="input-apk-min-android"/>
          <Field label="APK file size · bytes" type="number" value={String(release.apkSizeBytes ?? 0)} onChange={v => set('apkSizeBytes', Number.parseInt(v, 10) || 0)} testId="input-apk-size"/>
          <Field label="SHA-256 checksum" value={release.checksumSha256 ?? ''} onChange={v => set('checksumSha256', v.trim())} testId="input-apk-checksum"/>
          <div className="sm:col-span-2">
            <Field label="APK URL · https://… or /path/file.apk" value={release.apkUrl ?? ''} onChange={v => set('apkUrl', v)} placeholder="/downloads/yousivar-omega-android.apk" testId="input-apk-url"/>
          </div>
          <div className="sm:col-span-2"><Field label="Release notes · English" value={release.releaseNotes ?? ''} onChange={v => set('releaseNotes', v)} multiline testId="input-apk-notes"/></div>
          <div className="sm:col-span-2"><Field label="Release notes · Arabic" value={release.releaseNotesAr ?? ''} onChange={v => set('releaseNotesAr', v)} multiline testId="input-apk-notes-ar"/></div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Toggle label="Offer the download publicly" checked={Boolean(release.downloadEnabled)} onChange={v => set('downloadEnabled', v)} testId="toggle-apk-download"/>
          <Toggle label="This artifact is a debug build" checked={Boolean(release.debugBuild)} onChange={v => set('debugBuild', v)} testId="toggle-apk-debug"/>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={useBundledApk} className="rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs text-zinc-300 hover:bg-white/10" data-testid="button-use-bundled-apk">Use the APK bundled at {BUNDLED_APK_PATH}</button>
          <span className="text-[11px] text-[var(--omega-muted-faint)]">The API rejects anything that is not an https link or a same-site path ending in .apk.</span>
        </div>
        {error && <p className="mt-5 text-sm text-red-300" role="alert">{error}</p>}
        <div className="mt-7 flex items-center justify-between">
          <Saved pending={mutation.isPending} text={saved ? 'Release saved' : 'Unsaved changes'}/>
          <Button type="submit" disabled={mutation.isPending} testId="button-save-release">{mutation.isPending ? 'Saving…' : 'Save release'}</Button>
        </div>
      </section>
      <aside className="space-y-5">
        <section className="admin-surface rounded-2xl p-5 sm:p-6">
          <p className="eyebrow text-[var(--omega-muted-soft)]">What visitors see</p>
          <div className="mt-4 flex items-start gap-3">
            {urlReady && release.downloadEnabled
              ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-300"/>
              : <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-200"/>}
            <p className="text-sm leading-6 text-zinc-300" data-testid="apk-public-state">
              {urlReady && release.downloadEnabled
                ? `The public section offers ${release.versionName || 'the release'} (${formatBytes(release.apkSizeBytes ?? 0)}) with its checksum and installation steps.`
                : 'The public section states that no release is published yet, and offers the web version instead. Nothing broken and no placeholder button.'}
            </p>
          </div>
        </section>
        <section className="admin-surface rounded-2xl p-5 sm:p-6">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Shipping a new version</p>
          <ol className="mt-4 space-y-3 text-xs leading-6 text-[var(--omega-muted)]">
            <li>1 · Raise <code className="text-zinc-300">versionName</code> and <code className="text-zinc-300">versionCode</code> in the android project.</li>
            <li>2 · Push a <code className="text-zinc-300">v*</code> tag; the build workflow produces a signed APK.</li>
            <li>3 · Paste the release asset URL, size and checksum here and publish it.</li>
          </ol>
          <p className="mt-4 text-[11px] leading-5 text-[var(--omega-muted-faint)]">Signing credentials belong in protected build secrets — never in this console or in the repository.</p>
        </section>
      </aside>
    </form>
  </>;
}
