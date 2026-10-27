import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AudioLines, Play, Upload } from 'lucide-react';
import {
  getGetAdminSettingsQueryKey, getGetPublicSiteQueryKey, useCompleteMediaUpload, useGetAdminSettings,
  useRequestUploadUrl, useUpdateAdminSettings,
} from '@workspace/api-client-react';
import type { SiteSettingsUpdate, StartupAudioUpdate } from '@workspace/api-client-react';
import { Button, Field, Heading, PageLoader, QueryError, Saved, Toggle } from '@/components/admin-ui';

const AUDIO_MAX_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/opus', 'audio/wav', 'audio/x-wav', 'audio/flac', 'audio/webm'];

const EMPTY_AUDIO: StartupAudioUpdate = {
  enabled: false, autoplay: false, muteByDefault: true, volume: 0.6,
  title: '', artist: '', url: '', contentType: '', sizeBytes: 0,
};

/**
 * Owner-only startup-audio settings.
 *
 * Nothing here forces playback: the switches describe what the owner permits,
 * and the public player still has to pass the browser's autoplay policy, the
 * visitor's own mute choice and the reduced-motion preference. The preview
 * below plays locally in this console before anything is saved.
 */
export default function AdminAudioPage() {
  const qc = useQueryClient();
  const settings = useGetAdminSettings({ query: { queryKey: getGetAdminSettingsQueryKey() } });
  const save = useUpdateAdminSettings();
  const requestUrl = useRequestUploadUrl();
  const complete = useCompleteMediaUpload();

  const [form, setForm] = useState<SiteSettingsUpdate | null>(null);
  const [audio, setAudio] = useState<StartupAudioUpdate>(EMPTY_AUDIO);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (settings.data && !form) {
      setForm({ ...settings.data, accentColor: settings.data.theme.colors.accent });
      setAudio({ ...EMPTY_AUDIO, ...settings.data.audio });
    }
  }, [settings.data, form]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.volume = Math.min(1, Math.max(0, audio.volume ?? 0.6));
  }, [audio.volume, audio.url]);

  if (settings.isLoading || !form) return <PageLoader/>;
  if (settings.isError) return <QueryError retry={() => settings.refetch()}/>;

  const set = (key: keyof StartupAudioUpdate, value: unknown) => setAudio(prev => ({ ...prev, [key]: value }));
  const uploadAudio = async (file: File) => {
    setError(''); setSaved(false);
    if (!AUDIO_TYPES.includes(file.type)) {
      setError(`That file type (${file.type || 'unknown'}) is not an accepted audio format.`);
      return;
    }
    if (file.size > AUDIO_MAX_BYTES) {
      setError(`Audio files are limited to ${Math.round(AUDIO_MAX_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    try {
      const signed = await requestUrl.mutateAsync({ data: { name: file.name, size: file.size, contentType: file.type as never } });
      const uploaded = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!uploaded.ok) throw new Error('The storage upload did not complete.');
      const registered = await complete.mutateAsync({ data: { objectPath: signed.objectPath, name: file.name, size: file.size, contentType: file.type } });
      setAudio(prev => ({
        ...prev,
        url: `/api/storage${registered.objectPath}`,
        contentType: file.type,
        sizeBytes: file.size,
        title: prev.title || file.name.replace(/\.[a-z0-9]+$/i, ''),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The audio upload failed.');
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(''); setSaved(false);
    save.mutate({ data: { ...form, audio: { ...audio, url: (audio.url ?? '').trim() } } }, {
      onSuccess: data => {
        qc.setQueryData(getGetAdminSettingsQueryKey(), data);
        qc.invalidateQueries({ queryKey: getGetPublicSiteQueryKey() });
        setSaved(true);
      },
      onError: err => setError(err.message),
    });
  };

  const uploading = requestUrl.isPending || complete.isPending;
  const playable = Boolean(audio.url);

  return <>
    <Heading
      label="Owner console"
      title="Startup audio"
      detail="An optional track for arriving visitors. The site only ever plays it when the browser allows it and the visitor has not turned it off."
      action={<span className="eyebrow inline-flex items-center gap-2 text-[var(--omega-muted-soft)]"><AudioLines size={14}/>{audio.enabled && playable ? 'Offered on load' : 'Silent'}</span>}
    />
    <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <section className="admin-surface rounded-2xl p-5 sm:p-8">
        <p className="eyebrow text-[var(--omega-muted-soft)]">Track</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Title" value={audio.title ?? ''} onChange={v => set('title', v)} testId="input-audio-title"/>
          <Field label="Artist" value={audio.artist ?? ''} onChange={v => set('artist', v)} testId="input-audio-artist"/>
          <div className="sm:col-span-2"><Field label="Audio URL · https:// or /path/file.mp3" value={audio.url ?? ''} onChange={v => set('url', v)} placeholder="/downloads/intro.mp3" testId="input-audio-url"/></div>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs text-zinc-200 hover:bg-white/10">
              <Upload size={13}/>{uploading ? 'Uploading…' : 'Choose an audio file'}
              <input type="file" className="sr-only" accept="audio/*" disabled={uploading}
                onChange={e => { const file = e.target.files?.[0]; if (file) void uploadAudio(file); e.currentTarget.value = ''; }} data-testid="input-audio-upload"/>
            </label>
            <span className="text-[11px] text-[var(--omega-muted-faint)]">Stored through the application's own storage (R2 on Cloudflare). Accepted: {AUDIO_TYPES.map(t => t.replace('audio/', '')).join(', ')} · up to 12 MB.</span>
          </div>
        </div>

        <p className="eyebrow mt-8 text-[var(--omega-muted-soft)]">Playback rules</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Toggle label="Offer the track" checked={Boolean(audio.enabled)} onChange={v => set('enabled', v)} testId="toggle-audio-enabled"/>
          <Toggle label="Attempt playback on load" checked={Boolean(audio.autoplay)} onChange={v => set('autoplay', v)} testId="toggle-audio-autoplay"/>
          <Toggle label="Start muted" checked={Boolean(audio.muteByDefault)} onChange={v => set('muteByDefault', v)} testId="toggle-audio-muted"/>
        </div>
        <div className="mt-5 grid gap-3">
          <label className="space-y-2"><span className="eyebrow text-[var(--omega-muted-soft)]">Volume · {Math.round((audio.volume ?? 0) * 100)}%</span>
            <input type="range" min={0} max={1} step={0.05} value={audio.volume ?? 0} onChange={e => set('volume', Number(e.target.value))}
              className="w-full accent-[var(--omega-accent)]" data-testid="input-audio-volume"/>
          </label>
          <p className="text-[11px] leading-5 text-[var(--omega-muted-faint)]">
            Browsers block audio until a visitor interacts with the page. When playback is refused the site shows a play control instead of trying to work around the policy, and a visitor who stopped the track is never played at again.
          </p>
        </div>

        {error && <p className="mt-5 text-sm text-red-300" role="alert" data-testid="audio-error">{error}</p>}
        <div className="mt-7 flex items-center justify-between">
          <Saved pending={save.isPending} text={saved ? 'Audio settings saved' : 'Unsaved changes'}/>
          <Button type="submit" disabled={save.isPending} testId="button-save-audio">{save.isPending ? 'Saving…' : 'Save settings'}</Button>
        </div>
      </section>

      <aside className="space-y-5">
        <section className="admin-surface rounded-2xl p-5 sm:p-6">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Preview</p>
          {playable
            ? <div className="mt-4 space-y-3">
                <audio ref={previewRef} src={audio.url} controls preload="metadata" className="w-full" data-testid="audio-preview"/>
                <button type="button" onClick={() => { const el = previewRef.current; if (!el) return; el.currentTime = 0; el.volume = Math.min(1, Math.max(0, audio.volume ?? 0.6)); void el.play().catch(() => setError('The browser refused playback until you interact with the page.')); }}
                  className="inline-flex items-center gap-2 rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs text-zinc-200 hover:bg-white/10" data-testid="button-audio-preview"><Play size={13}/>Play the preview</button>
              </div>
            : <p className="mt-4 text-sm text-[var(--omega-muted-soft)]" data-testid="audio-preview-empty">Choose a file or paste a URL to preview the track.</p>}
        </section>
        <section className="admin-surface rounded-2xl p-5 sm:p-6">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Saved state</p>
          <p className="mt-4 text-sm leading-6 text-zinc-300" data-testid="audio-saved-state">
            {audio.enabled && playable
              ? `“${audio.title || 'Untitled'}” is offered${audio.autoplay ? ' with an attempt to play on load' : ' with a play control only'}${audio.muteByDefault ? ', starting muted' : ''}.`
              : 'The site is silent: no track is offered to visitors.'}
          </p>
          <dl className="mt-5 space-y-2 text-[11px] text-[var(--omega-muted-faint)]">
            <div className="flex justify-between gap-3"><dt>Content type</dt><dd>{audio.contentType || 'not set'}</dd></div>
            <div className="flex justify-between gap-3"><dt>Size</dt><dd>{audio.sizeBytes ? `${(audio.sizeBytes / (1024 * 1024)).toFixed(2)} MB` : 'not set'}</dd></div>
            <div className="flex justify-between gap-3"><dt>Last saved</dt><dd>{settings.data?.audio?.updatedAt ? new Date(settings.data.audio.updatedAt).toLocaleString() : 'never'}</dd></div>
          </dl>
        </section>
      </aside>
    </form>
  </>;
}
