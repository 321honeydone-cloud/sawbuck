"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEstimateStore } from "@/store/useEstimateStore";
import type { ChatMessage, Estimate, EstimateStatus } from "@/lib/types";
import { Icon, reducedMotion, toast, useMarker, usePresence, useOutside } from "./ui";
import { STATUS_LABEL } from "./JobBoard";
import Chat from "./Chat";
import Quote from "./Quote";
import Inspector from "./Inspector";
import Finalize from "./Finalize";

export interface JobLink {
  id: string;
  name: string;
  client: string;
  status: string;
}

const STAGES: EstimateStatus[] = ["draft", "sent", "won", "invoiced", "archived"];

const readW = (k: string, d: number) => {
  try {
    const n = Number(localStorage.getItem(k));
    return n >= 220 ? n : d;
  } catch {
    return d;
  }
};

export default function JobScreen({
  initialEstimate,
  initialMessages,
  jobs,
}: {
  initialEstimate: Estimate;
  initialMessages: ChatMessage[];
  jobs: JobLink[];
}) {
  const hydrate = useEstimateStore((s) => s.hydrate);
  const hydrated = useRef<string | null>(null);
  if (hydrated.current !== initialEstimate.id) {
    hydrate(initialEstimate, initialMessages);
    hydrated.current = initialEstimate.id;
  }

  const [tab, setTab] = useState<"quote" | "scout">("quote");
  const [sel, setSel] = useState<string | null>(null);
  const [inspOut, setInspOut] = useState(false);
  const [inspIn, setInspIn] = useState(0);
  const [finalOpen, setFinalOpen] = useState(false);
  const [pane, setPane] = useState(0);
  const panesRef = useRef<HTMLDivElement>(null);
  const closeT = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Line inspector: slide in on open, slide out before it unmounts.
  const select = (id: string) => {
    clearTimeout(closeT.current);
    if (!sel || inspOut) setInspIn((n) => n + 1);
    setInspOut(false);
    setSel(id);
  };
  const closeInsp = useCallback(() => {
    if (!sel) return;
    setInspOut(true);
    clearTimeout(closeT.current);
    closeT.current = setTimeout(() => {
      setSel(null);
      setInspOut(false);
    }, reducedMotion() ? 0 : 210);
  }, [sel]);

  // Resizable panes, remembered per device.
  const [chatW, setChatW] = useState(360);
  const [inspW, setInspW] = useState(340);
  useEffect(() => {
    setChatW(readW("v2-chatW", 360));
    setInspW(readW("v2-inspW", 340));
  }, []);
  const drag = (which: "chat" | "insp") => (e: React.PointerEvent<HTMLDivElement>) => {
    const h = e.currentTarget;
    const box = panesRef.current;
    if (!box) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    h.classList.add("drag");
    box.classList.add("dragging");
    const rect = box.getBoundingClientRect();
    let w = which === "chat" ? chatW : inspW;
    const move = (ev: PointerEvent) => {
      w = which === "chat" ? ev.clientX - rect.left : rect.right - ev.clientX;
      w = Math.max(240, Math.min(w, rect.width * 0.55));
      if (which === "chat") setChatW(w);
      else setInspW(w);
    };
    const up = () => {
      h.classList.remove("drag");
      box.classList.remove("dragging");
      h.removeEventListener("pointermove", move);
      h.removeEventListener("pointerup", up);
      try {
        localStorage.setItem(which === "chat" ? "v2-chatW" : "v2-inspW", String(Math.round(w)));
      } catch {
        /* ignore */
      }
    };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
  };

  const { box: tabBox, mark: tabInk } = useMarker(tab);
  const { box: swipeBox, mark: swipeInk } = useMarker(pane);
  const goPane = (i: number) => {
    const el = panesRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: reducedMotion() ? "auto" : "smooth" });
  };

  return (
    <div className="job page">
      <JobBar jobs={jobs} onFinalize={() => setFinalOpen(true)}>
        <div className="tabs" ref={tabBox} role="tablist">
          <i className="ink" ref={tabInk} />
          <button className={`tab${tab === "quote" ? " on" : ""}`} role="tab" aria-selected={tab === "quote"} onClick={() => setTab("quote")}>
            Quote
          </button>
          <button className={`tab${tab === "scout" ? " on" : ""}`} role="tab" aria-selected={tab === "scout"} onClick={() => setTab("scout")}>
            Scout
          </button>
        </div>
      </JobBar>

      {tab === "scout" ? (
        <div className="home tabfade">
          <div className="excl" style={{ margin: 0, maxWidth: 560 }}>
            <h5>Scout</h5>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ margin: 0 }} className="muted">
                Walk the job, snap photos and talk through each issue. Scout builds the issues and turns the checked ones into a
                quote. It still runs in the classic screens for now.
              </p>
              <Link href="/inspect" className="btn" style={{ alignSelf: "flex-start", textDecoration: "none" }}>
                Open Scout
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="tabfade" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div className="swipebar" ref={swipeBox}>
            <i className="ink" ref={swipeInk} />
            <button className={pane === 0 ? "on" : ""} onClick={() => goPane(0)}>
              Chat
            </button>
            <button className={pane === 1 ? "on" : ""} onClick={() => goPane(1)}>
              Quote
            </button>
          </div>
          <div
            ref={panesRef}
            className={`panes${sel ? "" : " noinsp"}`}
            style={{ ["--chatW" as string]: `${chatW}px`, ["--inspW" as string]: `${inspW}px` } as React.CSSProperties}
            onScroll={(e) => {
              const el = e.currentTarget;
              const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
              if (i !== pane) setPane(i);
            }}
          >
            <Chat />
            <div className="handle" role="separator" aria-label="Resize chat" onPointerDown={drag("chat")} onDoubleClick={() => setChatW(360)} />
            <Quote sel={sel} onSelect={(id) => (sel === id ? closeInsp() : select(id))} onClose={closeInsp} />
            <div className="handle h2" role="separator" aria-label="Resize line panel" onPointerDown={drag("insp")} onDoubleClick={() => setInspW(340)} />
            {sel && (
              <Inspector key={`${inspIn}`} id={sel} className={inspOut ? "out" : "in"} onClose={closeInsp} />
            )}
          </div>
          {sel && <div className={`sheetback${inspOut ? " out" : ""}`} onClick={closeInsp} />}
        </div>
      )}
      <Finalize open={finalOpen} onClose={() => setFinalOpen(false)} />
    </div>
  );
}

/* ---------- header ---------- */
function JobBar({ jobs, onFinalize, children }: { jobs: JobLink[]; onFinalize: () => void; children: React.ReactNode }) {
  const router = useRouter();
  const id = useEstimateStore((s) => s.estimate.id);
  const client = useEstimateStore((s) => s.estimate.clientName ?? "");
  const status = useEstimateStore((s) => s.estimate.status);
  const hasLines = useEstimateStore((s) => s.estimate.groups.some((g) => g.items.length > 0));
  const setClient = useEstimateStore((s) => s.setClient);
  const setStatus = useEstimateStore((s) => s.setStatus);

  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(false), []);
  useOutside(menuRef, menu, closeMenu);
  const mp = usePresence(menu, 150);

  const [stageOpen, setStageOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const closeStage = useCallback(() => setStageOpen(false), []);
  useOutside(stageRef, stageOpen, closeStage);
  const sp = usePresence(stageOpen, 150);

  const [confirmDel, setConfirmDel] = useState(false);
  const del = async () => {
    const res = await fetch("/api/estimate", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => null);
    if (res?.ok) {
      toast("Job deleted");
      router.replace("/v2");
      router.refresh();
    } else toast("Could not delete that job");
  };

  return (
    <header className="jobbar">
      <Link href="/v2" className="back">
        {Icon.left}All jobs
      </Link>
      <div className="jt" ref={menuRef}>
        <div className={`namerow${menu ? " is-open" : ""}`}>
          <NameField />
          <button className="iconbtn" aria-label="Switch job" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            {Icon.chev}
          </button>
        </div>
        <input
          key={`client-${id}-${client}`}
          className="client"
          defaultValue={client}
          placeholder="Add client name"
          aria-label="Client name"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== client) setClient(v);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {mp.render && (
          <div className={`menu jmenu ${mp.closing ? "pop-out" : "pop-in"}`} role="menu">
            {jobs.map((j) => (
              <Link key={j.id} href={`/v2/job/${j.id}`} role="menuitem" onClick={() => setMenu(false)} style={j.id === id ? { background: "var(--accent-soft)" } : undefined}>
                <span style={{ minWidth: 0 }}>
                  <b>{j.name || "Untitled job"}</b>
                  <small>{j.client || "No client yet"}</small>
                </span>
                <span className={`stage stage-o ${j.status}`}>{STATUS_LABEL[j.status] ?? j.status}</span>
              </Link>
            ))}
            <hr />
            <Link href="/v2" role="menuitem" style={{ color: "var(--accent-text)", fontWeight: 600 }} onClick={() => setMenu(false)}>
              See all jobs
            </Link>
          </div>
        )}
      </div>
      <div className="jacts">
        <div className="stagepick" ref={stageRef}>
          <button className={`stage stage-o ${status}`} onClick={() => setStageOpen((o) => !o)} aria-haspopup="menu" aria-expanded={stageOpen}>
            {STATUS_LABEL[status] ?? status} ▾
          </button>
          {sp.render && (
            <div className={`menu ${sp.closing ? "pop-out" : "pop-in"}`} role="menu">
              {STAGES.map((s) => (
                <button
                  key={s}
                  role="menuitemradio"
                  aria-checked={s === status}
                  onClick={() => {
                    setStatus(s);
                    setStageOpen(false);
                    toast(`Marked ${STATUS_LABEL[s]}`);
                  }}
                >
                  {STATUS_LABEL[s]}
                  {s === status && <small>current</small>}
                </button>
              ))}
            </div>
          )}
        </div>
        {confirmDel ? (
          <>
            <button className="btn danger sm" onClick={del}>
              Delete job
            </button>
            <button className="btn ghost sm" onClick={() => setConfirmDel(false)}>
              Keep
            </button>
          </>
        ) : (
          <button className="iconbtn" aria-label="Delete this job" title="Delete this job" onClick={() => setConfirmDel(true)}>
            {Icon.trash}
          </button>
        )}
        <button className="btn" onClick={onFinalize} disabled={!hasLines}>
          Finalize
        </button>
      </div>
      {children}
    </header>
  );
}

/** Job name. Types itself in when the AI names a fresh job. */
function NameField() {
  const name = useEstimateStore((s) => s.estimate.name);
  const tick = useEstimateStore((s) => s.autoNameTick);
  const rename = useEstimateStore((s) => s.renameEstimate);
  const [value, setValue] = useState(name);
  const [typing, setTyping] = useState(false);
  const editing = useRef(false);
  const lastTick = useRef(tick);

  useEffect(() => {
    if (!typing && !editing.current) setValue(name);
  }, [name, typing]);

  useEffect(() => {
    if (tick === lastTick.current) return;
    lastTick.current = tick;
    const full = name.trim();
    if (!full) return;
    setTyping(true);
    setValue("");
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setValue(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(t);
        setTyping(false);
      }
    }, 40);
    return () => clearInterval(t);
  }, [tick, name]);

  return (
    <input
      className={`name${typing ? " typing" : ""}`}
      value={value}
      readOnly={typing}
      placeholder="Name this job"
      aria-label="Job name"
      onFocus={() => (editing.current = true)}
      onChange={(e) => setValue(e.target.value)}
      onBlur={(e) => {
        editing.current = false;
        const v = e.target.value.trim();
        if (v && v !== name) rename(v);
      }}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
