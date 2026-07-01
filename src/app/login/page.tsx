"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "go"];

type Mode = "email" | "pin";
type AuthMode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("email");

  return (
    <main className="grid min-h-screen place-items-center px-4 text-ink">
      <div className="w-full max-w-[340px] text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/sawbuck-lockup.png?v=2" alt="Sawbuck AI" className="mx-auto mb-2 w-full max-w-[300px]" />

        {mode === "email" ? <EmailForm onPin={() => setMode("pin")} /> : <PinPad onEmail={() => setMode("email")} />}
      </div>
    </main>
  );
}

function EmailForm({ onPin }: { onPin: () => void }) {
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = authMode === "signup" ? "/api/auth/signup" : "/api/auth/login";
      const payload = authMode === "signup" ? { name, email, password } : { email, password };
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(
        data.error === "email_taken"
          ? "That email already has an account. Try signing in."
          : data.error === "weak_password"
            ? "Password needs at least 6 characters."
            : data.error === "bad_email"
              ? "That email does not look right."
              : authMode === "signup"
                ? "Could not create the account."
                : "Wrong email or password."
      );
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = email.trim().length > 0 && password.length > 0 && (authMode === "signin" || name.trim().length > 0);

  return (
    <div className="mt-6 text-left">
      <p className="text-center font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
        {authMode === "signup" ? "Create your account" : "Sign in"}
      </p>
      <form
        className="mt-3 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        {authMode === "signup" && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full rounded-lg border border-border bg-card-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
          />
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="email"
          className="w-full rounded-lg border border-border bg-card-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete={authMode === "signup" ? "new-password" : "current-password"}
          className="w-full rounded-lg border border-border bg-card-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
        />
        {error && <p className="text-xs text-flag">{error}</p>}
        <button
          type="submit"
          disabled={busy || !canSubmit}
          className="w-full rounded-lg bg-brand px-3 py-2 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
        >
          {busy ? "…" : authMode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>

      <div className="mt-3 flex items-center justify-between text-xs">
        <button
          onClick={() => {
            setAuthMode((m) => (m === "signup" ? "signin" : "signup"));
            setError(null);
          }}
          className="text-muted underline-offset-2 transition hover:text-ink hover:underline"
        >
          {authMode === "signup" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
        <button onClick={onPin} className="text-muted underline-offset-2 transition hover:text-ink hover:underline">
          Use a PIN
        </button>
      </div>
    </div>
  );
}

function PinPad({ onEmail }: { onEmail: () => void }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    if (busy || value.length === 0) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      setError(true);
      setPin("");
    } catch {
      setError(true);
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const press = (k: string) => {
    if (k === "del") {
      setError(false);
      setPin((p) => p.slice(0, -1));
    } else if (k === "go") {
      void submit(pin);
    } else {
      setError(false);
      setPin((p) => (p.length >= 8 ? p : p + k));
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Backspace") press("del");
      else if (e.key === "Enter") press("go");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, busy]);

  return (
    <>
      <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">Enter PIN</p>
      <div className={`mt-3 flex items-center justify-center gap-2.5 ${error ? "hd-shake" : ""}`}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-3 rounded-full border transition ${
              i < pin.length ? "border-brand bg-brand" : "border-border bg-card-2"
            }`}
          />
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-flag">Wrong PIN, try again</p>}

      <div className="mx-auto mt-6 grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <button
            key={k}
            onClick={() => press(k)}
            disabled={busy}
            className={`grid h-14 place-items-center rounded-lg border text-lg font-display font-semibold transition disabled:opacity-50 ${
              k === "go"
                ? "border-brand bg-brand text-black hover:bg-brand-dim"
                : "border-border bg-card-2 text-ink hover:border-brand/50 hover:bg-card"
            }`}
            aria-label={k === "del" ? "Delete" : k === "go" ? "Unlock" : k}
          >
            {k === "del" ? "⌫" : k === "go" ? "→" : k}
          </button>
        ))}
      </div>

      <button
        onClick={onEmail}
        className="mt-4 text-xs text-muted underline-offset-2 transition hover:text-ink hover:underline"
      >
        Use email instead
      </button>
    </>
  );
}
