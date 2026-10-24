import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  Mail,
  ShieldCheck,
  X,
} from "lucide-react";
import { ownerAccess, type OwnerReadiness } from "@/lib/owner-session";

type Step = "email" | "credentials" | "granted";

const inputClass =
  "w-full rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-[#c7bfae]/60 focus:bg-black/40";

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="eyebrow text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function message(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : "Something went wrong. Try again.";
}

/**
 * The Ω owner access flow: authorized owner email → username/password →
 * one-time code sent to the authorized address. The browser never decides who
 * the owner is; each step is acknowledged by the API.
 */
export function OwnerAuthModal({
  open,
  onClose,
  onAuthenticated,
}: {
  open: boolean;
  onClose: () => void;
  onAuthenticated: () => void;
}) {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [destination, setDestination] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState<"start" | "send" | "verify" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [readiness, setReadiness] = useState<OwnerReadiness | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("email");
    setEmail("");
    setChallengeId("");
    setDestination("");
    setUsername("");
    setPassword("");
    setCode("");
    setShowPassword(false);
    setCodeSent(false);
    setCooldown(0);
    setBusy(null);
    setError("");
    setNotice("");
    ownerAccess
      .readiness()
      .then(setReadiness)
      .catch(() => setReadiness(null));
  }, [open]);

  useEffect(() => {
    if (!open || step !== "email") return;
    const timer = setTimeout(() => emailRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [open, step]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!open) return null;

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy("start");
    try {
      const result = await ownerAccess.start(email);
      setChallengeId(result.challengeId);
      setDestination(result.destination);
      setStep("credentials");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const sendCode = async () => {
    if (busy || cooldown > 0) return;
    setError("");
    setNotice("");
    setBusy("send");
    try {
      const result = await ownerAccess.requestCode(challengeId, username, password);
      setCodeSent(true);
      setDestination(result.destination);
      setCooldown(result.resendAfterSeconds);
      setNotice(
        `A one-time code was sent to ${result.destination}. It expires in ${Math.max(
          1,
          Math.round(result.ttlSeconds / 60),
        )} minute(s).`,
      );
      setTimeout(() => codeRef.current?.focus(), 80);
    } catch (cause) {
      const text = message(cause);
      setError(text);
      const retryAfter = /Wait (\d+) second/.exec(text);
      if (retryAfter) setCooldown(Number(retryAfter[1]));
    } finally {
      setBusy(null);
    }
  };

  const submitCode = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy("verify");
    try {
      await ownerAccess.verify(challengeId, code);
      setStep("granted");
      setTimeout(onAuthenticated, 900);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  };

  const credentialWarning = readiness && !readiness.credentialsConfigured;
  const emailWarning = readiness && !readiness.emailConfigured;

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-black/85 p-3 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="owner-access-title"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(198,190,172,.14),transparent_58%)]" />
      <div className="relative my-6 w-full max-w-[560px] overflow-hidden rounded-[1.7rem] border border-white/12 bg-[#141618]/95 p-6 shadow-[0_50px_140px_rgba(0,0,0,.65)] rise sm:p-9">
        <button
          type="button"
          onClick={onClose}
          disabled={Boolean(busy)}
          aria-label="Close owner access"
          className="focus-ring absolute right-5 top-5 rounded-full border border-white/10 p-2 text-zinc-500 transition hover:text-white disabled:opacity-40"
          data-testid="button-close-owner-modal"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-4">
          <span className="relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-white/12 bg-white/[.04]">
            <span className="motion-safe:animate-[spin_22s_linear_infinite] absolute inset-1 rounded-[1.1rem] border border-[#c7bfae]/25" />
            <span className="display text-2xl text-[#e8e5dc]">Ω</span>
          </span>
          <div className="min-w-0">
            <p className="eyebrow text-[#c2baa8]">Owner access</p>
            <p className="eyebrow mt-1 text-[9px] text-zinc-600">
              {step === "credentials" ? "Step 02 / 02 · verification" : "Step 01 / 02 · identity"}
            </p>
          </div>
        </div>

        {step === "email" && (
          <form onSubmit={submitEmail} className="mt-8 space-y-5">
            <div>
              <h2 id="owner-access-title" className="display text-4xl leading-none">
                Identify the owner.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-500">
                Enter the owner's email address. Only the address registered with this workspace is
                authorized to continue — the server decides, not the browser.
              </p>
            </div>
            <Labelled label="Owner email">
              <div className="relative">
                <Mail className="absolute left-4 top-3.5 h-4 w-4 text-zinc-600" />
                <input
                  ref={emailRef}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="owner@example.com"
                  className={`${inputClass} pl-11`}
                  data-testid="input-owner-email"
                />
              </div>
            </Labelled>
            {error && (
              <p className="rounded-xl border border-red-400/25 bg-red-400/[.07] px-4 py-3 text-sm text-red-200" role="alert" data-testid="owner-modal-error">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button type="button" onClick={onClose} className="text-xs text-zinc-500 transition hover:text-zinc-200">
                Return to the public site
              </button>
              <button
                type="submit"
                disabled={busy !== null || !email.trim()}
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-[#c6beac] px-6 text-sm font-medium text-[#191a1b] transition hover:bg-[#ded7c6] disabled:opacity-50"
                data-testid="button-owner-continue"
              >
                {busy === "start" ? <LoaderCircle size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                Continue
              </button>
            </div>
          </form>
        )}

        {step === "credentials" && (
          <form onSubmit={submitCode} className="mt-8 space-y-5">
            <div>
              <h2 id="owner-access-title" className="display text-4xl leading-none">
                Two-step verification.
              </h2>
              <p className="mt-3 text-sm leading-6 text-zinc-500">
                Sign in with the registered owner credentials, then confirm the one-time code sent to{" "}
                <span className="text-zinc-300">{destination}</span>.
              </p>
            </div>

            {(credentialWarning || emailWarning) && (
              <div className="rounded-xl border border-amber-300/25 bg-amber-200/[.06] px-4 py-3 text-xs leading-5 text-amber-100" role="status">
                <p className="eyebrow mb-2 text-amber-200/80">Configuration required</p>
                {credentialWarning && (
                  <p>
                    Owner credentials are not configured on the server. Set <code>OWNER_USERNAME</code> and{" "}
                    <code>OWNER_PASSWORD</code> (or <code>OWNER_PASSWORD_HASH</code>) as app secrets.
                  </p>
                )}
                {emailWarning && <p>{readiness?.emailDetail}</p>}
              </div>
            )}

            <Labelled label="Username">
              <input
                required
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Owner username"
                className={inputClass}
                data-testid="input-owner-username"
              />
            </Labelled>

            <Labelled label="Password">
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Owner password"
                  className={`${inputClass} pr-12`}
                  data-testid="input-owner-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="focus-ring absolute right-3 top-2.5 rounded-full p-2 text-zinc-500 transition hover:text-zinc-200"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </Labelled>

            <Labelled label="Email verification code">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  ref={codeRef}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^\d]/g, "").slice(0, 10))}
                  placeholder={codeSent ? "6-digit code" : "Request a code first"}
                  disabled={!codeSent}
                  className={`${inputClass} tracking-[.4em] disabled:opacity-50`}
                  data-testid="input-owner-code"
                />
                <button
                  type="button"
                  onClick={sendCode}
                  disabled={busy !== null || cooldown > 0 || !username.trim() || !password}
                  className="focus-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[.04] px-5 text-xs text-zinc-200 transition hover:bg-white/10 disabled:opacity-45"
                  data-testid="button-send-owner-code"
                >
                  {busy === "send" ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <KeyRound size={15} />
                  )}
                  {codeSent
                    ? cooldown > 0
                      ? `Resend code (${cooldown}s)`
                      : "Resend code"
                    : "Send verification code"}
                </button>
              </div>
            </Labelled>

            {notice && (
              <p className="text-xs leading-5 text-emerald-200/90" role="status" data-testid="owner-modal-notice">
                {notice}
              </p>
            )}
            {error && (
              <p className="rounded-xl border border-red-400/25 bg-red-400/[.07] px-4 py-3 text-sm text-red-200" role="alert" data-testid="owner-modal-error">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  setStep("email");
                  setError("");
                  setNotice("");
                }}
                className="text-xs text-zinc-500 transition hover:text-zinc-200"
              >
                Use a different email
              </button>
              <button
                type="submit"
                disabled={busy !== null || !codeSent || code.length < 4}
                className="focus-ring inline-flex min-h-11 items-center gap-2 rounded-full bg-[#c6beac] px-6 text-sm font-medium text-[#191a1b] transition hover:bg-[#ded7c6] disabled:opacity-50"
                data-testid="button-verify-owner"
              >
                {busy === "verify" ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <ShieldCheck size={16} />
                )}
                Verify and sign in
              </button>
            </div>
          </form>
        )}

        {step === "granted" && (
          <div className="mt-10 pb-2 text-center">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full border border-emerald-300/30 bg-emerald-300/10 text-emerald-200">
              <Check size={22} />
            </span>
            <h2 id="owner-access-title" className="display mt-6 text-4xl">
              Access granted.
            </h2>
            <p className="mt-3 text-sm text-zinc-500">Opening the command center…</p>
          </div>
        )}

        <p className="mt-8 border-t border-white/[.07] pt-5 text-[11px] leading-5 text-zinc-600">
          Owner identity, credentials and one-time codes are verified on the server. Codes are
          hashed, single-use, expiring and rate limited.
        </p>
      </div>
    </div>
  );
}
