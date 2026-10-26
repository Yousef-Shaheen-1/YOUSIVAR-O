import { type ReactNode } from 'react';
import { Check, LoaderCircle } from 'lucide-react';

/**
 * Shared console primitives. They were declared inside `App.tsx`; they live
 * here so a page can be its own file without copying the console's look.
 */
export function PageLoader() {
  return <div className="min-h-[48vh] grid place-items-center text-[var(--omega-muted-soft)]" aria-label="Loading">
    <div className="w-[min(520px,90vw)] space-y-4"><div className="h-3 w-24 animate-pulse rounded bg-white/10"/><div className="h-10 w-2/3 animate-pulse rounded bg-white/10"/><div className="h-24 animate-pulse rounded-2xl bg-white/5"/></div>
  </div>;
}

export function QueryError({ retry, message = 'The service could not respond.' }: { retry: () => void; message?: string }) {
  return <div className="rounded-2xl border border-red-200/20 bg-red-400/[.06] p-6 text-sm text-red-100" role="alert" data-testid="status-error">
    <p>{message}</p><button className="mt-4 rounded-full border border-[var(--omega-border)] px-4 py-2 text-xs hover:bg-white/10" onClick={retry} data-testid="button-retry">Retry</button>
  </div>;
}

export function Saved({ pending, text = 'Changes saved' }: { pending: boolean; text?: string }) {
  return <span className="inline-flex items-center gap-2 text-xs text-[var(--omega-muted)]" aria-live="polite">{pending ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin"/>Saving</> : <><Check className="h-3.5 w-3.5 text-[var(--omega-accent)]"/>{text}</>}</span>;
}

export function Button({ children, onClick, type = 'button', secondary = false, disabled = false, testId, className = '' }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; secondary?: boolean; disabled?: boolean; testId?: string; className?: string }) {
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-[var(--omega-border)] bg-white/[.04] text-zinc-200 hover:bg-white/10' : 'bg-[var(--omega-primary)] text-[var(--omega-background)] hover:bg-[var(--omega-primary-hover)]'} ${className}`}>{children}</button>;
}

export function Field({ label, value, onChange, placeholder, multiline = false, type = 'text', testId }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; type?: string; testId?: string }) {
  const cls = 'w-full rounded-xl border border-[var(--omega-border)] bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-[var(--omega-muted-faint)] focus:border-[var(--omega-accent)]/60 focus:bg-black/30';
  return <label className="block space-y-2"><span className="eyebrow text-[var(--omega-muted-soft)]">{label}</span>{multiline ? <textarea data-testid={testId} className={`${cls} min-h-28 resize-y`} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/> : <input data-testid={testId} className={cls} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/>}</label>;
}

export function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (value: boolean) => void; testId: string }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 rounded-xl border border-[var(--omega-border)] px-4 py-3"><span className="text-sm text-zinc-300">{label}</span><input data-testid={testId} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-[var(--omega-accent)]"/></label>;
}

export function Heading({ label, title, detail, action }: { label: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow text-[var(--omega-secondary)]">{label}</p><h1 className="display mt-2 text-5xl leading-none sm:text-6xl">{title}</h1>{detail&&<p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--omega-muted-soft)]">{detail}</p>}</div>{action}</div>;
}
