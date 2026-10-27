import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import type { StartupAudio } from '@workspace/api-client-react';

/**
 * Remembered per visitor, not per session: someone who stops the track is never
 * played at again on a later visit, which is the one thing an "optional
 * startup audio" must not get wrong.
 */
const MUTE_KEY = 'yousivar-startup-audio-off';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * The public startup-audio control.
 *
 * It never fights the browser. `play()` is attempted once, and only when the
 * owner asked for it, the visitor has not turned it off and reduced motion is
 * not requested; a refusal (the usual autoplay policy) becomes a visible play
 * button instead of a retry loop. Mute, stop and dismiss are all one click away.
 */
export function StartupAudioPlayer({ audio, rtl = false }: { audio?: StartupAudio | null; rtl?: boolean }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [refused, setRefused] = useState(false);
  const [closed, setClosed] = useState(false);

  const url = audio?.url ?? '';
  const active = Boolean(audio?.enabled && url);

  useEffect(() => {
    if (!active || !audio) return;
    const visitorSaidNo = window.localStorage.getItem(MUTE_KEY) === '1';
    const startMuted = visitorSaidNo || Boolean(audio.muteByDefault);
    setMuted(startMuted);

    const element = ref.current;
    if (!element) return;
    element.volume = Math.min(1, Math.max(0, audio.volume ?? 0.6));
    element.muted = startMuted;

    if (!audio.autoplay || visitorSaidNo || prefersReducedMotion()) {
      setRefused(true);
      return;
    }
    void element
      .play()
      .then(() => { setPlaying(true); setRefused(false); })
      .catch(() => { setPlaying(false); setRefused(true); });
  }, [active, audio]);

  if (!active || !audio || closed) return null;

  const toggle = () => {
    const element = ref.current;
    if (!element) return;
    if (playing) {
      element.pause();
      setPlaying(false);
      window.localStorage.setItem(MUTE_KEY, '1');
      return;
    }
    element.volume = Math.min(1, Math.max(0, audio.volume ?? 0.6));
    element.muted = muted;
    void element
      .play()
      .then(() => { setPlaying(true); setRefused(false); window.localStorage.removeItem(MUTE_KEY); })
      .catch(() => setRefused(true));
  };

  const toggleMute = () => {
    const element = ref.current;
    const next = !muted;
    setMuted(next);
    if (element) element.muted = next;
    if (next) window.localStorage.setItem(MUTE_KEY, '1');
    else window.localStorage.removeItem(MUTE_KEY);
  };

  return (
    <div dir={rtl ? 'rtl' : 'ltr'}
      className={`fixed bottom-4 z-30 flex items-center gap-3 rounded-full border border-[var(--omega-border)] bg-[var(--omega-surface)]/95 px-4 py-2 shadow-2xl backdrop-blur ${rtl ? 'right-4 left-auto' : 'left-4'}`}
      data-testid="startup-audio" data-state={playing ? 'playing' : refused ? 'blocked' : 'ready'}>
      <audio ref={ref} src={url} preload="metadata" loop={false} onEnded={() => setPlaying(false)}/>
      <button type="button" onClick={toggle} aria-label={playing ? 'Stop the startup audio' : 'Play the startup audio'}
        className="grid h-8 w-8 place-items-center rounded-full border border-[var(--omega-border)] text-zinc-200 transition hover:bg-white/10" data-testid="button-startup-audio-toggle">
        {playing ? <Pause size={14}/> : <Play size={14}/>}
      </button>
      <span className="max-w-[190px] truncate text-[11px] text-[var(--omega-muted)]" data-testid="startup-audio-label">
        {refused && !playing ? 'Play the intro' : `${audio.title || 'Startup audio'}${audio.artist ? ` · ${audio.artist}` : ''}`}
      </span>
      <button type="button" onClick={toggleMute} aria-label={muted ? 'Unmute the startup audio' : 'Mute the startup audio'}
        className="text-[var(--omega-muted-soft)] transition hover:text-zinc-100" data-testid="button-startup-audio-mute">
        {muted ? <VolumeX size={15}/> : <Volume2 size={15}/>}
      </button>
      <button type="button" onClick={() => { ref.current?.pause(); setPlaying(false); setClosed(true); }}
        aria-label="Dismiss the audio control" className="text-[var(--omega-muted-faint)] transition hover:text-zinc-200" data-testid="button-startup-audio-dismiss">
        <X size={14}/>
      </button>
    </div>
  );
}
