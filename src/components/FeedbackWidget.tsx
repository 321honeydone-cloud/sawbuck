"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

// Floating "Feedback" button on every signed-in page. Opens a small box that
// posts to /api/feedback. The owner reads it all on the Admin page.
export default function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const send = async () => {
    if (!msg.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: msg, page: pathname }),
      });
      if (r.ok) {
        setDone(true);
        setMsg("");
        setTimeout(() => {
          setOpen(false);
          setDone(false);
        }, 1300);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-20 right-4 z-40 rounded-full border border-border bg-card px-3 py-2 font-display text-xs font-semibold uppercase tracking-[0.06em] text-muted shadow-lg transition hover:border-brand/60 hover:text-ink md:bottom-4"
        aria-label="Send feedback"
      >
        Feedback
      </button>

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-ink">Send feedback</h2>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-muted transition hover:text-ink">
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">Tell me what is missing or what is not working. It goes straight to the owner.</p>
            {done ? (
              <p className="py-6 text-center text-sm text-brand">Thanks, got it.</p>
            ) : (
              <>
                <textarea
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  rows={4}
                  placeholder="What would make this better?"
                  className="mt-3 w-full resize-none rounded-lg border border-border bg-card-2 px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-brand/60"
                />
                <button
                  onClick={send}
                  disabled={busy || !msg.trim()}
                  className="mt-2 w-full rounded-lg bg-brand px-3 py-2 font-display text-sm font-semibold uppercase tracking-[0.06em] text-black transition hover:bg-brand-dim disabled:opacity-40"
                >
                  {busy ? "Sending…" : "Send"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
