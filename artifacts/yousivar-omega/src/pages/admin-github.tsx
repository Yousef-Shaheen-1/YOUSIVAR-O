import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Github, GitBranch, KeyRound, Link2Off, LoaderCircle, Search, ShieldCheck } from 'lucide-react';
import {
  getGetGithubIntegrationQueryKey, getListGithubBranchesQueryKey, getListGithubRepositoriesQueryKey,
  useConnectGithubToken, useDisconnectGithub, useGetGithubIntegration, useListGithubBranches,
  useListGithubRepositories, usePreviewGithubImport, usePublishGithubImport, useStartGithubConnect,
} from '@workspace/api-client-react';
import type { GithubImportPreview, GithubRepositorySummary } from '@workspace/api-client-react';
import { Button, Field, Heading, PageLoader, QueryError, Saved, Toggle } from '@/components/admin-ui';

const CATEGORIES = ['repositories', 'tools', 'projects', 'guides'];

/**
 * Owner-only GitHub project integration.
 *
 * Connect, browse what the connection may read, preview the import, and only
 * then publish it into the existing catalog. The access token lives on the
 * server: this page never receives it, and disconnecting deletes it (and asks
 * GitHub to revoke the OAuth grant when the connection came from OAuth).
 */
export default function AdminGithubPage() {
  const qc = useQueryClient();
  const integration = useGetGithubIntegration({ query: { queryKey: getGetGithubIntegrationQueryKey(), retry: false } });
  const startOauth = useStartGithubConnect();
  const connectToken = useConnectGithubToken();
  const disconnect = useDisconnectGithub();
  const previewMutation = usePreviewGithubImport();
  const publishMutation = usePublishGithubImport();

  const [token, setToken] = useState('');
  const [search, setSearch] = useState('');
  const [repository, setRepository] = useState<GithubRepositorySummary | null>(null);
  const [branch, setBranch] = useState('');
  const [preview, setPreview] = useState<GithubImportPreview | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', category: 'repositories', tags: '', publish: false });
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const connected = Boolean(integration.data?.connection.connected);
  const connection = integration.data?.connection;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('github');
    if (result === 'connected') setNotice({ kind: 'ok', text: 'GitHub connected. The access token is stored on the server only.' });
    else if (result === 'error') setNotice({ kind: 'error', text: params.get('reason') ?? 'The GitHub connection did not complete.' });
  }, []);

  const repositories = useListGithubRepositories({
    query: { queryKey: getListGithubRepositoriesQueryKey(), enabled: connected, retry: false },
  });
  const branches = useListGithubBranches(repository?.owner ?? '', repository?.name ?? '', {
    query: { queryKey: getListGithubBranchesQueryKey(repository?.owner ?? '', repository?.name ?? ''), enabled: Boolean(repository), retry: false },
  });

  useEffect(() => {
    if (repository) setBranch(repository.defaultBranch);
  }, [repository]);

  const filtered = useMemo(() => {
    const items = repositories.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(item => item.fullName.toLowerCase().includes(needle) || (item.description ?? '').toLowerCase().includes(needle));
  }, [repositories.data, search]);

  if (integration.isLoading) return <PageLoader/>;
  if (integration.isError) return <QueryError retry={() => integration.refetch()}/>;

  const applyPreview = (data: GithubImportPreview) => {
    setPreview(data);
    setDraft({
      title: data.title,
      description: data.description,
      category: 'repositories',
      tags: data.topics.join(', '),
      publish: false,
    });
  };

  const runPreview = () => {
    if (!repository || !branch) return;
    setNotice(null); setSaved(false);
    previewMutation.mutate({ data: { repository: repository.fullName, branch } }, {
      onSuccess: applyPreview,
      onError: err => setNotice({ kind: 'error', text: err.message }),
    });
  };

  const publish = () => {
    if (!preview) return;
    setNotice(null);
    publishMutation.mutate({
      data: {
        repository: preview.repository, branch: preview.branch, title: draft.title, description: draft.description,
        category: draft.category, tags: draft.tags.split(',').map(tag => tag.trim()).filter(Boolean), publish: draft.publish,
      },
    }, {
      onSuccess: data => {
        setSaved(true);
        setNotice({
          kind: 'ok',
          text: data.record.status === 'published'
            ? `${data.item.title} is published in the catalog.`
            : `${data.item.title} was saved as a draft. Publish it from the content desk when you are ready.`,
        });
        qc.invalidateQueries({ queryKey: getGetGithubIntegrationQueryKey() });
      },
      onError: err => setNotice({ kind: 'error', text: err.message }),
    });
  };

  const connectWithOauth = () => {
    setNotice(null);
    startOauth.mutate(undefined, {
      onSuccess: data => { window.location.href = data.authorizeUrl; },
      onError: err => setNotice({ kind: 'error', text: err.message }),
    });
  };

  const connectWithToken = () => {
    setNotice(null);
    connectToken.mutate({ data: { token: token.trim() } }, {
      onSuccess: () => {
        setToken('');
        setNotice({ kind: 'ok', text: 'GitHub connected with a scoped access token. It is stored encrypted on the server.' });
        qc.invalidateQueries({ queryKey: getGetGithubIntegrationQueryKey() });
      },
      onError: err => setNotice({ kind: 'error', text: err.message }),
    });
  };

  const disconnectAccount = () => {
    setNotice(null);
    disconnect.mutate(undefined, {
      onSuccess: () => {
        setPreview(null); setRepository(null);
        setNotice({ kind: 'ok', text: 'GitHub disconnected and the stored token deleted.' });
        qc.invalidateQueries({ queryKey: getGetGithubIntegrationQueryKey() });
      },
      onError: err => setNotice({ kind: 'error', text: err.message }),
    });
  };

  return <>
    <Heading
      label="Owner console"
      title="GitHub"
      detail="Connect an account, browse its repositories, preview an import and publish it into the existing catalog. Repositories are data here — nothing from them is executed."
      action={<span className="eyebrow inline-flex items-center gap-2 text-[var(--omega-muted-soft)]"><Github size={14}/>{connected ? connection?.account : 'Not connected'}</span>}
    />

    {notice && <p className={`mb-5 whitespace-pre-wrap rounded-2xl border p-4 text-sm ${notice.kind === 'ok' ? 'border-emerald-300/20 bg-emerald-400/[.06] text-emerald-100' : 'border-red-200/20 bg-red-400/[.06] text-red-100'}`} role="status" data-testid="github-notice">{notice.text}</p>}

    <section className="admin-surface mb-5 rounded-2xl p-5 sm:p-7" data-testid="github-connection">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {connected ? <CheckCircle2 size={18} className="mt-0.5 text-emerald-300"/> : <KeyRound size={18} className="mt-0.5 text-[var(--omega-muted-soft)]"/>}
          <div>
            <p className="eyebrow text-[var(--omega-muted-soft)]">Connection</p>
            <p className="mt-2 text-sm text-zinc-200" data-testid="github-account">{connected ? `${connection?.account} · ${connection?.method === 'oauth' ? 'OAuth app' : 'access token'}` : 'No GitHub account is connected.'}</p>
            <p className="mt-1 text-[11px] leading-5 text-[var(--omega-muted-faint)]">
              {connected && connection?.connectedAt ? `Connected ${new Date(connection.connectedAt).toLocaleString()}. ` : ''}
              {connection?.scopes.length ? `Scopes: ${connection.scopes.join(', ')}` : 'Scopes are not reported by GitHub for this token.'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {connected && <Button secondary onClick={disconnectAccount} disabled={disconnect.isPending} testId="button-github-disconnect"><Link2Off size={14}/>{disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}</Button>}
        </div>
      </div>

      {!connected && <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--omega-border)] p-4">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Option 1 · OAuth app</p>
          <p className="mt-3 text-xs leading-6 text-[var(--omega-muted)]">
            {connection?.oauthConfigured
              ? 'Connect through a registered GitHub OAuth app. The minimum scopes are requested.'
              : 'Not configured on this deployment. Set GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET to enable it.'}
          </p>
          <div className="mt-4">
            <Button onClick={connectWithOauth} disabled={!connection?.oauthConfigured || startOauth.isPending} testId="button-github-oauth">
              {startOauth.isPending ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin"/>Preparing…</> : 'Connect with GitHub'}
            </Button>
          </div>
        </div>
        <div className="rounded-xl border border-[var(--omega-border)] p-4">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Option 2 · Scoped access token</p>
          <p className="mt-3 text-xs leading-6 text-[var(--omega-muted)]">Create a token with the fewest scopes you need, paste it here and connect. It is encrypted on the server and never returned to the browser.</p>
          <div className="mt-4 grid gap-3">
            <label className="space-y-2"><span className="eyebrow text-[var(--omega-muted-soft)]">Access token</span>
              <input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} className="w-full rounded-xl border border-[var(--omega-border)] bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-[var(--omega-accent)]/60" data-testid="input-github-token"/>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={connectWithToken} disabled={token.trim().length < 8 || connectToken.isPending} testId="button-github-connect-token">{connectToken.isPending ? 'Verifying…' : 'Connect'}</Button>
              {!connection?.encryptionReady && <span className="text-[11px] text-amber-200">GITHUB_TOKEN_ENCRYPTION_KEY is not configured, so a token cannot be stored.</span>}
            </div>
          </div>
        </div>
      </div>}
    </section>

    {connected && <>
      <section className="admin-surface mb-5 rounded-2xl p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Repositories</p>
          <label className="flex items-center gap-2 rounded-full border border-[var(--omega-border)] px-4 py-2">
            <Search size={14} className="text-[var(--omega-muted-faint)]"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter repositories" className="w-48 bg-transparent text-xs text-zinc-200 outline-none" data-testid="input-github-search"/>
          </label>
        </div>
        {repositories.isLoading ? <div className="mt-4 text-sm text-[var(--omega-muted-soft)]">Reading repositories…</div>
          : repositories.isError ? <QueryError retry={() => repositories.refetch()} message="GitHub could not be reached for the repository list."/>
          : filtered.length === 0 ? <p className="mt-4 text-sm text-[var(--omega-muted-soft)]">This connection cannot read any repository.</p>
          : <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {filtered.slice(0, 60).map(item => <button key={item.id} type="button" onClick={() => { setRepository(item); setPreview(null); }}
                className={`rounded-xl border px-4 py-3 text-left transition ${repository?.fullName === item.fullName ? 'border-[var(--omega-accent)]/40 bg-[var(--omega-accent)]/[.06]' : 'border-[var(--omega-border)] hover:bg-white/[.04]'}`} data-testid={`button-github-repo-${item.fullName}`}>
                <span className="flex items-center justify-between gap-3"><span className="truncate text-sm text-zinc-200">{item.fullName}</span><span className="eyebrow shrink-0 text-[9px] text-[var(--omega-muted-faint)]">{item.private ? 'private' : item.access}</span></span>
                {item.description && <span className="mt-1 block truncate text-xs text-[var(--omega-muted-soft)]">{item.description}</span>}
              </button>)}
            </div>}
      </section>

      {repository && <section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]">
        <div className="admin-surface rounded-2xl p-5 sm:p-7">
          <p className="eyebrow text-[var(--omega-muted-soft)]">Branch</p>
          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-2 text-sm text-zinc-200"><GitBranch size={15} className="text-[var(--omega-muted-soft)]"/>{repository.fullName}</div>
            {branches.isLoading ? <p className="text-xs text-[var(--omega-muted-soft)]">Reading branches…</p>
              : branches.isError ? <QueryError retry={() => branches.refetch()} message="Branches could not be read."/>
              : <label className="space-y-2"><span className="eyebrow text-[var(--omega-muted-soft)]">Import from</span>
                  <select value={branch} onChange={e => setBranch(e.target.value)} className="w-full rounded-xl border border-[var(--omega-border)] bg-[var(--omega-surface)] px-4 py-3 text-sm text-zinc-200" data-testid="select-github-branch">
                    {(branches.data?.branches ?? []).map(name => <option key={name} value={name}>{name}</option>)}
                  </select>
                </label>}
            <Button onClick={runPreview} disabled={!branch || previewMutation.isPending} testId="button-github-preview">{previewMutation.isPending ? 'Reading repository…' : 'Preview import'}</Button>
            <p className="text-[11px] leading-5 text-[var(--omega-muted-faint)]">Reading a repository never publishes anything and never copies its files. Credential-like paths are skipped and listed.</p>
          </div>
        </div>

        <div className="admin-surface rounded-2xl p-5 sm:p-7">
          {!preview ? <p className="text-sm text-[var(--omega-muted-soft)]">Preview a repository to review its metadata, README and file list before publishing.</p> : <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="eyebrow text-[var(--omega-muted-soft)]">Preview · {preview.repository}@{preview.branch}</p>
              {preview.existingContentItemId && <span className="eyebrow text-[9px] text-amber-200">Updates an existing catalog entry</span>}
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="Catalog title" value={draft.title} onChange={v => setDraft(prev => ({ ...prev, title: v }))} testId="input-github-title"/>
              <label className="space-y-2"><span className="eyebrow text-[var(--omega-muted-soft)]">Category</span>
                <select value={draft.category} onChange={e => setDraft(prev => ({ ...prev, category: e.target.value }))} className="w-full rounded-xl border border-[var(--omega-border)] bg-[var(--omega-surface)] px-4 py-3 text-sm text-zinc-200" data-testid="select-github-category">
                  {CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <div className="sm:col-span-2"><Field label="Description" value={draft.description} onChange={v => setDraft(prev => ({ ...prev, description: v }))} multiline testId="input-github-description"/></div>
              <div className="sm:col-span-2"><Field label="Tags · comma separated" value={draft.tags} onChange={v => setDraft(prev => ({ ...prev, tags: v }))} testId="input-github-tags"/></div>
            </div>
            <div className="mt-4"><Toggle label="Publish immediately instead of saving a draft" checked={draft.publish} onChange={v => setDraft(prev => ({ ...prev, publish: v }))} testId="toggle-github-publish"/></div>

            <dl className="mt-5 grid gap-2 text-xs text-[var(--omega-muted)] sm:grid-cols-2">
              <div><dt className="eyebrow text-[var(--omega-muted-faint)]">Language</dt><dd data-testid="github-preview-language">{preview.language ?? 'not reported'}</dd></div>
              <div><dt className="eyebrow text-[var(--omega-muted-faint)]">Stars · forks</dt><dd>{preview.stars} · {preview.forks}</dd></div>
              <div><dt className="eyebrow text-[var(--omega-muted-faint)]">Top-level entries</dt><dd data-testid="github-preview-assets">{preview.assets.length}</dd></div>
              <div><dt className="eyebrow text-[var(--omega-muted-faint)]">README</dt><dd>{preview.readme ? `${preview.readme.length} characters` : 'not present'}</dd></div>
            </dl>

            {preview.skippedSensitive.length > 0 && <div className="mt-4 rounded-xl border border-amber-200/25 bg-amber-300/[.06] p-4" data-testid="github-preview-skipped">
              <div className="flex items-start gap-3"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-amber-200"/>
                <div><p className="text-xs text-amber-50">Skipped as credential-like: {preview.skippedSensitive.join(', ')}</p>
                  <p className="mt-1 text-[11px] text-amber-100/80">These paths are never read or published.</p></div></div>
            </div>}

            {preview.warnings.length > 0 && <ul className="mt-4 space-y-1 text-[11px] leading-5 text-[var(--omega-muted-faint)]" data-testid="github-preview-warnings">
              {preview.warnings.map(warning => <li key={warning} className="flex gap-2"><AlertTriangle size={12} className="mt-1 shrink-0"/>{warning}</li>)}
            </ul>}

            {preview.readme && <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--omega-border)] bg-black/20 p-4 text-xs leading-6 text-zinc-300" data-testid="github-preview-readme">{preview.readme}</pre>}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <Saved pending={publishMutation.isPending} text={saved ? 'Catalog updated' : 'Not published yet'}/>
              <Button onClick={publish} disabled={publishMutation.isPending || !draft.title.trim()} testId="button-github-publish">
                {publishMutation.isPending ? 'Saving…' : draft.publish ? 'Publish to catalog' : 'Save as draft'}
              </Button>
            </div>
          </>}
        </div>
      </section>}

      <section className="admin-surface mt-5 rounded-2xl p-5 sm:p-7">
        <p className="eyebrow text-[var(--omega-muted-soft)]">Import history</p>
        {(integration.data?.imports ?? []).length === 0
          ? <p className="mt-4 text-sm text-[var(--omega-muted-soft)]">No repository has been imported yet.</p>
          : <div className="mt-4 overflow-hidden rounded-xl border border-[var(--omega-border)]" data-testid="github-imports">
              <div className="hidden grid-cols-[1.3fr_.7fr_.7fr_1.4fr] gap-4 bg-white/[.035] px-4 py-3 sm:grid">
                <span className="eyebrow text-[var(--omega-muted-faint)]">Repository</span>
                <span className="eyebrow text-[var(--omega-muted-faint)]">Status</span>
                <span className="eyebrow text-[var(--omega-muted-faint)]">Branch</span>
                <span className="eyebrow text-[var(--omega-muted-faint)]">Validation</span>
              </div>
              <div className="divide-y divide-white/[.07]">
                {(integration.data?.imports ?? []).map(record => <div key={record.id} className="grid gap-2 px-4 py-4 text-xs sm:grid-cols-[1.3fr_.7fr_.7fr_1.4fr] sm:items-center" data-testid={`github-import-${record.id}`}>
                  <span className="text-sm text-zinc-200">{record.repository}</span>
                  <span className={record.status === 'published' ? 'text-emerald-200' : record.status === 'failed' ? 'text-red-300' : 'text-amber-200'}>{record.deploymentStatus}</span>
                  <span className="text-[var(--omega-muted)]">{record.branch}</span>
                  <span className="text-[var(--omega-muted-soft)]">{record.validation.ok ? 'validated' : record.validation.issues.join(' ')}</span>
                </div>)}
              </div>
            </div>}
      </section>
    </>}
  </>;
}
