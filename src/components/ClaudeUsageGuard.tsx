"use client";

// Claude API guard. Manny wants to run Local by default and never be surprised
// by a paid Claude API call. This mounts once and watches for any request to an
// AI endpoint. When the brain is set to Claude, it pops a confirmation naming
// the exact task BEFORE the call goes out, so nothing hits Claude silently. When
// the brain is Local, nothing is intercepted (Local never calls Claude).
//
// It works by wrapping window.fetch and only stepping in for the known AI
// endpoints below; every other request passes straight through untouched.

import { useEffect, useRef, useState } from "react";

// AI endpoints that can reach Claude, mapped to a plain-English task label.
const AI_TASKS: { match: string; label: string }[] = [
  { match: "/api/chat", label: "Estimator chat (build or edit the quote)" },
  { match: "/api/jobber", label: "Finalize quote wording" },
  { match: "/api/steps", label: "Line item work steps" },
  { match: "/api/vision", label: "Read a photo or PDF" },
  { match: "/api/ratebook/ai", label: "Rate book pricing" },
  { match: "/api/scout", label: "Inspection scout" },
  { match: "/api/admin/summary", label: "Admin quote summary" },
];

function taskFor(url: string): string | null {
  const hit = AI_TASKS.find((t) => url.includes(t.match));
  return hit ? hit.label : null;
}

type Pending = { task: string; resolve: (ok: boolean) => void } | null;

export default function ClaudeUsageGuard() {
  const providerRef = useRef<"claude" | "ollama" | null>(null);
  const approvedRef = useRef<Set<string>>(new Set());
  const allowAllRef = useRef(false);
  const [pending, setPending] = useState<Pending>(null);
  const pendingRef = useRef<Pending>(null);
  pendingRef.current = pending;
  const queueRef = useRef<NonNullable<Pending>[]>([]);

  // Track the current brain (admin-only endpoint; non-admins just get null and
  // nothing is intercepted for them).
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch("/api/settings/ai-provider")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (live) providerRef.current = d?.provider === "claude" ? "claude" : d?.provider === "ollama" ? "ollama" : null;
        })
        .catch(() => {});
    load();
    const t = setInterval(load, 8000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      live = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Wrap fetch once. Only AI endpoints on the Claude brain trigger the prompt.
  useEffect(() => {
    const orig = window.fetch;
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let url = "";
      try {
        url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      } catch {
        url = "";
      }
      const task = url ? taskFor(url) : null;
      if (task && providerRef.current === "claude" && !allowAllRef.current && !approvedRef.current.has(task)) {
        // Queue, never replace. Two AI calls in flight at once used to clobber
        // the first dialog's resolver, leaving that fetch awaiting forever — a
        // silent hang. Now each pending prompt waits its turn.
        const ok = await new Promise<boolean>((resolve) => {
          const mine: NonNullable<Pending> = { task, resolve };
          if (pendingRef.current) queueRef.current.push(mine);
          else setPending(mine);
        });
        // Re-check: the user may have hit "Allow all session" while we queued.
        if (!ok && !allowAllRef.current && !approvedRef.current.has(task)) {
          // User kept it Local: abort the call so nothing hits Claude.
          throw new DOMException("Claude call declined (staying on Local).", "AbortError");
        }
      }
      return orig(input, init);
    };
    return () => {
      window.fetch = orig;
    };
  }, []);

  const decide = (choice: "once" | "session" | "deny") => {
    const p = pendingRef.current;
    if (!p) return;
    if (choice === "session") allowAllRef.current = true;
    if (choice === "once") approvedRef.current.add(p.task);
    p.resolve(choice !== "deny");
    // Drain the queue. "Allow all session" answers everything still waiting;
    // otherwise the next queued call gets its own dialog.
    if (allowAllRef.current) {
      for (const q of queueRef.current) q.resolve(true);
      queueRef.current = [];
      setPending(null);
    } else {
      setPending(queueRef.current.shift() ?? null);
    }
  };

  if (!pending) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-flag/50 bg-card p-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-flag/20 text-flag">!</span>
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-ink">Uses the Claude API</h2>
        </div>
        <p className="mt-2 text-sm text-ink">
          This action will call the paid Claude API:
        </p>
        <p className="mt-1 rounded-lg border border-border bg-card-2 px-3 py-2 font-mono text-xs text-gold">{pending.task}</p>
        <p className="mt-2 text-xs text-muted">
          You are on the Claude brain. Switch the brain to Local in Admin to keep everything free and on your own box.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            onClick={() => decide("once")}
            className="w-full rounded-lg bg-brand px-3 py-2 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim"
          >
            Allow once
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => decide("session")}
              className="flex-1 rounded-lg border border-border px-3 py-2 text-sm text-ink transition hover:border-brand/60"
            >
              Allow all session
            </button>
            <button
              onClick={() => decide("deny")}
              className="flex-1 rounded-lg border border-flag/50 px-3 py-2 text-sm font-semibold text-flag transition hover:bg-flag/10"
            >
              Keep Local
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
