import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Copy, Plus, ShieldAlert, TerminalSquare, Trash2 } from 'lucide-react';
import {
  getGetTermuxConsoleQueryKey, useConfirmTermuxCommand, useGetTermuxConsole, useUpdateTermuxConsole,
} from '@workspace/api-client-react';
import type { TermuxConsoleUpdate, TermuxEntry } from '@workspace/api-client-react';
import { Button, Field, Heading, PageLoader, QueryError, Saved, Toggle } from '@/components/admin-ui';

const KINDS: TermuxEntry['kind'][] = ['project', 'command', 'script', 'guide'];

export const emptyTermuxEntry = (): TermuxEntry => ({
  id: '', kind: 'command', title: '', titleAr: null, summary: '', command: '',
  documentationUrl: null, requiresRoot: false, requiresStorage: false, enabled: true, notes: null,
});

/**
 * Owner-only Termux console.
 *
 * This page is a catalog editor, not a terminal. The API it calls has no
 * execution route at all — the capability banner states that on screen, and the
 * "Confirm review" action records an audit entry and hands the command back for
 * the owner to run themselves in Termux on their own device.
 */
export default function AdminTermuxPage() {
  const qc = useQueryClient();
  const console_ = useGetTermuxConsole({ query: { queryKey: getGetTermuxConsoleQueryKey(), retry: false } });
  const save = useUpdateTermuxConsole();
  const confirm = useConfirmTermuxCommand();

  const [form, setForm] = useState<TermuxConsoleUpdate | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [output, setOutput] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (console_.data && !form) {
      setForm({ intro: console_.data.intro, introAr: console_.data.introAr, entries: console_.data.entries });
      setSelected(console_.data.entries[0]?.id ?? null);
    }
  }, [console_.data, form]);

  if (console_.isLoading || !form) return <PageLoader/>;
  if (console_.isError || !console_.data) return <QueryError retry={() => console_.refetch()}/>;

  const capability = console_.data.capability;
  const entry = form.entries.find(candidate => candidate.id === selected) ?? null;
  const patch = (index: number, next: Partial<TermuxEntry>) =>
    setForm(prev => prev ? { ...prev, entries: prev.entries.map((item, i) => (i === index ? { ...item, ...next } : item)) } : prev);
  const selectedIndex = form.entries.findIndex(candidate => candidate.id === selected);

  const persist = (event: React.FormEvent) => {
    event.preventDefault();
    setError(''); setSaved(false); setOutput(null);
    save.mutate({ data: form }, {
      onSuccess: data => {
        qc.setQueryData(getGetTermuxConsoleQueryKey(), data);
        setForm({ intro: data.intro, introAr: data.introAr, entries: data.entries });
        setSaved(true);
      },
      onError: err => setError(err.message),
    });
  };

  const reviewCommand = () => {
    if (!entry) return;
    setOutput(null);
    confirm.mutate({ data: { entryId: entry.id, confirmation: true } }, {
      onSuccess: data => {
        setConfirming(false);
        setOutput({ kind: 'ok', text: `${data.message}\n\n${data.command}` });
      },
      onError: err => { setConfirming(false); setOutput({ kind: 'error', text: err.message }); },
    });
  };

  const copyCommand = async () => {
    if (!entry) return;
    try {
      await navigator.clipboard.writeText(entry.command);
      setOutput({ kind: 'ok', text: 'Command copied. Paste it into Termux on your device when you are ready.' });
    } catch {
      setOutput({ kind: 'error', text: 'The browser refused clipboard access. Select the command text and copy it manually.' });
    }
  };

  return <>
    <Heading
      label="Owner console"
      title="Termux"
      detail="Catalogue the Termux projects, commands, scripts and guides you support. Everything here is documentation: this server never executes a command."
      action={<span className="eyebrow inline-flex items-center gap-2 text-[var(--omega-muted-soft)]"><TerminalSquare size={14}/>{form.entries.length} entries</span>}
    />

    <section className="admin-surface mb-5 rounded-2xl p-5 sm:p-7" data-testid="termux-capability">
      <div className="flex items-start gap-3">
        <ShieldAlert size={18} className="mt-0.5 shrink-0 text-amber-200"/>
        <div>
          <p className="eyebrow text-[var(--omega-muted-soft)]">What this deployment can do</p>
          <p className="mt-3 text-sm leading-6 text-zinc-300">{capability.reason}</p>
          <p className="mt-3 text-sm leading-6 text-[var(--omega-muted-soft)]">{capability.localRunHint}</p>
          <p className="mt-3 text-[11px] leading-5 text-[var(--omega-muted-faint)]">
            Executing a command from the browser is impossible here: the Android shell does not open a terminal session either, so no local Termux integration is assumed.
          </p>
        </div>
      </div>
    </section>

    <form onSubmit={persist} className="grid gap-5 xl:grid-cols-[.85fr_1.15fr]">
      <section className="admin-surface rounded-2xl p-5 sm:p-7">
        <div className="flex items-center justify-between">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Catalog</p>
          <button type="button" onClick={() => { const next = emptyTermuxEntry(); setForm(prev => prev ? { ...prev, entries: [...prev.entries, next] } : prev); setSelected(next.id); }}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs text-zinc-200 hover:bg-white/10" data-testid="button-add-termux-entry"><Plus size={13}/>Add entry</button>
        </div>
        <div className="mt-4 grid gap-3">
          <Field label="Introduction · English" value={form.intro} onChange={v => setForm(prev => prev ? { ...prev, intro: v } : prev)} multiline testId="input-termux-intro"/>
          <Field label="Introduction · Arabic" value={form.introAr} onChange={v => setForm(prev => prev ? { ...prev, introAr: v } : prev)} multiline testId="input-termux-intro-ar"/>
        </div>
        <div className="mt-5 space-y-2">
          {form.entries.length === 0 && <p className="rounded-xl border border-dashed border-[var(--omega-border)] px-4 py-8 text-center text-sm text-[var(--omega-muted-soft)]">No Termux entries yet.</p>}
          {form.entries.map((item, index) => (
            <div key={`${item.id}-${index}`} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${item.id === selected ? 'border-[var(--omega-accent)]/40 bg-[var(--omega-accent)]/[.06]' : 'border-[var(--omega-border)]'}`}>
              <button type="button" onClick={() => setSelected(item.id)} className="min-w-0 flex-1 text-left" data-testid={`button-select-termux-${index}`}>
                <span className="block truncate text-sm text-zinc-200">{item.title || item.id || 'Untitled entry'}</span>
                <span className="eyebrow block pt-1 text-[9px] text-[var(--omega-muted-faint)]">{item.kind}{item.enabled ? '' : ' · disabled'}</span>
              </button>
              <button type="button" aria-label={`Remove ${item.title || item.id}`}
                onClick={() => { setForm(prev => prev ? { ...prev, entries: prev.entries.filter((_, i) => i !== index) } : prev); if (item.id === selected) setSelected(null); }}
                className="text-[var(--omega-muted-faint)] hover:text-red-300" data-testid={`button-remove-termux-${index}`}><Trash2 size={15}/></button>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-surface rounded-2xl p-5 sm:p-7">
        {!entry ? <p className="text-sm text-[var(--omega-muted-soft)]">Select an entry to edit it.</p> : <>
          <p className="eyebrow text-[var(--omega-muted-soft)]">Entry</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Identifier · a-z, 0-9, dot, dash" value={entry.id} onChange={v => patch(selectedIndex, { id: v.trim() })} placeholder="termux-setup-storage" testId="input-termux-id"/>
            <label className="space-y-2"><span className="eyebrow text-[var(--omega-muted-soft)]">Kind</span>
              <select value={entry.kind} onChange={e => patch(selectedIndex, { kind: e.target.value as TermuxEntry['kind'] })}
                className="w-full rounded-xl border border-[var(--omega-border)] bg-[var(--omega-surface)] px-4 py-3 text-sm text-zinc-200" data-testid="select-termux-kind">
                {KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </label>
            <Field label="Title · English" value={entry.title} onChange={v => patch(selectedIndex, { title: v })} testId="input-termux-title"/>
            <Field label="Title · Arabic" value={entry.titleAr ?? ''} onChange={v => patch(selectedIndex, { titleAr: v || null })} testId="input-termux-title-ar"/>
            <div className="sm:col-span-2"><Field label="Summary" value={entry.summary} onChange={v => patch(selectedIndex, { summary: v })} multiline testId="input-termux-summary"/></div>
            <div className="sm:col-span-2"><Field label="Command or script" value={entry.command} onChange={v => patch(selectedIndex, { command: v })} multiline testId="input-termux-command"/></div>
            <div className="sm:col-span-2"><Field label="Documentation URL · https://" value={entry.documentationUrl ?? ''} onChange={v => patch(selectedIndex, { documentationUrl: v || null })} testId="input-termux-doc"/></div>
            <div className="sm:col-span-2"><Field label="Owner notes" value={entry.notes ?? ''} onChange={v => patch(selectedIndex, { notes: v || null })} multiline testId="input-termux-notes"/></div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Toggle label="Enabled" checked={entry.enabled} onChange={v => patch(selectedIndex, { enabled: v })} testId="toggle-termux-enabled"/>
            <Toggle label="Requires root" checked={entry.requiresRoot} onChange={v => patch(selectedIndex, { requiresRoot: v })} testId="toggle-termux-root"/>
            <Toggle label="Requires storage access" checked={entry.requiresStorage} onChange={v => patch(selectedIndex, { requiresStorage: v })} testId="toggle-termux-storage"/>
          </div>

          <div className="mt-6 rounded-xl border border-[var(--omega-border)] bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="eyebrow text-[var(--omega-muted-soft)]">Command preview</span>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void copyCommand()} className="inline-flex items-center gap-1 rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs text-zinc-200 hover:bg-white/10" data-testid="button-copy-termux-command"><Copy size={13}/>Copy</button>
                <button type="button" onClick={() => setConfirming(true)} disabled={!entry.command.trim()}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs text-zinc-200 hover:bg-white/10 disabled:opacity-40" data-testid="button-confirm-termux-command"><Check size={13}/>Confirm review</button>
              </div>
            </div>
            <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-zinc-300" data-testid="termux-command-preview">{entry.command || 'Nothing to preview yet.'}</pre>
          </div>

          {confirming && <div className="mt-4 rounded-xl border border-amber-200/25 bg-amber-300/[.06] p-4" role="alertdialog" aria-label="Confirm command review" data-testid="termux-confirm-dialog">
            <div className="flex items-start gap-3"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-200"/>
              <p className="text-sm leading-6 text-amber-50">This records your review of <strong className="font-medium">{entry.title || entry.id}</strong> in the audit trail. It does not run the command and cannot run it.</p></div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={reviewCommand} disabled={confirm.isPending} testId="button-termux-confirm">{confirm.isPending ? 'Recording…' : 'Record the review'}</Button>
              <Button secondary onClick={() => setConfirming(false)} testId="button-termux-cancel">Cancel</Button>
            </div>
          </div>}

          {output && <p className={`mt-4 whitespace-pre-wrap rounded-xl border p-4 text-xs leading-6 ${output.kind === 'ok' ? 'border-emerald-300/20 bg-emerald-400/[.06] text-emerald-100' : 'border-red-200/20 bg-red-400/[.06] text-red-100'}`} role="status" data-testid="termux-output">{output.text}</p>}
        </>}

        {error && <p className="mt-5 text-sm text-red-300" role="alert" data-testid="termux-save-error">{error}</p>}
        <div className="mt-6 flex items-center justify-between">
          <Saved pending={save.isPending} text={saved ? 'Catalog saved' : 'Unsaved changes'}/>
          <Button type="submit" disabled={save.isPending} testId="button-save-termux">{save.isPending ? 'Saving…' : 'Save catalog'}</Button>
        </div>
      </section>
    </form>
  </>;
}
