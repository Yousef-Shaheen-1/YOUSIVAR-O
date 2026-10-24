import { createContext, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, AudioLines,
  Bot, Check, Command, FilePlus2,
  Fingerprint, Github, Globe2, Languages, LayoutDashboard, LoaderCircle,
  Menu, Plus, Search, Send, Settings2,
  ShieldCheck, Sparkles, TerminalSquare, Trash2, Users, X, Zap,
} from 'lucide-react';
import {
  getGetAdminIdentityQueryKey, getGetAdminProfileQueryKey, getGetAdminSettingsQueryKey,
  getGetAssistantSettingsQueryKey, getGetPublicSiteQueryKey, getGetAdminSummaryQueryKey,
  getListAdminActivityQueryKey, getListAdminContentQueryKey, getListAdminUsersQueryKey,
  getListAiProvidersQueryKey, getListPublicContentQueryKey, useCompleteMediaUpload,
  useCreateContentItem, useDeleteContentItem, useGetAdminIdentity, useGetAdminProfile,
  useGetAdminSettings, useGetAdminSummary, useGetAssistantSettings, useGetPublicSite,
  useHealthCheck, useImportGithubRepository, useListAdminActivity, useListAdminContent,
  useListAdminUsers, useListAiProviders, useListPublicContent, useRequestUploadUrl,
  useSendAssistantMessage, useSetContentItemPublished, useUpdateAdminProfile,
  useUpdateAdminSettings, useUpdateAdminUserRole, useUpdateAiProvider,
  useUpdateAssistantSettings, useUpdateContentItem,
} from '@workspace/api-client-react';
import type {
  AdminUserRoleUpdate, AssistantSettingsUpdate, ContentItem, ContentItemInput,
  DeveloperProfileInput, SiteSettingsUpdate,
} from '@workspace/api-client-react';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
type Locale = 'en' | 'ar';
const LocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void } | null>(null);
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const saved = localStorage.getItem('yousivar-locale');
    return saved === 'ar' ? 'ar' : 'en';
  });
  const setLocale = (next: Locale) => {
    setLocaleState(next);
    localStorage.setItem('yousivar-locale', next);
  };
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}
function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error('LocaleProvider is required');
  return context;
}

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#bfb7a5', colorForeground: '#ebe9e3', colorMutedForeground: '#a1a2a1',
    colorDanger: '#d27870', colorBackground: '#1c1e20', colorInput: '#252729',
    colorInputForeground: '#ece9e1', colorNeutral: '#414345', fontFamily: 'DM Sans, sans-serif', borderRadius: '12px',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#1c1e20] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#393b3d]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#efede6] font-medium', headerSubtitle: 'text-[#a4a4a1]',
    socialButtonsBlockButtonText: 'text-[#e7e4dc]', formFieldLabel: 'text-[#d4d1c9]',
    footerActionLink: 'text-[#d4c8a9]', footerActionText: 'text-[#aaa9a5]', dividerText: 'text-[#aaa9a5]',
    identityPreviewEditButton: 'text-[#d4c8a9]', formFieldSuccessText: 'text-[#c9d0c3]',
    alertText: 'text-[#e4a39a]', logoBox: 'mx-auto', logoImage: 'rounded-xl',
    socialButtonsBlockButton: 'border border-[#444648] bg-[#252729] hover:bg-[#303234]',
    formButtonPrimary: 'bg-[#c2baa8] text-[#1d1e1f] hover:bg-[#d6cebd]',
    formFieldInput: 'bg-[#252729] border-[#444648] text-[#f0ede5]',
    footerAction: 'border-t border-[#393b3d]', dividerLine: 'bg-[#414345]',
    alert: 'border-[#653b39] bg-[#2a1e1d]', otpCodeFieldInput: 'bg-[#252729] border-[#444648]',
    formFieldRow: 'gap-2', main: 'gap-5',
  },
};

function PageLoader() {
  return <div className="min-h-[48vh] grid place-items-center text-zinc-500" aria-label="Loading">
    <div className="w-[min(520px,90vw)] space-y-4"><div className="h-3 w-24 animate-pulse rounded bg-white/10"/><div className="h-10 w-2/3 animate-pulse rounded bg-white/10"/><div className="h-24 animate-pulse rounded-2xl bg-white/5"/></div>
  </div>;
}
function QueryError({ retry, message = 'The service could not respond.' }: { retry: () => void; message?: string }) {
  return <div className="rounded-2xl border border-red-200/20 bg-red-400/[.06] p-6 text-sm text-red-100" role="alert" data-testid="status-error">
    <p>{message}</p><button className="mt-4 rounded-full border border-white/15 px-4 py-2 text-xs hover:bg-white/10" onClick={retry} data-testid="button-retry">Retry</button>
  </div>;
}
function Saved({ pending, text = 'Changes saved' }: { pending: boolean; text?: string }) {
  return <span className="inline-flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">{pending ? <><LoaderCircle className="h-3.5 w-3.5 animate-spin"/>Saving</> : <><Check className="h-3.5 w-3.5 text-[#c5bda9]"/>{text}</>}</span>;
}
function Button({ children, onClick, type = 'button', secondary = false, disabled = false, testId, className = '' }: { children: ReactNode; onClick?: () => void; type?: 'button' | 'submit'; secondary?: boolean; disabled?: boolean; testId?: string; className?: string }) {
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={`focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${secondary ? 'border border-white/15 bg-white/[.04] text-zinc-200 hover:bg-white/10' : 'bg-[#c6beac] text-[#191a1b] hover:bg-[#ded7c6]'} ${className}`}>{children}</button>;
}
function Field({ label, value, onChange, placeholder, multiline = false, type = 'text', testId }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; multiline?: boolean; type?: string; testId?: string }) {
  const cls = 'w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#c7bfae]/60 focus:bg-black/30';
  return <label className="block space-y-2"><span className="eyebrow text-zinc-500">{label}</span>{multiline ? <textarea data-testid={testId} className={`${cls} min-h-28 resize-y`} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/> : <input data-testid={testId} className={cls} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}/>}</label>;
}
function Toggle({ label, checked, onChange, testId }: { label: string; checked: boolean; onChange: (value: boolean) => void; testId: string }) {
  return <label className="flex cursor-pointer items-center justify-between gap-5 rounded-xl border border-white/10 px-4 py-3"><span className="text-sm text-zinc-300">{label}</span><input data-testid={testId} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="h-4 w-4 accent-[#c8c0ae]"/></label>;
}

function Home() {
  const site = useGetPublicSite();
  const content = useListPublicContent({ limit: 60, offset: 0 });
  const { locale, setLocale } = useLocale();
  const rtl = locale === 'ar';
  const settings = site.data?.settings;
  const profile = site.data?.profile;
  const items = content.data ?? [];
  const selected = (en?: string | null, ar?: string | null) => (rtl ? ar || en : en || ar) || '';
  useEffect(() => {
    if (!localStorage.getItem('yousivar-locale') && settings?.defaultLocale) {
      setLocale(settings.defaultLocale);
    }
  }, [settings?.defaultLocale]);
  const changeLocale = () => setLocale(rtl ? 'en' : 'ar');
  return <main className="grain min-h-[100dvh] bg-[#101214] text-[#e9e7e0]" dir={rtl ? 'rtl' : 'ltr'}>
    <header className="relative z-10 mx-auto flex max-w-[1440px] items-center justify-between px-5 py-6 sm:px-10">
      <Link href="/" className="flex items-center gap-3 text-zinc-100" data-testid="link-home"><span className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/[.04] font-serif text-lg">Ω</span><span className="eyebrow hidden sm:block">YOUSIVAR–Ω</span></Link>
      <nav className="flex items-center gap-3 sm:gap-7"><a href="#work" className="eyebrow text-zinc-400 transition hover:text-white">{rtl ? 'الأعمال' : 'Work'}</a><a href="#about" className="eyebrow text-zinc-400 transition hover:text-white">{rtl ? 'نبذة' : 'About'}</a>
        <button onClick={changeLocale} className="focus-ring inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10" data-testid="button-locale"><Languages size={14}/>{rtl ? 'EN' : 'عربي'}</button>
        <Link href="/admin" className="eyebrow hidden text-zinc-500 transition hover:text-[#d8cfbb] md:block" data-testid="link-admin">Private console <ArrowUpRight className="ml-1 inline h-3 w-3"/></Link>
      </nav>
    </header>
    <section className="relative mx-auto grid min-h-[82vh] max-w-[1440px] items-center overflow-hidden px-5 pb-24 pt-10 sm:px-10 lg:grid-cols-[1.15fr_.85fr]">
      <div className="absolute right-[8%] top-[14%] h-[460px] w-[460px] rounded-full bg-[radial-gradient(circle,rgba(190,185,171,.12),transparent_68%)] blur-2xl"/>
      <div className="relative z-[1] max-w-4xl rise">
        <p className="eyebrow mb-8 flex items-center gap-3 text-[#bdb5a2]"><span className="h-px w-8 bg-[#bdb5a2]/60"/>Independent systems / digital craft</p>
        {site.isLoading ? <div className="h-36 w-4/5 animate-pulse rounded-xl bg-white/10"/> : site.isError ? <QueryError retry={() => site.refetch()} message="The site profile is temporarily unavailable."/> : <>
          <h1 className="display max-w-5xl text-[clamp(4rem,10vw,9.7rem)] leading-[.83] tracking-[-.045em] text-[#ebe9e2]">{selected(settings?.projectName, settings?.projectNameAr) || 'YOUSIVAR'}<span className="block pl-[.14em] text-[#aaa99f]">{rtl ? 'مختبر رقمي' : 'Digital atelier'}<span className="text-[#c5bda9]">.</span></span></h1>
          <p className="mt-9 max-w-xl text-base leading-7 text-zinc-400 sm:text-lg">{selected(settings?.tagline, settings?.taglineAr) || 'A private command center for ideas, experiments, and systems.'}</p>
        </>}
        <div className="mt-10 flex flex-wrap items-center gap-4"><a href="#work" className="group inline-flex items-center gap-3 rounded-full bg-[#c6beac] px-6 py-3 text-sm font-medium text-[#1b1c1d] transition hover:bg-[#ded7c6]">{rtl ? 'استكشف الأعمال' : 'Explore selected work'}<ArrowDownRight className="h-4 w-4 transition group-hover:translate-x-1 group-hover:translate-y-1"/></a><span className="eyebrow text-zinc-600">01 — 04 / selected work</span></div>
      </div>
      <div className="relative mt-12 flex min-h-[350px] items-center justify-center lg:mt-0">
        <div className="relative aspect-square w-[min(76vw,500px)] rounded-[2.6rem] border border-white/10 bg-[radial-gradient(ellipse_at_50%_45%,#434546_0%,#222527_40%,#131517_76%)] p-7 shadow-[0_50px_120px_rgba(0,0,0,.5)]">
          <div className="absolute inset-4 rounded-[2rem] border border-white/[.07]"/>
          <div className="absolute inset-[17%] rotate-[-17deg] rounded-[40%] border border-white/[.16] shadow-[inset_0_0_50px_rgba(255,255,255,.035)]"/>
          <div className="absolute inset-[25%] rotate-[22deg] rounded-[40%] border border-[#c8c0ae]/30"/>
          <div className="absolute inset-[34%] rotate-[-8deg] rounded-[40%] border border-white/25 bg-[linear-gradient(135deg,rgba(255,255,255,.13),rgba(255,255,255,.005)_55%,rgba(255,255,255,.09))] shadow-[inset_8px_8px_24px_rgba(255,255,255,.12),0_20px_50px_rgba(0,0,0,.3)] backdrop-blur-sm"/>
          <div className="absolute inset-0 grid place-items-center"><span className="display text-[clamp(5rem,12vw,9rem)] text-[#e8e5dc]/90">Ω</span></div>
          <span className="eyebrow absolute bottom-8 left-8 text-zinc-500">FORM / FUNCTION / FREEDOM</span><span className="absolute right-8 top-8 h-2 w-2 rounded-full bg-[#cfc5ad] shadow-[0_0_16px_rgba(207,197,173,.5)]"/>
        </div>
      </div>
    </section>
    <div className="mx-auto max-w-[1440px] px-5 sm:px-10"><div className="h-px bg-white/10"/></div>
    <section id="work" className="mx-auto max-w-[1440px] px-5 py-24 sm:px-10 sm:py-32">
      <div className="mb-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-end"><div><p className="eyebrow text-[#bdb5a2]">A living index</p><h2 className="display mt-3 text-5xl tracking-tight sm:text-7xl">{rtl ? 'أعمال مختارة' : 'Selected work'}</h2></div><span className="eyebrow text-zinc-500">{items.length.toString().padStart(2, '0')} / published objects</span></div>
      {content.isLoading ? <div className="grid gap-4 sm:grid-cols-2">{[1,2,3,4].map(n=><div key={n} className="h-64 animate-pulse rounded-2xl bg-white/[.04]"/> )}</div> : content.isError ? <QueryError retry={() => content.refetch()}/> : items.length === 0 ? <div className="rounded-3xl border border-white/10 py-20 text-center text-zinc-500"><TerminalSquare className="mx-auto mb-4 h-8 w-8"/>{rtl ? 'لا يوجد محتوى منشور بعد' : 'No published work yet'}</div> : <div className="grid gap-4 sm:grid-cols-2">
        {items.map((item, index) => <article key={item.id} data-testid={`card-content-${item.id}`} className={`group relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#191b1d] p-6 transition duration-300 hover:-translate-y-1 hover:border-white/20 sm:p-8 ${index === 0 ? 'sm:row-span-2 sm:min-h-[500px]' : 'min-h-[230px]'}`}>
          <div className="absolute inset-0 opacity-60 transition duration-500 group-hover:opacity-100" style={{ background: `radial-gradient(circle at ${index % 2 ? '85% 20%' : '10% 90%'}, rgba(186,181,166,.10), transparent 46%)` }}/>
          <div className="relative flex h-full flex-col"><div className="flex items-center justify-between"><span className="eyebrow text-[#bdb5a2]">{item.category}</span><span className="eyebrow text-zinc-600">0{index+1}</span></div>
            {item.media?.length>0&&<div className="mt-5 grid gap-3 sm:grid-cols-2">{item.media.map((asset,mediaIndex)=><div key={`${asset.url}-${mediaIndex}`} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">{asset.kind==='video'?<video src={asset.url} controls preload="metadata" className="max-h-72 w-full"/>:asset.kind==='audio'?<audio src={asset.url} controls preload="metadata" className="w-full p-3"/>:<img src={asset.url} alt={asset.alt||selected(item.title,item.titleAr)} loading="lazy" className="max-h-72 w-full object-cover"/>}</div>)}</div>}
            <div className="mt-auto pt-16"><h3 className="display text-4xl leading-[.95] sm:text-5xl">{selected(item.title, item.titleAr)}</h3><p className="mt-4 max-w-lg text-sm leading-6 text-zinc-400">{selected(item.description, item.descriptionAr)}</p><div className="mt-6 flex flex-wrap gap-2">{item.tags.map(tag=><span key={tag} className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-zinc-500">{tag}</span>)}</div>
            {(item.actions.length > 0 || !!item.url) && <div className="mt-8 flex flex-wrap gap-3">{item.actions.map((action, ai)=><a key={`${action.url}-${ai}`} href={action.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-200 hover:bg-white/10">{selected(action.label, action.labelAr)}<ArrowUpRight size={13}/></a>)}{item.url && !item.actions.length && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-200 hover:bg-white/10">Open project<ArrowUpRight size={13}/></a>}</div>}
          </div></div>
        </article>)}
      </div>}
    </section>
    <section id="about" className="border-y border-white/10 bg-[#17191b]">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 py-24 sm:px-10 lg:grid-cols-[.65fr_1.35fr] lg:py-32">
        <div><p className="eyebrow text-[#bdb5a2]">The person behind the system</p><div className="mt-8 aspect-[4/5] max-w-[330px] overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(ellipse_at_50%_35%,#686966,#292b2d_56%,#191b1d)]">
          {profile?.portraitUrl ? <img src={profile.portraitUrl} alt={selected(profile.name, profile.nameAr)} className="h-full w-full object-cover grayscale"/> : <div className="grid h-full place-items-center"><span className="display text-8xl text-white/40">{profile?.name?.slice(0,1) || 'Y'}</span></div>}
        </div></div>
        <div className="flex flex-col justify-center"><h2 className="display text-6xl sm:text-8xl">{selected(profile?.name, profile?.nameAr) || 'A maker of systems'}</h2><p className="mt-8 max-w-3xl whitespace-pre-line text-base leading-8 text-zinc-400 sm:text-lg">{selected(profile?.biography, profile?.biographyAr) || (site.isLoading ? 'Loading profile…' : '')}</p>
          <div className="mt-9 flex flex-wrap gap-2">{(profile?.skills ?? []).map(skill=><span key={skill} className="rounded-full border border-white/10 px-4 py-2 text-xs text-zinc-400">{skill}</span>)}</div>
          <div className="mt-10 flex flex-wrap gap-3">{(profile?.socials ?? []).filter(s=>s.visible).map(s=><a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-300 hover:bg-white/10">{s.label}<ArrowUpRight size={13}/></a>)}</div>
        </div>
      </div>
    </section>
    <section className="mx-auto max-w-[1440px] px-5 py-24 sm:px-10 sm:py-32"><div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end"><div><p className="eyebrow text-[#bdb5a2]">Architecture, with a point of view</p><h2 className="display mt-5 max-w-4xl text-5xl leading-[.95] sm:text-7xl">A precise surface.<br/><span className="text-zinc-500">A curious engine.</span></h2></div><p className="max-w-sm text-sm leading-7 text-zinc-500">YOUSIVAR–Ω is a public window into an evolving body of work, and a private workspace for the person building it.</p></div>
      <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-3">{[['01','Independent by design','Private tools, public proof.'],['02','Built to evolve','Content and identity belong to their owner.'],['03','Made for the long run','A focused system, not another feed.']].map(([n,t,d])=><div key={n} className="bg-[#101214] p-7 sm:p-9"><span className="eyebrow text-[#bdb5a2]">{n}</span><h3 className="mt-8 text-lg text-zinc-200">{t}</h3><p className="mt-2 text-sm text-zinc-500">{d}</p></div>)}</div>
    </section>
    <footer className="border-t border-white/10 px-5 py-8 sm:px-10"><div className="mx-auto flex max-w-[1440px] flex-col justify-between gap-4 text-xs text-zinc-600 sm:flex-row"><span className="eyebrow">YOUSIVAR–Ω / PRIVATE BY NATURE</span><span>© {new Date().getFullYear()} · Built with clarity.</span></div></footer>
  </main>;
}

const navigation = [
  { href: '/admin', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin/content', label: 'Content', icon: FilePlus2 },
  { href: '/admin/profile', label: 'Profile', icon: Fingerprint },
  { href: '/admin/settings', label: 'Settings', icon: Settings2 },
  { href: '/admin/ai', label: 'AI studio', icon: Bot },
  { href: '/admin/users', label: 'Access', icon: Users },
  { href: '/admin/activity', label: 'Activity', icon: Activity },
];
function AdminShell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  const [open, setOpen] = useState(false);
  const { locale, setLocale } = useLocale();
  const rtl = locale === 'ar';
  return <div dir={rtl ? 'rtl' : 'ltr'} className="grain min-h-[100dvh] bg-[#101214] text-[#e9e7e0] md:grid md:grid-cols-[248px_1fr]">
    <aside className={`fixed inset-y-0 left-0 z-30 flex w-[260px] flex-col border-r border-white/10 bg-[#141618] px-5 py-6 transition-transform md:sticky md:top-0 md:h-[100dvh] md:translate-x-0 rtl:right-0 rtl:left-auto rtl:border-r-0 rtl:border-l ${open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'}`}>
      <div className="flex items-center justify-between"><Link href="/" className="flex items-center gap-3" data-testid="link-console-home"><span className="grid h-9 w-9 place-items-center rounded-xl border border-white/15 bg-white/[.04] font-serif">Ω</span><span><span className="block text-sm tracking-wide">YOUSIVAR–Ω</span><span className="eyebrow block pt-1 text-[8px] text-zinc-600">CONTROL ROOM</span></span></Link><button className="md:hidden" onClick={()=>setOpen(false)} aria-label="Close menu"><X size={17}/></button></div>
      <p className="eyebrow mb-3 mt-12 text-zinc-600">Workspace</p><nav className="space-y-1">{navigation.map(({href,label,icon:Icon})=><Link key={href} href={href} onClick={()=>setOpen(false)} data-testid={`nav-${label.toLowerCase().replaceAll(' ','-')}`} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${path === href ? 'bg-white/[.09] text-[#e8e3d6]' : 'text-zinc-500 hover:bg-white/[.04] hover:text-zinc-200'}`}><Icon size={16} strokeWidth={1.6}/>{label}{path===href&&<span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#c7bfae]"/>}</Link>)}</nav>
      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[.025] p-4"><div className="mb-3 flex items-center gap-2 text-xs text-zinc-300"><ShieldCheck size={14} className="text-[#c7bfae]"/>Permission-aware</div><p className="text-[11px] leading-5 text-zinc-600">Access is granted by your application role and permissions.</p><Link href="/" className="mt-4 inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white">View public site<ArrowUpRight size={13}/></Link></div>
    </aside>
    {open&&<button className="fixed inset-0 z-20 bg-black/60 md:hidden" onClick={()=>setOpen(false)} aria-label="Close navigation overlay"/>}
    <div className="min-w-0">
      <header className="sticky top-0 z-10 flex h-[68px] items-center justify-between border-b border-white/10 bg-[#101214]/90 px-4 backdrop-blur-xl sm:px-8"><div className="flex items-center gap-3"><button onClick={()=>setOpen(true)} className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 md:hidden" aria-label="Open navigation"><Menu size={18}/></button><span className="eyebrow text-zinc-500">{rtl ? 'مركز القيادة الشخصي' : 'Personal command center'}</span></div><div className="flex items-center gap-4"><button onClick={()=>setLocale(rtl ? 'en' : 'ar')} className="eyebrow inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-200" aria-label={rtl ? 'Switch to English' : 'Switch to Arabic'}><Languages size={14}/>{rtl ? 'EN' : 'عربي'}</button><Link href="/" className="eyebrow flex items-center gap-2 text-zinc-500 hover:text-zinc-200"><Globe2 size={14}/>{rtl ? 'الموقع العام' : 'Public view'}</Link></div></header>
      <main className="mx-auto max-w-[1440px] px-4 pb-16 pt-8 sm:px-8 sm:pt-12">{children}</main>
    </div>
  </div>;
}
function AdminGate({ children, permission }: { children: ReactNode; permission?: string }) {
  const identity = useGetAdminIdentity({ query: { queryKey: getGetAdminIdentityQueryKey(), retry: false } });
  if (identity.isLoading) return <PageLoader/>;
  if (identity.isError || !identity.data) return <div className="grain grid min-h-[100dvh] place-items-center bg-[#101214] px-5 text-[#e9e7e0]"><div className="max-w-lg rounded-3xl border border-white/10 bg-white/[.035] p-8 text-center"><ShieldCheck className="mx-auto h-8 w-8 text-[#c7bfae]"/><p className="eyebrow mt-5 text-zinc-500">Permission required</p><h1 className="display mt-3 text-4xl">This workspace is private.</h1><p className="mt-3 text-sm leading-6 text-zinc-500">Sign in with an account granted application permissions. A Clerk session alone does not grant access.</p><Link href="/sign-in" className="mt-6 inline-flex rounded-full bg-[#c6beac] px-5 py-3 text-sm font-medium text-[#191a1b]" data-testid="link-sign-in">Continue to sign in</Link><div className="mt-5 text-xs text-zinc-600">{identity.error instanceof Error ? identity.error.message : 'Access was not granted by the API.'}</div></div></div>;
  if (!identity.data.permissions?.length) return <div className="grain grid min-h-[100dvh] place-items-center bg-[#101214] p-6 text-center text-zinc-400"><div><ShieldCheck className="mx-auto h-8 w-8"/><h1 className="display mt-4 text-4xl">No permissions assigned</h1><p className="mt-3 text-sm">Your authenticated identity does not currently have application permissions.</p></div></div>;
  if (permission && !identity.data.permissions.includes(permission)) return <div className="grain grid min-h-[100dvh] place-items-center bg-[#101214] p-6 text-center text-zinc-400"><div><ShieldCheck className="mx-auto h-8 w-8"/><p className="eyebrow mt-5 text-zinc-600">Permission boundary</p><h1 className="display mt-3 text-4xl">Access is not assigned.</h1><p className="mt-3 text-sm">This section requires <code className="text-zinc-300">{permission}</code>.</p><Link href="/admin" className="mt-6 inline-flex rounded-full border border-white/15 px-5 py-3 text-sm text-zinc-200">Return to overview</Link></div></div>;
  return <AdminShell>{children}</AdminShell>;
}
function Heading({ label, title, detail, action }: { label: string; title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-9 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><p className="eyebrow text-[#bdb5a2]">{label}</p><h1 className="display mt-2 text-5xl leading-none sm:text-6xl">{title}</h1>{detail&&<p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-500">{detail}</p>}</div>{action}</div>;
}
function AdminDashboard() {
  const identity = useGetAdminIdentity();
  const summary = useGetAdminSummary({ query: { queryKey: getGetAdminSummaryQueryKey() } });
  const canReadAudit = Boolean(identity.data?.permissions.includes('audit:read'));
  const activity = useListAdminActivity({ limit: 6 }, { query: { queryKey: getListAdminActivityQueryKey({ limit: 6 }), enabled: canReadAudit } });
  const health = useHealthCheck();
  return <><Heading label="Command center" title="Overview" detail="A live view of the work and the systems that publish it." action={<span className="eyebrow inline-flex items-center gap-2 text-zinc-500"><span className={`h-1.5 w-1.5 rounded-full ${health.data?.status ? 'bg-emerald-400' : 'bg-zinc-600'}`}/>{health.isLoading ? 'Checking service' : health.isError ? 'Service status unavailable' : health.data?.status}</span>}/>
    {summary.isLoading ? <PageLoader/> : summary.isError ? <QueryError retry={()=>summary.refetch()}/> : summary.data && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Published',summary.data.publishedContent,'Live in public view'],['Drafts',summary.data.draftContent,'Not yet published'],['All content',summary.data.totalContent,'Across every category'],['Categories',summary.data.categoryCount,'Distinct content groups']].map(([label,value,note])=><div key={label} className="admin-surface rounded-2xl p-5"><p className="eyebrow text-zinc-500">{label}</p><p className="display mt-6 text-5xl">{value}</p><p className="mt-2 text-xs text-zinc-600">{note}</p></div>)}</div>
      <div className={`mt-8 grid gap-4 ${canReadAudit ? 'lg:grid-cols-[1.35fr_.65fr]' : ''}`}>{canReadAudit&&<section className="admin-surface rounded-2xl p-6 sm:p-8"><div className="flex items-center justify-between"><div><p className="eyebrow text-zinc-500">Recent changes</p><h2 className="mt-2 text-lg">Audit trail</h2></div><Link href="/admin/activity" className="text-xs text-zinc-500 hover:text-white">All activity <ArrowRight className="ml-1 inline h-3 w-3"/></Link></div>
        {activity.isLoading ? <div className="mt-6 space-y-4">{[1,2,3].map(i=><div key={i} className="h-12 animate-pulse rounded-xl bg-white/5"/> )}</div> : activity.isError ? <div className="mt-6"><QueryError retry={()=>activity.refetch()}/></div> : activity.data?.length ? <div className="mt-5 divide-y divide-white/[.07]">{activity.data.map(entry=><div key={entry.id} data-testid={`activity-${entry.id}`} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm text-zinc-300">{entry.action}</p><p className="mt-1 text-xs text-zinc-600">{entry.actor} · {entry.target}</p></div><time className="eyebrow text-[9px] text-zinc-600">{new Date(entry.createdAt).toLocaleString()}</time></div>)}</div> : <div className="py-10 text-center text-sm text-zinc-600">No activity recorded yet.</div>}
      </section>}<section className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#1b1d1f] p-6 sm:p-8"><div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(201,192,172,.13),transparent_70%)]"/><div className="relative"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[.05]"><Command size={18}/></span><p className="eyebrow mt-8 text-[#bdb5a2]">Publishing state</p><h2 className="display mt-2 text-4xl">Quietly in motion.</h2><p className="mt-3 text-sm leading-6 text-zinc-500">Your workspace currently holds {summary.data.publishedContent} published entries and {summary.data.draftContent} drafts.</p><Link href="/admin/content" className="mt-7 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-xs text-zinc-200 hover:bg-white/10">Manage content<ArrowRight size={14}/></Link></div></section></div>
    </>}
  </>;
}

function ContentEditor({ item, onClose }: { item?: ContentItem; onClose: () => void }) {
  const qc = useQueryClient(); const create = useCreateContentItem(); const update = useUpdateContentItem();
  const requestUrl = useRequestUploadUrl(); const complete = useCompleteMediaUpload();
  const [form, setForm] = useState<ContentItemInput>(() => item ? {
    category:item.category,title:item.title,titleAr:item.titleAr,description:item.description,descriptionAr:item.descriptionAr,url:item.url,
    tags:item.tags,actions:item.actions,media:item.media,status:item.status,featured:item.featured,sortOrder:item.sortOrder,metadata:item.metadata,
  } : { category:'',title:'',titleAr:'',description:'',descriptionAr:'',url:'',tags:[],actions:[],media:[],status:'draft',featured:false,sortOrder:0 });
  const [tagText,setTagText]=useState((item?.tags??[]).join(', ')); const [saveError,setSaveError]=useState('');
  const set=(key:keyof ContentItemInput,value:unknown)=>setForm(prev=>({...prev,[key]:value}));
  const save=(e:FormEvent)=>{e.preventDefault();setSaveError('');const data={...form,tags:tagText.split(',').map(s=>s.trim()).filter(Boolean)};
    const onSuccess=()=>{qc.invalidateQueries({queryKey:getListAdminContentQueryKey()});qc.invalidateQueries({queryKey:getListPublicContentQueryKey()});qc.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});onClose();};
    if(item) update.mutate({id:item.id,data},{onSuccess,onError:err=>setSaveError(err.message)}); else create.mutate({data},{onSuccess,onError:err=>setSaveError(err.message)});
  };
  async function upload(file:File) {
    setSaveError('');
    const validTypes=['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','video/mp4','video/webm','audio/mpeg','audio/ogg','audio/wav'];
    if(!validTypes.includes(file.type)){setSaveError('This media type is not supported.');return;}
    try {
      const signed=await requestUrl.mutateAsync({data:{name:file.name,size:file.size,contentType:file.type as never}});
      const result=await fetch(signed.uploadURL,{method:'PUT',headers:{'Content-Type':file.type},body:file});
      if(!result.ok) throw new Error('The storage upload did not complete.');
      const registered=await complete.mutateAsync({data:{objectPath:signed.objectPath,name:file.name,size:file.size,contentType:file.type}});
      const kind=file.type.startsWith('image/')?'image':file.type.startsWith('video/')?'video':'audio';
      set('media',[...(form.media??[]),{url:`/api/storage${registered.objectPath}`,kind:kind as never,alt:file.name}]);
    } catch(err){setSaveError(err instanceof Error?err.message:'Upload failed.');}
  }
  const pending=create.isPending||update.isPending||requestUrl.isPending||complete.isPending;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-3 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={item?'Edit content':'Create content'}>
    <form onSubmit={save} className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-[1.5rem] border border-white/15 bg-[#181a1c] p-5 shadow-2xl sm:p-8">
      <div className="mb-7 flex items-start justify-between"><div><p className="eyebrow text-[#c2baa8]">Content desk</p><h2 className="display mt-2 text-4xl">{item?'Edit entry':'New entry'}</h2></div><button type="button" onClick={onClose} aria-label="Close editor" className="rounded-full border border-white/10 p-2 text-zinc-500 hover:text-white"><X size={17}/></button></div>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Category" value={form.category} onChange={v=>set('category',v)} testId="input-content-category"/><Field label="Title · English" value={form.title} onChange={v=>set('title',v)} testId="input-content-title"/><Field label="Title · Arabic" value={form.titleAr||''} onChange={v=>set('titleAr',v)} testId="input-content-title-ar"/><Field label="Project URL" value={form.url||''} onChange={v=>set('url',v)} testId="input-content-url"/><div className="sm:col-span-2"><Field label="Description · English" value={form.description} onChange={v=>set('description',v)} multiline testId="input-content-description"/></div><div className="sm:col-span-2"><Field label="Description · Arabic" value={form.descriptionAr||''} onChange={v=>set('descriptionAr',v)} multiline testId="input-content-description-ar"/></div><div className="sm:col-span-2"><Field label="Tags · comma separated" value={tagText} onChange={setTagText} testId="input-content-tags"/></div>
        <label className="space-y-2"><span className="eyebrow text-zinc-500">Publication state</span><select value={form.status||'draft'} onChange={e=>set('status',e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#202224] px-4 py-3 text-sm text-zinc-200" data-testid="select-content-status"><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label><label className="flex items-end gap-3 pb-3 text-sm text-zinc-300"><input type="checkbox" checked={!!form.featured} onChange={e=>set('featured',e.target.checked)} className="accent-[#c8c0ae]" data-testid="toggle-content-featured"/>Featured</label>
      </div>
      <div className="mt-5 rounded-xl border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><span className="eyebrow text-zinc-500">Media assets</span><label className="cursor-pointer rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-200 hover:bg-white/10">{requestUrl.isPending||complete.isPending?'Uploading…':'Choose file'}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,audio/mpeg,audio/ogg,audio/wav" onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.currentTarget.value='';}} disabled={requestUrl.isPending||complete.isPending} data-testid="input-content-media"/></label></div>
        <div className="mt-3 space-y-2">{form.media?.map((media,index)=><div key={`${media.url}-${index}`} className="flex items-center justify-between rounded-lg bg-white/[.04] px-3 py-2 text-xs text-zinc-400"><span className="truncate">{media.kind} · {media.alt||media.url}</span><button type="button" onClick={()=>set('media',form.media?.filter((_,i)=>i!==index))} className="text-zinc-600 hover:text-red-300" aria-label="Remove media"><X size={14}/></button></div>)}</div></div>
      {saveError&&<p className="mt-4 text-sm text-red-300" role="alert">{saveError}</p>}
      <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><Saved pending={pending} text="Ready to save"/><div className="flex gap-2"><Button secondary onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending} testId="button-save-content">{pending?'Saving…':item?'Save changes':'Create entry'}</Button></div></div>
    </form>
  </div>;
}
function ContentPage() {
  const qc=useQueryClient(); const [search,setSearch]=useState('');const [status,setStatus]=useState('');const [editor,setEditor]=useState<ContentItem|true|false>(false);const [confirm,setConfirm]=useState<ContentItem|null>(null);const [notice,setNotice]=useState('');
  const params=useMemo(()=>({search:search||undefined,status:status?status as 'draft'|'published'|'archived':undefined,limit:100,offset:0}),[search,status]);
  const query=useListAdminContent(params,{query:{queryKey:getListAdminContentQueryKey(params)}});
  const del=useDeleteContentItem();const publish=useSetContentItemPublished();const refresh=()=>{qc.invalidateQueries({queryKey:getListAdminContentQueryKey()});qc.invalidateQueries({queryKey:getListPublicContentQueryKey()});qc.invalidateQueries({queryKey:getGetAdminSummaryQueryKey()});};
  return <><Heading label="Publishing" title="Content" detail="Manage published work and drafts. Every change is stored on the server." action={<Button onClick={()=>setEditor(true)} testId="button-add-content"><Plus size={16}/>New entry</Button>}/>
    <div className="mb-5 flex flex-col gap-3 sm:flex-row"><label className="relative flex-1"><Search className="absolute left-4 top-3.5 h-4 w-4 text-zinc-600"/><input value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded-full border border-white/10 bg-white/[.035] py-3 pl-11 pr-4 text-sm outline-none focus:border-white/25" placeholder="Search entries" data-testid="input-content-search"/></label><select value={status} onChange={e=>setStatus(e.target.value)} className="rounded-full border border-white/10 bg-[#1a1c1e] px-5 py-3 text-sm text-zinc-300" data-testid="select-content-filter"><option value="">All states</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived</option></select></div>
    {query.isLoading?<PageLoader/>:query.isError?<QueryError retry={()=>query.refetch()}/>:!query.data?.length?<div className="rounded-2xl border border-dashed border-white/15 py-20 text-center"><FilePlus2 className="mx-auto h-8 w-8 text-zinc-600"/><p className="mt-4 text-sm text-zinc-400">{search||status?'No entries match these filters.':'Your content library is empty.'}</p>{!search&&!status&&<button onClick={()=>setEditor(true)} className="mt-4 text-xs text-[#c9c0ad] hover:text-white">Create your first entry</button>}</div>:<div className="overflow-hidden rounded-2xl border border-white/10"><div className="hidden grid-cols-[1.5fr_.7fr_.65fr_.6fr_auto] gap-4 bg-white/[.035] px-5 py-3 sm:grid"><span className="eyebrow text-zinc-600">Entry</span><span className="eyebrow text-zinc-600">Category</span><span className="eyebrow text-zinc-600">Status</span><span className="eyebrow text-zinc-600">Updated</span><span/></div>
      <div className="divide-y divide-white/[.07]">{query.data.map(item=><div key={item.id} data-testid={`row-content-${item.id}`} className="grid gap-3 px-4 py-4 sm:grid-cols-[1.5fr_.7fr_.65fr_.6fr_auto] sm:items-center sm:gap-4 sm:px-5"><div className="min-w-0"><p className="truncate text-sm text-zinc-200">{item.title}</p><p className="mt-1 truncate text-xs text-zinc-600">{item.titleAr||item.description}</p></div><span className="text-xs text-zinc-500">{item.category}</span><span className={`w-fit rounded-full px-3 py-1 text-[10px] ${item.status==='published'?'bg-emerald-300/10 text-emerald-200':item.status==='archived'?'bg-zinc-400/10 text-zinc-400':'bg-amber-200/10 text-amber-100'}`}>{item.status}</span><span className="text-xs text-zinc-600">{new Date(item.updatedAt).toLocaleDateString()}</span><div className="flex items-center gap-2"><button onClick={()=>{setNotice('');setEditor(item);}} className="rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/10" data-testid={`button-edit-${item.id}`}>Edit</button><button disabled={publish.isPending} onClick={()=>publish.mutate({id:item.id,data:{published:item.status!=='published'}},{onSuccess:refresh,onError:e=>setNotice(e.message)})} className="rounded-full border border-white/10 px-3 py-2 text-xs text-zinc-400 hover:text-white" data-testid={`button-publish-${item.id}`}>{item.status==='published'?'Unpublish':'Publish'}</button><button onClick={()=>setConfirm(item)} aria-label={`Delete ${item.title}`} className="rounded-full p-2 text-zinc-600 hover:bg-red-400/10 hover:text-red-300" data-testid={`button-delete-${item.id}`}><Trash2 size={15}/></button></div></div>)}</div></div>}
    {notice&&<p className="mt-3 text-sm text-red-300" role="alert">{notice}</p>}
    {editor&&<ContentEditor item={editor===true?undefined:editor} onClose={()=>{setEditor(false);refresh();}}/>}
    {confirm&&<div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-md rounded-2xl border border-white/15 bg-[#1b1d1f] p-6"><p className="eyebrow text-zinc-500">Permanent action</p><h2 className="display mt-2 text-3xl">Delete this entry?</h2><p className="mt-3 text-sm text-zinc-500">{confirm.title} will be removed from the content library.</p><div className="mt-6 flex justify-end gap-2"><Button secondary onClick={()=>setConfirm(null)}>Cancel</Button><Button disabled={del.isPending} onClick={()=>del.mutate({id:confirm.id},{onSuccess:()=>{setConfirm(null);refresh();},onError:e=>setNotice(e.message)})}>{del.isPending?'Deleting…':'Delete entry'}</Button></div></div></div>}
  </>;
}

function ProfilePage() {
  const qc=useQueryClient();const profile=useGetAdminProfile({query:{queryKey:getGetAdminProfileQueryKey()}});const mutation=useUpdateAdminProfile();const [form,setForm]=useState<DeveloperProfileInput|null>(null);const [saved,setSaved]=useState(false);const [error,setError]=useState('');
  useEffect(()=>{if(profile.data&&!form)setForm({...profile.data,portraitUrl:profile.data.portraitUrl||'',skills:[...profile.data.skills],socials:[...profile.data.socials]});},[profile.data,form]);
  if(profile.isLoading||!form)return <PageLoader/>;if(profile.isError)return <QueryError retry={()=>profile.refetch()}/>;
  const update=(key:keyof DeveloperProfileInput,value:unknown)=>setForm(v=>v?({...v,[key]:value}):v);
  const save=(e:FormEvent)=>{e.preventDefault();setSaved(false);setError('');mutation.mutate({data:form},{onSuccess:data=>{qc.setQueryData(getGetAdminProfileQueryKey(),data);qc.invalidateQueries({queryKey:getGetPublicSiteQueryKey()});setSaved(true);},onError:e=>setError(e.message)});};
  return <><Heading label="Identity" title="Profile" detail="This is the voice and identity presented on the public site." action={saved&&!mutation.isPending?<Saved pending={false}/>:null}/><form onSubmit={save} className="admin-surface max-w-4xl rounded-2xl p-5 sm:p-8"><div className="grid gap-5 sm:grid-cols-2"><Field label="Name · English" value={form.name} onChange={v=>update('name',v)} testId="input-profile-name"/><Field label="Name · Arabic" value={form.nameAr} onChange={v=>update('nameAr',v)} testId="input-profile-name-ar"/><div className="sm:col-span-2"><Field label="Biography · English" value={form.biography} onChange={v=>update('biography',v)} multiline testId="input-profile-bio"/></div><div className="sm:col-span-2"><Field label="Biography · Arabic" value={form.biographyAr} onChange={v=>update('biographyAr',v)} multiline testId="input-profile-bio-ar"/></div><Field label="Portrait URL" value={form.portraitUrl||''} onChange={v=>update('portraitUrl',v)} testId="input-profile-portrait"/><Field label="Skills · comma separated" value={form.skills.join(', ')} onChange={v=>update('skills',v.split(',').map(x=>x.trim()).filter(Boolean))} testId="input-profile-skills"/></div>
    <div className="mt-8 border-t border-white/10 pt-6"><div className="mb-4 flex items-center justify-between"><p className="eyebrow text-zinc-500">Social links</p><button type="button" onClick={()=>update('socials',[...form.socials,{label:'',url:'',visible:true}])} className="text-xs text-[#c9c0ad] hover:text-white" data-testid="button-add-social"><Plus size={14} className="mr-1 inline"/>Add link</button></div>
    <div className="space-y-3">{form.socials.map((social,index)=><div key={index} className="grid gap-2 sm:grid-cols-[.7fr_1.3fr_auto_auto]"><input value={social.label} onChange={e=>update('socials',form.socials.map((s,i)=>i===index?{...s,label:e.target.value}:s))} placeholder="Label" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" data-testid={`input-social-label-${index}`}/><input value={social.url} onChange={e=>update('socials',form.socials.map((s,i)=>i===index?{...s,url:e.target.value}:s))} placeholder="https://" className="rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none" data-testid={`input-social-url-${index}`}/><label className="flex items-center gap-2 px-2 text-xs text-zinc-500"><input type="checkbox" checked={social.visible} onChange={e=>update('socials',form.socials.map((s,i)=>i===index?{...s,visible:e.target.checked}:s))} className="accent-[#c8c0ae]"/>Visible</label><button type="button" onClick={()=>update('socials',form.socials.filter((_,i)=>i!==index))} className="px-2 text-zinc-600 hover:text-red-300" aria-label="Remove social link"><Trash2 size={15}/></button></div>)}</div></div>
    {error&&<p className="mt-5 text-sm text-red-300" role="alert">{error}</p>}<div className="mt-7 flex items-center justify-between"><Saved pending={mutation.isPending} text={saved?'Changes saved':'Unsaved changes'}/><Button type="submit" disabled={mutation.isPending} testId="button-save-profile">{mutation.isPending?'Saving…':'Save profile'}</Button></div></form></>;
}

function SettingsPage() {
  const qc=useQueryClient();const settings=useGetAdminSettings({query:{queryKey:getGetAdminSettingsQueryKey()}});const mutation=useUpdateAdminSettings();const [form,setForm]=useState<SiteSettingsUpdate|null>(null);const [error,setError]=useState('');const [saved,setSaved]=useState(false);
  useEffect(()=>{if(settings.data&&!form)setForm({...settings.data});},[settings.data,form]);
  if(settings.isLoading||!form)return <PageLoader/>;if(settings.isError)return <QueryError retry={()=>settings.refetch()}/>;
  const set=(key:keyof SiteSettingsUpdate,value:unknown)=>setForm(v=>v?({...v,[key]:value}):v);
  const save=(e:FormEvent)=>{e.preventDefault();setError('');setSaved(false);mutation.mutate({data:form},{onSuccess:data=>{qc.setQueryData(getGetAdminSettingsQueryKey(),data);qc.invalidateQueries({queryKey:getGetPublicSiteQueryKey()});setSaved(true);},onError:e=>setError(e.message)});};
  return <><Heading label="System identity" title="Settings" detail="Brand language and presentation preferences for the public surface."/><form onSubmit={save} className="admin-surface max-w-4xl rounded-2xl p-5 sm:p-8"><div className="grid gap-5 sm:grid-cols-2"><Field label="Project name · English" value={form.projectName} onChange={v=>set('projectName',v)} testId="input-setting-project-name"/><Field label="Project name · Arabic" value={form.projectNameAr} onChange={v=>set('projectNameAr',v)} testId="input-setting-project-name-ar"/><Field label="Tagline · English" value={form.tagline} onChange={v=>set('tagline',v)} multiline testId="input-setting-tagline"/><Field label="Tagline · Arabic" value={form.taglineAr} onChange={v=>set('taglineAr',v)} multiline testId="input-setting-tagline-ar"/><label className="space-y-2"><span className="eyebrow text-zinc-500">Default language</span><select value={form.defaultLocale} onChange={e=>set('defaultLocale',e.target.value)} className="w-full rounded-xl border border-white/10 bg-[#202224] px-4 py-3 text-sm text-zinc-200" data-testid="select-default-locale"><option value="en">English</option><option value="ar">العربية</option></select></label><label className="space-y-2"><span className="eyebrow text-zinc-500">Accent color</span><div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"><input type="color" value={form.accentColor} onChange={e=>set('accentColor',e.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent" data-testid="input-accent-color"/><span className="font-mono text-xs text-zinc-400">{form.accentColor}</span></div></label></div><div className="mt-6 max-w-md"><Toggle label="Reduce decorative motion" checked={form.reducedMotion} onChange={v=>set('reducedMotion',v)} testId="toggle-reduced-motion"/></div>
    {error&&<p className="mt-4 text-sm text-red-300" role="alert">{error}</p>}<div className="mt-7 flex items-center justify-between"><Saved pending={mutation.isPending} text={saved?'Changes saved':'Unsaved changes'}/><Button type="submit" disabled={mutation.isPending} testId="button-save-settings">{mutation.isPending?'Saving…':'Save settings'}</Button></div></form></>;
}

function AiPage() {
  const qc=useQueryClient();const providers=useListAiProviders({query:{queryKey:getListAiProvidersQueryKey()}});const assistant=useGetAssistantSettings({query:{queryKey:getGetAssistantSettingsQueryKey()}});
  const providerUpdate=useUpdateAiProvider();const assistantUpdate=useUpdateAssistantSettings();const send=useSendAssistantMessage();const github=useImportGithubRepository();
  const [settings,setSettings]=useState<AssistantSettingsUpdate|null>(null);const [drafts,setDrafts]=useState<Record<string,{model:string;endpoint:string;enabled:boolean}>>({});const [message,setMessage]=useState('');const [conversation,setConversation]=useState<{role:string;text:string}[]>([]);const [repo,setRepo]=useState('');const [notice,setNotice]=useState('');
  useEffect(()=>{if(assistant.data&&!settings)setSettings({...assistant.data});},[assistant.data,settings]);
  useEffect(()=>{if(providers.data)setDrafts(Object.fromEntries(providers.data.map(p=>[p.provider,{model:p.model,endpoint:p.endpoint||'',enabled:p.enabled}])));},[providers.data]);
  const refresh=()=>{qc.invalidateQueries({queryKey:getListAiProvidersQueryKey()});qc.invalidateQueries({queryKey:getGetAssistantSettingsQueryKey()});};
  const submitMessage=(e:FormEvent)=>{e.preventDefault();if(!message.trim())return;const sent=message.trim();setConversation(v=>[...v,{role:'you',text:sent}]);setMessage('');setNotice('');send.mutate({data:{message:sent}},{onSuccess:r=>setConversation(v=>[...v,{role:`${r.provider} · ${r.model}`,text:r.reply}]),onError:e=>setNotice(e.message)});};
  return <><Heading label="Connected intelligence" title="AI studio" detail="Provider availability is reported by the API. Credentials never appear here."/>
    {providers.isLoading||assistant.isLoading?<PageLoader/>:providers.isError?<QueryError retry={()=>providers.refetch()}/>:assistant.isError?<QueryError retry={()=>assistant.refetch()}/>:<div className="grid gap-5 xl:grid-cols-[1fr_.9fr]">
      <div className="space-y-5"><section className="admin-surface rounded-2xl p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[.04]"><Zap size={16}/></span><div><p className="eyebrow text-zinc-500">Provider registry</p><h2 className="mt-1 text-lg">Connections</h2></div></div>
        <div className="mt-6 space-y-3">{(providers.data||[]).map(provider=>{const d=drafts[provider.provider]||{model:provider.model,endpoint:provider.endpoint||'',enabled:provider.enabled};return <div key={provider.provider} className="rounded-xl border border-white/10 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><span className="text-sm capitalize text-zinc-200">{provider.provider}</span><span className={`ml-2 rounded-full px-2 py-1 text-[9px] ${provider.configured?'bg-emerald-300/10 text-emerald-200':'bg-zinc-400/10 text-zinc-500'}`}>{provider.configured?'Configured':'Not configured'}</span></div><Toggle label="Enabled" checked={d.enabled} onChange={v=>setDrafts(prev=>({...prev,[provider.provider]:{...d,enabled:v}}))} testId={`toggle-provider-${provider.provider}`}/></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Model" value={d.model} onChange={v=>setDrafts(prev=>({...prev,[provider.provider]:{...d,model:v}}))} testId={`input-provider-model-${provider.provider}`}/><Field label="Endpoint · optional" value={d.endpoint} onChange={v=>setDrafts(prev=>({...prev,[provider.provider]:{...d,endpoint:v}}))} testId={`input-provider-endpoint-${provider.provider}`}/></div>
          <button disabled={providerUpdate.isPending} onClick={()=>{setNotice('');providerUpdate.mutate({provider:provider.provider,data:{model:d.model,endpoint:d.endpoint||null,enabled:d.enabled}},{onSuccess:refresh,onError:e=>setNotice(e.message)});}} className="mt-4 rounded-full border border-white/15 px-4 py-2 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-50" data-testid={`button-save-provider-${provider.provider}`}>Save provider</button>
        </div>})}</div>
      </section>
      {settings&&<form onSubmit={e=>{e.preventDefault();assistantUpdate.mutate({data:settings},{onSuccess:()=>{qc.invalidateQueries({queryKey:getGetAssistantSettingsQueryKey()});setNotice('Assistant settings saved.');},onError:e=>setNotice(e.message)});}} className="admin-surface rounded-2xl p-5 sm:p-7"><p className="eyebrow text-zinc-500">Assistant persona</p><div className="mt-5 grid gap-4 sm:grid-cols-2"><Field label="Name" value={settings.name} onChange={v=>setSettings({...settings,name:v})} testId="input-assistant-name"/><Field label="Name · Arabic" value={settings.nameAr} onChange={v=>setSettings({...settings,nameAr:v})} testId="input-assistant-name-ar"/><Field label="Welcome message" value={settings.welcomeMessage} onChange={v=>setSettings({...settings,welcomeMessage:v})} testId="input-assistant-welcome"/><Field label="Welcome · Arabic" value={settings.welcomeMessageAr} onChange={v=>setSettings({...settings,welcomeMessageAr:v})} testId="input-assistant-welcome-ar"/><div className="sm:col-span-2"><Field label="Instructions" value={settings.instructions} onChange={v=>setSettings({...settings,instructions:v})} multiline testId="input-assistant-instructions"/></div><label className="space-y-2"><span className="eyebrow text-zinc-500">Provider</span><select value={settings.provider} onChange={e=>setSettings({...settings,provider:e.target.value as AssistantSettingsUpdate['provider']})} className="w-full rounded-xl border border-white/10 bg-[#202224] px-4 py-3 text-sm text-zinc-200">{(providers.data||[]).map(p=><option key={p.provider} value={p.provider}>{p.provider}</option>)}</select></label><Field label="Model" value={settings.model} onChange={v=>setSettings({...settings,model:v})} testId="input-assistant-model"/></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><Toggle label="Assistant enabled" checked={settings.enabled} onChange={v=>setSettings({...settings,enabled:v})} testId="toggle-assistant-enabled"/><Toggle label="Visible publicly" checked={settings.visible} onChange={v=>setSettings({...settings,visible:v})} testId="toggle-assistant-visible"/></div><Button type="submit" disabled={assistantUpdate.isPending} testId="button-save-assistant" className="hidden">{assistantUpdate.isPending?'Saving…':'Save assistant'}</Button><button type="submit" disabled={assistantUpdate.isPending} className="mt-5 rounded-full bg-[#c6beac] px-5 py-2.5 text-xs font-medium text-[#191a1b]" data-testid="button-save-assistant-settings">{assistantUpdate.isPending?'Saving…':'Save assistant settings'}</button></form>}</div>
      <div className="space-y-5"><section className="admin-surface flex min-h-[430px] flex-col rounded-2xl p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[.04]"><AudioLines size={16}/></span><div><p className="eyebrow text-zinc-500">Live request</p><h2 className="mt-1 text-lg">Assistant sandbox</h2></div></div>
        <div className="my-5 flex-1 space-y-3 overflow-y-auto">{!conversation.length&&<div className="flex h-full min-h-52 flex-col items-center justify-center text-center"><Sparkles size={22} className="text-[#c7bfae]"/><p className="mt-4 text-sm text-zinc-300">{settings?.welcomeMessage||'Send a message to test the configured assistant.'}</p><p className="mt-2 text-xs text-zinc-600">Requests are handled by the configured server provider.</p></div>}{conversation.map((m,i)=><div key={i} className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 ${m.role==='you'?'ml-auto bg-white/[.09] text-zinc-200':'bg-[#c5bda9]/10 text-zinc-300'}`}><span className="eyebrow mb-2 block text-[9px] text-zinc-500">{m.role}</span>{m.text}</div>)}</div>
        {notice&&<p className="mb-3 text-xs text-red-300" role="alert">{notice}</p>}<form onSubmit={submitMessage} className="flex gap-2"><input value={message} onChange={e=>setMessage(e.target.value)} className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none focus:border-white/25" placeholder="Ask the configured assistant…" data-testid="input-assistant-message"/><button disabled={send.isPending||!message.trim()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#c6beac] text-[#191a1b] disabled:opacity-50" aria-label="Send message" data-testid="button-send-assistant">{send.isPending?<LoaderCircle size={16} className="animate-spin"/>:<Send size={16}/>}</button></form>
      </section>
      <section className="admin-surface rounded-2xl p-5 sm:p-7"><div className="flex items-center gap-3"><Github size={17}/><div><p className="eyebrow text-zinc-500">Repository import</p><h2 className="mt-1 text-base">Import a GitHub repository</h2></div></div><p className="mt-3 text-xs leading-5 text-zinc-600">The API validates and imports the public repository URL. No credential field is required.</p><form onSubmit={e=>{e.preventDefault();setNotice('');github.mutate({data:{repositoryUrl:repo}},{onSuccess:()=>{setRepo('');setNotice('Repository import completed. Review content in the library.');qc.invalidateQueries({queryKey:getListAdminContentQueryKey()});},onError:e=>setNotice(e.message)});}} className="mt-4 flex flex-col gap-2 sm:flex-row"><input type="url" required value={repo} onChange={e=>setRepo(e.target.value)} placeholder="https://github.com/owner/repository" className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/20 px-4 py-3 text-sm outline-none" data-testid="input-github-url"/><Button type="submit" disabled={github.isPending} testId="button-import-github">{github.isPending?'Importing…':'Import'}</Button></form></section></div>
      {notice&&<p className="mt-4 text-sm text-zinc-400" role="status">{notice}</p>}
    </div>}</>;
}

function UsersPage() {
  const qc=useQueryClient();const users=useListAdminUsers({query:{queryKey:getListAdminUsersQueryKey()}});const update=useUpdateAdminUserRole();const [error,setError]=useState('');const [savedId,setSavedId]=useState('');
  const [draft,setDraft]=useState<Record<string,AdminUserRoleUpdate>>({});
  useEffect(()=>{if(users.data)setDraft(Object.fromEntries(users.data.map(user=>[user.userId,{role:user.role==='OWNER'?'ADMIN':user.role,permissions:user.permissions}])) as Record<string,AdminUserRoleUpdate>);},[users.data]);
  return <><Heading label="Team access" title="Users" detail="Assign application roles and explicit permissions. The server remains the authority for access."/>
    {users.isLoading?<PageLoader/>:users.isError?<QueryError retry={()=>users.refetch()}/>:!users.data?.length?<div className="rounded-2xl border border-dashed border-white/15 py-20 text-center text-sm text-zinc-500">No application users are available to manage.</div>:<div className="space-y-3">{users.data.map(user=>{const value=draft[user.userId]||{role:'ADMIN',permissions:user.permissions};const fixed=user.role==='OWNER';return <section key={user.userId} data-testid={`row-user-${user.userId}`} className="admin-surface rounded-2xl p-5 sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><p className="text-sm text-zinc-200">{user.email}</p><p className="mt-1 font-mono text-[10px] text-zinc-600">{user.userId}</p></div><div className="flex flex-wrap items-center gap-3"><span className="rounded-full border border-white/10 px-3 py-1 text-[10px] text-zinc-400">{user.role}</span>{fixed?<span className="text-xs text-zinc-600">Owner role is immutable.</span>:<><select value={value.role} onChange={e=>setDraft(prev=>({...prev,[user.userId]:{...value,role:e.target.value as AdminUserRoleUpdate['role']}}))} className="rounded-full border border-white/10 bg-[#1c1e20] px-4 py-2 text-xs text-zinc-300" data-testid={`select-user-role-${user.userId}`}><option value="SUPER_ADMIN">Super admin</option><option value="ADMIN">Admin</option><option value="PARTNER">Partner</option><option value="CUSTOM_ROLE">Custom role</option></select><Button secondary disabled={update.isPending} onClick={()=>{setError('');update.mutate({userId:user.userId,data:value},{onSuccess:()=>{setSavedId(user.userId);qc.invalidateQueries({queryKey:getListAdminUsersQueryKey()});},onError:e=>setError(e.message)});}} testId={`button-save-role-${user.userId}`}>Save role</Button></>}</div></div>
        {!fixed&&<div className="mt-5 flex flex-wrap gap-2">{['content:read','content:write','content:publish','media:write','settings:write','integrations:write','users:manage','audit:read'].map(permission=><label key={permission} className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-[10px] ${value.permissions.includes(permission as never)?'border-[#c7bfae]/40 bg-[#c7bfae]/[.07] text-zinc-300':'border-white/10 text-zinc-600'}`}><input type="checkbox" className="sr-only" checked={value.permissions.includes(permission as never)} onChange={e=>setDraft(prev=>({...prev,[user.userId]:{...value,permissions:e.target.checked?[...value.permissions,permission as never]:value.permissions.filter(p=>p!==permission)}}))} data-testid={`permission-${user.userId}-${permission}`}/>{permission}</label>)}</div>}{savedId===user.userId&&<p className="mt-3 text-xs text-emerald-200">Role and permissions saved.</p>}</section>})}</div>}
    {error&&<p className="mt-4 text-sm text-red-300" role="alert">{error}</p>}
  </>;
}
function ActivityPage() {
  const params={limit:100};const activity=useListAdminActivity(params,{query:{queryKey:getListAdminActivityQueryKey(params)}});
  return <><Heading label="Traceability" title="Activity" detail="Administrative changes recorded by the API."/>
    {activity.isLoading?<PageLoader/>:activity.isError?<QueryError retry={()=>activity.refetch()}/>:!activity.data?.length?<div className="rounded-2xl border border-dashed border-white/15 py-20 text-center text-sm text-zinc-500">No audit entries have been recorded.</div>:<div className="overflow-hidden rounded-2xl border border-white/10"><div className="hidden grid-cols-[1fr_1fr_1.4fr_auto] gap-4 bg-white/[.035] px-5 py-3 sm:grid"><span className="eyebrow text-zinc-600">Action</span><span className="eyebrow text-zinc-600">Actor</span><span className="eyebrow text-zinc-600">Target</span><span className="eyebrow text-zinc-600">Timestamp</span></div><div className="divide-y divide-white/[.07]">{activity.data.map(entry=><div key={entry.id} data-testid={`row-activity-${entry.id}`} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-center"><span className="text-sm text-zinc-200">{entry.action}</span><span className="text-xs text-zinc-400">{entry.actor}</span><span className="text-xs text-zinc-500">{entry.target}</span><time className="eyebrow text-[9px] text-zinc-600">{new Date(entry.createdAt).toLocaleString()}</time></div>)}</div></div>}
  </>;
}

function Protected({ page: Page, permission }: { page: ComponentType; permission?: string }) {
  return <AdminGate permission={permission}><Page/></AdminGate>;
}
function SignInPage() {
  return <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#101214] px-4 py-10 text-zinc-100"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(191,183,165,.11),transparent_48%)]"/><div className="relative z-[1] w-full"><div className="mb-8 text-center"><Link href="/" className="inline-flex items-center gap-3" data-testid="link-auth-home"><span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 font-serif">Ω</span><span className="eyebrow">YOUSIVAR–Ω / PRIVATE</span></Link></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/></div></main>;
}
function SignUpPage() {
  return <main className="grain relative grid min-h-[100dvh] place-items-center overflow-hidden bg-[#101214] px-4 py-10 text-zinc-100"><div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_35%,rgba(191,183,165,.11),transparent_48%)]"/><div className="relative z-[1] w-full"><div className="mb-8 text-center"><Link href="/" className="inline-flex items-center gap-3" data-testid="link-auth-home"><span className="grid h-10 w-10 place-items-center rounded-xl border border-white/15 font-serif">Ω</span><span className="eyebrow">YOUSIVAR–Ω / PRIVATE</span></Link></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/></div></main>;
}
function ClerkRoutes() {
  const [,setLocation]=useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{signIn:{start:{title:'Welcome back',subtitle:'Sign in to your private workspace'}},signUp:{start:{title:'Create your account',subtitle:'Access the YOUSIVAR–Ω workspace'}}}} routerPush={to=>setLocation(stripBase(to))} routerReplace={to=>setLocation(stripBase(to),{replace:true})}>
    <ClerkQueryClientCacheInvalidator/>
    <Switch>
      <Route path="/" component={Home}/>
      <Route path="/sign-in/*?" component={SignInPage}/>
      <Route path="/sign-up/*?" component={SignUpPage}/>
      <Route path="/admin" component={()=> <Protected page={AdminDashboard}/>}/>
      <Route path="/admin/content" component={()=> <Protected page={ContentPage} permission="content:read"/>}/>
      <Route path="/admin/profile" component={()=> <Protected page={ProfilePage} permission="settings:write"/>}/>
      <Route path="/admin/settings" component={()=> <Protected page={SettingsPage} permission="settings:write"/>}/>
      <Route path="/admin/ai" component={()=> <Protected page={AiPage} permission="integrations:write"/>}/>
      <Route path="/admin/users" component={()=> <Protected page={UsersPage} permission="users:manage"/>}/>
      <Route path="/admin/activity" component={()=> <Protected page={ActivityPage} permission="audit:read"/>}/>
      <Route component={NotFound}/>
    </Switch>
  </ClerkProvider>;
}
function ClerkQueryClientCacheInvalidator() {
  const { addListener }=useClerk();
  const client=useQueryClient();
  const previous=useRef<string|null|undefined>(undefined);
  useEffect(()=>addListener(({user})=>{
    const userId=user?.id??null;
    if(previous.current!==undefined&&previous.current!==userId)client.clear();
    previous.current=userId;
  }),[addListener,client]);
  return null;
}
function Router() {
  const [location]=useLocation();
  if (!clerkPubKey && location === '/') return <Home/>;
  if (!clerkPubKey) return <div className="grid min-h-[100dvh] place-items-center bg-[#101214] p-6 text-center text-zinc-300"><div><p className="eyebrow text-[#c7bfae]">YOUSIVAR–Ω</p><h1 className="display mt-3 text-4xl">Authentication is not configured.</h1><p className="mt-3 text-sm text-zinc-500">Set VITE_CLERK_PUBLISHABLE_KEY to enable Clerk sign-in and registration.</p><Link href="/" className="mt-6 inline-flex rounded-full border border-white/15 px-5 py-3 text-sm">Return home</Link></div></div>;
  return <ClerkRoutes/>;
}
function App() {
  return <LocaleProvider><QueryClientProvider client={queryClient}><WouterRouter base={basePath}><Router/></WouterRouter></QueryClientProvider></LocaleProvider>;
}

export default App;
