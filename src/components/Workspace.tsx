"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEstimateStore } from "@/store/useEstimateStore";
import type { ChatMessage, Estimate, EstimateStatus } from "@/lib/types";
import ChatPanel from "./ChatPanel";
import EstimateSheet from "./EstimateSheet";
import MobileMenu from "./MobileMenu";

export interface EstimateSummary {
  id: string;
  name: string;
  status: string;
}

const DEFAULT_CHAT_W = 380;
const MIN_CHAT_W = 300;

export default function Workspace({
  initialEstimate,
  initialMessages,
}: {
  initialEstimate: Estimate;
  initialMessages: ChatMessage[];
  estimates?: EstimateSummary[];
}) {
  const hydrate = useEstimateStore((s) => s.hydrate);
  const hydratedId = useRef<string | null>(null);
  const [tab, setTab] = useState<"chat" | "sheet">("chat");

  const rowRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [chatW, setChatW] = useState(DEFAULT_CHAT_W);
  const chatWRef = useRef(DEFAULT_CHAT_W);
  chatWRef.current = chatW;

  if (hydratedId.current !== initialEstimate.id) {
    hydrate(initialEstimate, initialMessages);
    hydratedId.current = initialEstimate.id;
  }

  // Restore the saved AI-panel width, then keep the drag handle wired up.
  useEffect(() => {
    const saved = Number(localStorage.getItem("hd_chat_w"));
    if (saved && saved >= MIN_CHAT_W) setChatW(saved);

    const clamp = (w: number) => {
      const rect = rowRef.current?.getBoundingClientRect();
      const max = rect ? Math.max(MIN_CHAT_W, rect.width * 0.65) : 900;
      return Math.max(MIN_CHAT_W, Math.min(w, max));
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !rowRef.current) return;
      const left = rowRef.current.getBoundingClientRect().left;
      setChatW(clamp(e.clientX - left));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      localStorage.setItem("hd_chat_w", String(Math.round(chatWRef.current)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startDrag = () => {
    dragging.current = true;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  return (
    <main className="flex h-full min-h-0 flex-col text-ink">
      <TopBar />

      <div className="flex shrink-0 gap-1 border-b border-border bg-card p-1.5 md:hidden">
        <button
          onClick={() => setTab("chat")}
          className={`flex-1 rounded-md py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] transition ${
            tab === "chat" ? "bg-brand text-black" : "text-muted"
          }`}
        >
          Ask AI
        </button>
        <button
          onClick={() => setTab("sheet")}
          className={`flex-1 rounded-md py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] transition ${
            tab === "sheet" ? "bg-brand text-black" : "text-muted"
          }`}
        >
          Estimate
        </button>
      </div>

      <div ref={rowRef} className="flex min-h-0 flex-1" style={{ ["--chat-w" as string]: `${chatW}px` } as React.CSSProperties}>
        <section
          className={`${tab === "chat" ? "flex" : "hidden"} w-full flex-col border-r border-border overflow-hidden bg-card md:flex md:w-[var(--chat-w)] md:shrink-0`}
        >
          <ChatPanel />
        </section>

        <div
          onMouseDown={startDrag}
          onDoubleClick={() => {
            setChatW(DEFAULT_CHAT_W);
            localStorage.setItem("hd_chat_w", String(DEFAULT_CHAT_W));
          }}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize AI panel (double-click to reset)"
          title="Drag to resize · double-click to reset"
          className="hidden w-1.5 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-brand/60 md:block"
        />

        <section className={`${tab === "sheet" ? "block" : "hidden"} min-w-0 flex-1 overflow-y-auto overscroll-contain md:block`}>
          <EstimateSheet />
        </section>
      </div>
    </main>
  );
}

const STAGES: [EstimateStatus, string][] = [
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["won", "Won"],
  ["archived", "Archived"],
];

function StatusSelect({ status, onChange }: { status: EstimateStatus; onChange: (s: EstimateStatus) => void }) {
  const known = STAGES.some(([v]) => v === status);
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value as EstimateStatus)}
      aria-label="Stage"
      className="rounded border border-border bg-card-2 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted outline-none transition hover:border-brand/50 focus:border-brand/60"
    >
      {!known && <option value={status}>{status}</option>}
      {STAGES.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

// Estimate name field. Normally an editable, uncontrolled-feeling input, but
// when the AI derives a name from the first prompt it types the name in one
// character at a time (autoNameTick bumps in the store on each auto-name).
function EstimateNameField() {
  const name = useEstimateStore((s) => s.estimate.name);
  const autoNameTick = useEstimateStore((s) => s.autoNameTick);
  const rename = useEstimateStore((s) => s.renameEstimate);

  const [value, setValue] = useState(name);
  const [typing, setTyping] = useState(false);
  const editing = useRef(false);
  const lastTick = useRef(autoNameTick);

  // Keep the field in sync with the store unless the user is editing it or the
  // typewriter is mid-run.
  useEffect(() => {
    if (!typing && !editing.current) setValue(name);
  }, [name, typing]);

  // Play the typewriter whenever the store reports a fresh auto-name.
  useEffect(() => {
    if (autoNameTick === lastTick.current) return;
    lastTick.current = autoNameTick;
    const full = name.trim();
    if (!full) return;
    setTyping(true);
    setValue("");
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setValue(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(id);
        setTyping(false);
      }
    }, 40);
    return () => clearInterval(id);
  }, [autoNameTick, name]);

  return (
    <input
      value={value}
      readOnly={typing}
      placeholder="Name this estimate"
      aria-label="Estimate name"
      onFocus={() => {
        editing.current = true;
      }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => {
        editing.current = false;
        const v = e.target.value.trim();
        if (v && v !== name) rename(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`w-full truncate rounded bg-transparent px-1.5 py-0.5 font-display text-sm font-semibold uppercase tracking-[0.06em] outline-none transition placeholder:normal-case placeholder:text-muted hover:bg-card-2 focus:bg-card-2 focus:ring-1 focus:ring-brand/50 ${
        typing ? "text-brand caret-brand" : "text-ink"
      }`}
    />
  );
}

function TopBar() {
  const router = useRouter();
  const id = useEstimateStore((s) => s.estimate.id);
  const clientName = useEstimateStore((s) => s.estimate.clientName ?? "");
  const status = useEstimateStore((s) => s.estimate.status);
  const aiUpdateCount = useEstimateStore((s) => s.estimate.aiUpdateCount);
  const setClient = useEstimateStore((s) => s.setClient);
  const setStatus = useEstimateStore((s) => s.setStatus);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const del = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/estimate", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setDeleting(false);
        return;
      }
      // Land on the home route, which redirects to the next most-recent quote
      // or shows the "begin a new quote" screen when none are left. Replace
      // (not push) keeps the deleted quote's URL out of back-history.
      router.replace("/");
      router.refresh();
    } catch {
      setDeleting(false);
    }
  };

  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-2 backdrop-blur-sm">
      <div className="min-w-0 flex-1">
        <EstimateNameField />
        <input
          key={"client-" + clientName}
          defaultValue={clientName}
          placeholder="Client name"
          aria-label="Client name"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== clientName) setClient(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          className="mt-0.5 w-full truncate rounded bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-muted outline-none transition hover:bg-card-2 focus:bg-card-2 focus:text-ink focus:ring-1 focus:ring-brand/50"
        />
      </div>

      <div className="flex shrink-0 items-center gap-2 text-xs">
        {aiUpdateCount > 0 && (
          <span className="hidden rounded-full bg-flag/15 px-2.5 py-1 font-medium text-flag sm:inline">
            {aiUpdateCount} AI {aiUpdateCount === 1 ? "update" : "updates"}
          </span>
        )}
        {confirmDel ? (
          <div className="flex items-center gap-1">
            <button
              onClick={del}
              disabled={deleting}
              className="rounded bg-flag/20 px-2 py-1 text-xs font-semibold text-flag transition hover:bg-flag/30 disabled:opacity-50"
            >
              {deleting ? "…" : "Delete"}
            </button>
            <button
              onClick={() => setConfirmDel(false)}
              className="rounded border border-border px-2 py-1 text-xs text-muted transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            aria-label="Delete this estimate"
            className="grid h-7 w-7 place-items-center rounded-md border border-border text-muted transition hover:border-flag/50 hover:text-flag"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="M6 7l1 13h10l1-13" />
              <path d="M9 7V4h6v3" />
            </svg>
          </button>
        )}
        <StatusSelect status={status} onChange={setStatus} />
        <MobileMenu />
      </div>
    </header>
  );
}
